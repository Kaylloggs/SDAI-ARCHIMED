//! Conversion d'une image quelconque (réponse d'un modèle d'image, fichier importé) en
//! texture Minecraft : fond retiré, objet cadré, réduction à 16 × 16 (ou 32, 64, ou à la
//! taille d'un élément d'interface) par couleur dominante, palette limitée. Les faces de
//! bloc sont rendues raccordables (leurs bords se continuent une fois répétées) après avoir
//! retiré le cadre uni que les modèles d'image ajoutent souvent.
//!
//! Déterministe : même image et mêmes réglages donnent les mêmes pixels. Aucune IA ici.

use std::collections::{BTreeMap, VecDeque};
use std::io::Cursor;

use crate::core::{AppError, AppResult};

use super::textures::Image;
use super::types::{CropRect, PixelOptions, Tiling};

/// Côté maximal accepté à l'entrée (anti « bombe » de décompression).
const MAX_SIDE: u32 = 4096;
/// Taille maximale du fichier encodé.
pub const MAX_BYTES: usize = 32 * 1024 * 1024;
/// Au-delà, l'image est d'abord réduite par moyenne : le reste du traitement reste rapide.
const WORK_SIDE: u32 = 1024;
/// Tailles de texture proposées.
pub const SIZES: [u32; 3] = [16, 32, 64];
/// Côté maximal d'un élément d'interface, et de la toile des écrans du jeu.
pub const GUI_MAX: u32 = 256;

/// Écart de couleur (distance euclidienne RVB au carré).
fn distance(a: [u8; 4], b: [u8; 4]) -> u32 {
    (0..3)
        .map(|i| {
            let d = i32::from(a[i]) - i32::from(b[i]);
            (d * d) as u32
        })
        .sum()
}

/// Graine du fond : pixels du bord assez proches de sa couleur.
const SEED_TOLERANCE: u32 = 60 * 60;
/// Pas d'un pixel de fond à son voisin (dégradés, vignettage).
const STEP_TOLERANCE: u32 = 22 * 22;
/// Écart maximal à la couleur du fond, pour ne jamais « couler » dans l'objet.
const REACH_TOLERANCE: u32 = 110 * 110;
/// Liseré d'anticrénelage laissé autour de l'objet.
const FRINGE_TOLERANCE: u32 = 90 * 90;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Raster {
    pub width: u32,
    pub height: u32,
    pub px: Vec<[u8; 4]>,
}

impl Raster {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            px: vec![[0; 4]; (width * height) as usize],
        }
    }

    pub fn at(&self, x: u32, y: u32) -> [u8; 4] {
        self.px[(y * self.width + x) as usize]
    }

    pub fn put(&mut self, x: u32, y: u32, color: [u8; 4]) {
        let index = (y * self.width + x) as usize;
        self.px[index] = color;
    }

    pub fn png(&self) -> AppResult<Vec<u8>> {
        let rgba = self.px.iter().flatten().copied().collect();
        Image::from_rgba(self.width, self.height, rgba).png()
    }
}

/// Format reconnu d'après les premiers octets : extension de fichier à utiliser.
pub fn extension_of(bytes: &[u8]) -> Option<&'static str> {
    match image::guess_format(bytes).ok()? {
        image::ImageFormat::Png => Some("png"),
        image::ImageFormat::Jpeg => Some("jpg"),
        image::ImageFormat::WebP => Some("webp"),
        _ => None,
    }
}

/// Décode un PNG, JPEG ou WebP, dimensions bornées.
pub fn decode(bytes: &[u8]) -> AppResult<Raster> {
    if bytes.len() > MAX_BYTES {
        return Err(AppError::invalid("Image trop lourde (32 Mo au plus)."));
    }
    if extension_of(bytes).is_none() {
        return Err(AppError::invalid(
            "Format d'image non pris en charge : PNG, JPEG ou WebP.",
        ));
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| AppError::invalid(format!("Image illisible : {e}")))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|e| AppError::invalid(format!("Image illisible : {e}")))?
        .to_rgba8();
    let (width, height) = decoded.dimensions();
    if width == 0 || height == 0 {
        return Err(AppError::invalid("Image vide."));
    }
    Ok(Raster {
        width,
        height,
        px: decoded.pixels().map(|p| p.0).collect(),
    })
}

pub fn validate(options: &PixelOptions) -> AppResult<()> {
    match (options.width, options.height) {
        (Some(w), Some(h)) => {
            if !(1..=GUI_MAX).contains(&w) || !(1..=GUI_MAX).contains(&h) {
                return Err(AppError::invalid(format!(
                    "Taille d'un élément d'interface : de 1 à {GUI_MAX} pixels de côté."
                )));
            }
        }
        (None, None) => {
            if !SIZES.contains(&options.size) {
                return Err(AppError::invalid(
                    "Taille de texture : 16, 32 ou 64 pixels.",
                ));
            }
            if options.atlas {
                return Err(AppError::invalid(
                    "La toile 256 × 256 est réservée aux éléments d'interface.",
                ));
            }
        }
        _ => {
            return Err(AppError::invalid(
                "Taille d'un élément d'interface : largeur et hauteur.",
            ))
        }
    }
    if options.colors == 1 || options.colors > 256 {
        return Err(AppError::invalid(
            "Nombre de couleurs : de 2 à 256, ou sans limite.",
        ));
    }
    Ok(())
}

/// Largeur et hauteur de la texture produite (avant la toile 256 × 256).
pub fn output_size(options: &PixelOptions) -> (u32, u32) {
    match (options.width, options.height) {
        (Some(w), Some(h)) => (w, h),
        _ => (options.size, options.size),
    }
}

/// Format d'image demandé au modèle : celui de la liste des modèles d'image le plus proche
/// des proportions de la texture.
pub fn aspect_ratio(width: u32, height: u32) -> &'static str {
    const RATIOS: [(&str, f64); 10] = [
        ("1:1", 1.0),
        ("2:3", 2.0 / 3.0),
        ("3:2", 1.5),
        ("3:4", 0.75),
        ("4:3", 4.0 / 3.0),
        ("4:5", 0.8),
        ("5:4", 1.25),
        ("9:16", 9.0 / 16.0),
        ("16:9", 16.0 / 9.0),
        ("21:9", 21.0 / 9.0),
    ];
    let wanted = (f64::from(width.max(1)) / f64::from(height.max(1))).ln();
    RATIOS
        .iter()
        .min_by(|a, b| {
            (a.1.ln() - wanted)
                .abs()
                .total_cmp(&(b.1.ln() - wanted).abs())
        })
        .map_or("1:1", |(name, _)| name)
}

/// Texture convertie, et ce que la conversion a corrigé.
pub struct Converted {
    pub raster: Raster,
    /// Qualité du raccord (0 à 100), textures pleines seulement.
    pub seam: Option<u8>,
    pub notes: Vec<String>,
}

/// Image source → texture de `options.size` pixels de côté (ou `width` × `height`).
#[cfg(test)]
pub fn convert(source: &Raster, options: &PixelOptions) -> AppResult<Raster> {
    Ok(convert_full(source, options)?.raster)
}

pub fn convert_full(source: &Raster, options: &PixelOptions) -> AppResult<Converted> {
    validate(options)?;
    let (width, height) = output_size(options);
    let mut notes = Vec::new();
    let mut work = match options.crop {
        Some(zone) => shrink_to(&crop(source, zone)?, WORK_SIDE),
        None => shrink_to(source, WORK_SIDE),
    };
    // Place gardée autour de l'objet pour son contour.
    let outline = options.outline && options.transparent && width > 4 && height > 4;
    let (inner_w, inner_h) = if outline {
        (width - 2, height - 2)
    } else {
        (width, height)
    };
    let framed = if options.transparent {
        remove_background(&mut work);
        pad_to(&crop_to_content(&work), inner_w, inner_h)
    } else {
        let trimmed = if options.tiling != Tiling::None {
            let (trimmed, removed) = trim_frame(&work);
            if removed > 0 {
                notes.push("Cadre uni ajouté par le modèle retiré.".to_string());
            }
            trimmed
        } else {
            work
        };
        let cropped = cover_crop(&trimmed, width, height);
        match options.tiling {
            Tiling::None => cropped,
            tiling => {
                notes.push(
                    match tiling {
                        Tiling::Horizontal => {
                            "Bords gauche et droit fondus : la texture se raccorde côte à côte."
                        }
                        _ => "Bords fondus : la texture se raccorde dans les deux sens.",
                    }
                    .to_string(),
                );
                make_seamless(&cropped, tiling == Tiling::Both)
            }
        }
    };
    let mut out = downscale(&framed, inner_w, inner_h, options.transparent);
    if outline {
        out = add_outline(&out);
    }
    if options.colors > 0 {
        quantize(&mut out, options.colors as usize);
    }
    let seam =
        (!options.transparent).then(|| seam_quality(&out, options.tiling != Tiling::Horizontal));
    if options.atlas {
        out = place_on_canvas(&out, GUI_MAX, GUI_MAX, 0);
    }
    Ok(Converted {
        raster: out,
        seam,
        notes,
    })
}

/// Zone choisie de l'image (ramenée dans ses limites).
fn crop(source: &Raster, zone: CropRect) -> AppResult<Raster> {
    let x = zone.x.min(source.width.saturating_sub(1));
    let y = zone.y.min(source.height.saturating_sub(1));
    let width = zone.width.min(source.width - x);
    let height = zone.height.min(source.height - y);
    if width < 2 || height < 2 {
        return Err(AppError::invalid(
            "Zone trop petite : sélectionnez au moins 2 × 2 pixels de l'image.",
        ));
    }
    let mut out = Raster::new(width, height);
    for row in 0..height {
        for column in 0..width {
            out.put(column, row, source.at(x + column, y + row));
        }
    }
    Ok(out)
}

/// Agrandit sans lisser (chaque pixel devient un carré) jusqu'à au moins `side`.
pub fn upscale_to(source: &Raster, side: u32) -> Raster {
    let factor = side.div_ceil(source.width.max(1)).max(1);
    if factor == 1 {
        return source.clone();
    }
    let mut out = Raster::new(source.width * factor, source.height * factor);
    for y in 0..out.height {
        for x in 0..out.width {
            out.put(x, y, source.at(x / factor, y / factor));
        }
    }
    out
}

/// Réduction par moyenne d'un facteur entier, tant que l'image dépasse `side`.
fn shrink_to(source: &Raster, side: u32) -> Raster {
    let largest = source.width.max(source.height);
    if largest <= side {
        return source.clone();
    }
    let factor = largest.div_ceil(side);
    let (width, height) = (
        (source.width / factor).max(1),
        (source.height / factor).max(1),
    );
    let mut out = Raster::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0u32; 4];
            for dy in 0..factor {
                for dx in 0..factor {
                    let p = source.at(x * factor + dx, y * factor + dy);
                    for (s, v) in sum.iter_mut().zip(p) {
                        *s += u32::from(v);
                    }
                }
            }
            let n = factor * factor;
            out.put(x, y, sum.map(|s| (s / n) as u8));
        }
    }
    out
}

/// Part minimale d'une zone pour qu'une couleur rare l'emporte sur la dominante (%).
const SALIENT_SHARE: u32 = 12;

/// Case de couleur : 8 niveaux par canal (512 cases).
fn bucket(p: [u8; 4]) -> u16 {
    (u16::from(p[0] >> 5) << 6) | (u16::from(p[1] >> 5) << 3) | u16::from(p[2] >> 5)
}

/// Pixels comptés par case de couleur, avec la somme de leurs couleurs.
#[derive(Default)]
struct Histogram {
    buckets: BTreeMap<u16, (u32, [u32; 3])>,
    total: u32,
}

impl Histogram {
    fn of(pixels: impl Iterator<Item = [u8; 4]>) -> Self {
        let mut histogram = Self::default();
        for p in pixels {
            let entry = histogram.buckets.entry(bucket(p)).or_insert((0, [0; 3]));
            entry.0 += 1;
            for (total, value) in entry.1.iter_mut().zip(p) {
                *total += u32::from(value);
            }
            histogram.total += 1;
        }
        histogram
    }

    fn mean((count, sum): &(u32, [u32; 3])) -> [u8; 4] {
        [
            (sum[0] / count) as u8,
            (sum[1] / count) as u8,
            (sum[2] / count) as u8,
            255,
        ]
    }

    fn share(&self, key: u16) -> f64 {
        let count = self.buckets.get(&key).map_or(0, |entry| entry.0);
        f64::from(count) / f64::from(self.total.max(1))
    }

    /// Couleur la plus fréquente, moyennée dans sa case. À égalité, la plus petite case :
    /// le résultat ne dépend pas de l'ordre de lecture.
    fn dominant(&self) -> Option<[u8; 4]> {
        self.buckets
            .iter()
            .max_by(|a, b| a.1 .0.cmp(&b.1 .0).then(b.0.cmp(a.0)))
            .map(|(_, entry)| Self::mean(entry))
    }

    /// Couleur d'une zone : parmi celles qui en couvrent une part notable, la plus rare
    /// dans l'image entière. Les petits détails (éclats d'un minerai, contour, reflet)
    /// survivent ainsi à la réduction au lieu d'être noyés par la couleur de fond.
    fn salient(&self, image: &Histogram) -> Option<[u8; 4]> {
        self.buckets
            .iter()
            .filter(|(_, entry)| entry.0 * 100 >= self.total * SALIENT_SHARE)
            .map(|(key, entry)| {
                let here = f64::from(entry.0) / f64::from(self.total.max(1));
                (*key, entry, here / image.share(*key).max(1e-6))
            })
            .max_by(|a, b| a.2.total_cmp(&b.2).then(b.0.cmp(&a.0)))
            .map(|(_, entry, _)| Self::mean(entry))
            .or_else(|| self.dominant())
    }
}

fn dominant(pixels: impl Iterator<Item = [u8; 4]>) -> Option<[u8; 4]> {
    Histogram::of(pixels).dominant()
}

fn border(raster: &Raster) -> Vec<(u32, u32)> {
    let (w, h) = (raster.width, raster.height);
    let mut cells = Vec::new();
    for x in 0..w {
        cells.push((x, 0));
        if h > 1 {
            cells.push((x, h - 1));
        }
    }
    for y in 1..h.saturating_sub(1) {
        cells.push((0, y));
        if w > 1 {
            cells.push((w - 1, y));
        }
    }
    cells
}

/// Rend transparent le fond uni (ou en léger dégradé) qui touche les bords.
fn remove_background(raster: &mut Raster) {
    let edge = border(raster);
    let transparent = edge
        .iter()
        .filter(|&&(x, y)| raster.at(x, y)[3] < 128)
        .count();
    // Image déjà détourée : son canal alpha fait foi.
    if transparent * 2 > edge.len() {
        return;
    }
    let Some(background) = dominant(edge.iter().map(|&(x, y)| raster.at(x, y))) else {
        return;
    };

    let (w, h) = (raster.width, raster.height);
    let mut removed = vec![false; (w * h) as usize];
    let mut queue = VecDeque::new();
    for &(x, y) in &edge {
        let index = (y * w + x) as usize;
        if !removed[index] && distance(raster.at(x, y), background) <= SEED_TOLERANCE {
            removed[index] = true;
            queue.push_back((x, y));
        }
    }
    while let Some((x, y)) = queue.pop_front() {
        let here = raster.at(x, y);
        let neighbours = [
            (x.wrapping_sub(1), y),
            (x + 1, y),
            (x, y.wrapping_sub(1)),
            (x, y + 1),
        ];
        for (nx, ny) in neighbours {
            if nx >= w || ny >= h {
                continue;
            }
            let index = (ny * w + nx) as usize;
            if removed[index] {
                continue;
            }
            let color = raster.at(nx, ny);
            if distance(color, here) <= STEP_TOLERANCE
                && distance(color, background) <= REACH_TOLERANCE
            {
                removed[index] = true;
                queue.push_back((nx, ny));
            }
        }
    }

    // Liseré : pixels de bordure encore teintés par le fond (anticrénelage).
    let mut fringe = Vec::new();
    for y in 0..h {
        for x in 0..w {
            let index = (y * w + x) as usize;
            if removed[index] || distance(raster.at(x, y), background) > FRINGE_TOLERANCE {
                continue;
            }
            let touches = [
                (x.wrapping_sub(1), y),
                (x + 1, y),
                (x, y.wrapping_sub(1)),
                (x, y + 1),
            ]
            .iter()
            .any(|&(nx, ny)| nx < w && ny < h && removed[(ny * w + nx) as usize]);
            if touches {
                fringe.push(index);
            }
        }
    }
    for index in fringe {
        removed[index] = true;
    }

    for (pixel, gone) in raster.px.iter_mut().zip(removed) {
        if gone {
            *pixel = [0, 0, 0, 0];
        }
    }
}

/// Rectangle englobant les pixels visibles ; l'image entière si rien n'est visible.
fn crop_to_content(raster: &Raster) -> Raster {
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for y in 0..raster.height {
        for x in 0..raster.width {
            if raster.at(x, y)[3] >= 128 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x0 == u32::MAX {
        return raster.clone();
    }
    let mut out = Raster::new(x1 - x0 + 1, y1 - y0 + 1);
    for y in 0..out.height {
        for x in 0..out.width {
            out.put(x, y, raster.at(x0 + x, y0 + y));
        }
    }
    out
}

/// Centre l'objet dans une toile transparente aux proportions de la texture, avec un
/// demi-pixel de marge finale.
fn pad_to(raster: &Raster, width: u32, height: u32) -> Raster {
    let (canvas_w, canvas_h) = if width == height {
        let side = raster.width.max(raster.height);
        let side = side + side.div_ceil(width);
        (side, side)
    } else {
        // Pixels de la source par pixel final, marge d'un pixel final comprise.
        let scale = (f64::from(raster.width) / f64::from(width))
            .max(f64::from(raster.height) / f64::from(height))
            * (1.0 + 1.0 / f64::from(width.min(height)));
        (
            ((f64::from(width) * scale).ceil() as u32).max(raster.width),
            ((f64::from(height) * scale).ceil() as u32).max(raster.height),
        )
    };
    let mut out = Raster::new(canvas_w, canvas_h);
    let (ox, oy) = (
        (canvas_w - raster.width) / 2,
        (canvas_h - raster.height) / 2,
    );
    for y in 0..raster.height {
        for x in 0..raster.width {
            out.put(ox + x, oy + y, raster.at(x, y));
        }
    }
    out
}

/// Plus grand rectangle central aux proportions de la texture (elle remplit toute la case).
fn cover_crop(raster: &Raster, width: u32, height: u32) -> Raster {
    let (w, h) = (u64::from(raster.width), u64::from(raster.height));
    let (tw, th) = (u64::from(width), u64::from(height));
    let (crop_w, crop_h) = if w * th > h * tw {
        ((h * tw / th).max(1), h)
    } else {
        (w, (w * th / tw).max(1))
    };
    let (crop_w, crop_h) = (crop_w as u32, crop_h as u32);
    let (ox, oy) = ((raster.width - crop_w) / 2, (raster.height - crop_h) / 2);
    let mut out = Raster::new(crop_w, crop_h);
    for y in 0..crop_h {
        for x in 0..crop_w {
            out.put(x, y, raster.at(ox + x, oy + y));
        }
    }
    out
}

/// Écart maximal à la moyenne pour qu'une ligne passe pour unie.
const FRAME_SPREAD: u32 = 30 * 30;
/// Écart maximal entre les lignes d'un même cadre (un dégradé n'est pas un cadre).
const FRAME_RUN: u32 = 12 * 12;
/// Écart minimal entre le cadre et la texture qu'il entoure.
const FRAME_CONTRAST: u32 = 26 * 26;

fn mean(pixels: &[[u8; 4]]) -> [u8; 4] {
    let n = pixels.len().max(1) as u32;
    let sum = pixels.iter().fold([0u32; 3], |mut acc, p| {
        for (total, value) in acc.iter_mut().zip(p) {
            *total += u32::from(*value);
        }
        acc
    });
    [
        (sum[0] / n) as u8,
        (sum[1] / n) as u8,
        (sum[2] / n) as u8,
        255,
    ]
}

/// Retire le cadre uni (bordure, fond autour d'une tuile) que les modèles d'image dessinent
/// souvent autour d'une texture : chaque bord perd ses lignes unies qui tranchent avec
/// l'intérieur, jusqu'à 15 % de la taille. Renvoie l'image et le nombre de lignes retirées.
fn trim_frame(raster: &Raster) -> (Raster, u32) {
    let (w, h) = (raster.width, raster.height);
    if w < 16 || h < 16 {
        return (raster.clone(), 0);
    }
    // (x, y) de la ligne `k` depuis un bord, horizontale ou verticale.
    let line = |side: u8, k: u32| -> Vec<[u8; 4]> {
        match side {
            0 => (0..w).map(|x| raster.at(x, k)).collect(),
            1 => (0..w).map(|x| raster.at(x, h - 1 - k)).collect(),
            2 => (0..h).map(|y| raster.at(k, y)).collect(),
            _ => (0..h).map(|y| raster.at(w - 1 - k, y)).collect(),
        }
    };
    let uniform = |pixels: &[[u8; 4]]| -> Option<[u8; 4]> {
        let average = mean(pixels);
        pixels
            .iter()
            .all(|p| distance(*p, average) <= FRAME_SPREAD)
            .then_some(average)
    };
    let mut cut = [0u32; 4];
    for (side, cut) in cut.iter_mut().enumerate() {
        let side = side as u8;
        let depth = if side < 2 { h } else { w };
        let limit = depth * 15 / 100;
        let Some(frame) = uniform(&line(side, 0)) else {
            continue;
        };
        // Lignes unies de la couleur du bord : l'épaisseur du cadre.
        let mut k = 1;
        while k < limit {
            match uniform(&line(side, k)) {
                Some(color) if distance(color, frame) <= FRAME_RUN => k += 1,
                _ => break,
            }
        }
        // Trop épais : c'est la texture elle-même (aplat), pas un cadre.
        if k >= limit {
            continue;
        }
        // Un cadre tranche avec ce qu'il entoure (la ligne d'après, souvent adoucie, est
        // retirée avec lui).
        let inside = mean(&line(side, (k + 1).min(depth - 1)));
        if distance(frame, inside) >= FRAME_CONTRAST {
            *cut = k + 1;
        }
    }
    let [top, bottom, left, right] = cut;
    if top + bottom + left + right == 0 {
        return (raster.clone(), 0);
    }
    let (nw, nh) = (w - left - right, h - top - bottom);
    let mut out = Raster::new(nw, nh);
    for y in 0..nh {
        for x in 0..nw {
            out.put(x, y, raster.at(left + x, top + y));
        }
    }
    (out, top + bottom + left + right)
}

/// Part de la largeur (depuis chaque bord) sur laquelle la texture est fondue avec sa
/// copie décalée d'une demi-largeur.
const SEAM_BAND: f64 = 0.3;

fn blend(a: [u8; 4], b: [u8; 4], weight_a: f64) -> [u8; 4] {
    let mix =
        |i: usize| (f64::from(a[i]) * weight_a + f64::from(b[i]) * (1.0 - weight_a)).round() as u8;
    [mix(0), mix(1), mix(2), mix(3)]
}

/// Poids de l'image d'origine : 1 au centre, 0 sur les bords, transition douce.
fn seam_weight(position: u32, length: u32) -> f64 {
    if length < 2 {
        return 1.0;
    }
    let t = 1.0 - (2.0 * f64::from(position) / f64::from(length - 1) - 1.0).abs();
    let x = (t / (2.0 * SEAM_BAND)).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// Rend l'image raccordable : près de chaque bord, elle est fondue avec sa copie décalée
/// d'une demi-largeur (puis d'une demi-hauteur si `vertical`). Sur les bords, c'est la copie
/// décalée qui s'affiche, dont les pixels opposés sont voisins dans l'image : répétée, la
/// texture ne montre plus de coupure. Le centre reste l'image d'origine.
fn make_seamless(raster: &Raster, vertical: bool) -> Raster {
    let (w, h) = (raster.width, raster.height);
    let mut across = Raster::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let shifted = raster.at((x + w / 2) % w, y);
            across.put(x, y, blend(raster.at(x, y), shifted, seam_weight(x, w)));
        }
    }
    if !vertical {
        return across;
    }
    let mut out = Raster::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let shifted = across.at(x, (y + h / 2) % h);
            out.put(x, y, blend(across.at(x, y), shifted, seam_weight(y, h)));
        }
    }
    out
}

fn gap(a: [u8; 4], b: [u8; 4]) -> f64 {
    f64::from(distance(a, b)).sqrt()
}

/// Qualité du raccord (0 à 100) : écart moyen entre bords opposés (gauche-droite, et
/// haut-bas si `vertical`), comparé à l'écart moyen entre pixels voisins à l'intérieur.
pub fn seam_quality(raster: &Raster, vertical: bool) -> u8 {
    let (w, h) = (raster.width, raster.height);
    if w < 2 || h < 2 {
        return 100;
    }
    let mut inside = (0.0, 0u32);
    for y in 0..h {
        for x in 0..w {
            if x + 1 < w {
                inside.0 += gap(raster.at(x, y), raster.at(x + 1, y));
                inside.1 += 1;
            }
            if y + 1 < h {
                inside.0 += gap(raster.at(x, y), raster.at(x, y + 1));
                inside.1 += 1;
            }
        }
    }
    let mut wrap = (0.0, 0u32);
    for y in 0..h {
        wrap.0 += gap(raster.at(w - 1, y), raster.at(0, y));
        wrap.1 += 1;
    }
    if vertical {
        for x in 0..w {
            wrap.0 += gap(raster.at(x, h - 1), raster.at(x, 0));
            wrap.1 += 1;
        }
    }
    let inside = inside.0 / f64::from(inside.1.max(1));
    let wrap = wrap.0 / f64::from(wrap.1.max(1));
    ((100.0 * (inside + 6.0) / (wrap + 6.0)).min(100.0)).round() as u8
}

/// Contour d'un pixel autour de l'objet, dans une teinte sombre de sa bordure.
fn add_outline(inner: &Raster) -> Raster {
    let mut out = place_on_canvas(inner, inner.width + 2, inner.height + 2, 1);
    let source = out.clone();
    for y in 0..out.height {
        for x in 0..out.width {
            if source.at(x, y)[3] > 0 {
                continue;
            }
            let neighbours: Vec<[u8; 4]> = [
                (x.wrapping_sub(1), y),
                (x + 1, y),
                (x, y.wrapping_sub(1)),
                (x, y + 1),
            ]
            .iter()
            .filter(|&&(nx, ny)| nx < out.width && ny < out.height)
            .map(|&(nx, ny)| source.at(nx, ny))
            .filter(|p| p[3] > 0)
            .collect();
            if neighbours.is_empty() {
                continue;
            }
            let edge = mean(&neighbours);
            out.put(
                x,
                y,
                [
                    (f64::from(edge[0]) * 0.35) as u8,
                    (f64::from(edge[1]) * 0.35) as u8,
                    (f64::from(edge[2]) * 0.35) as u8,
                    255,
                ],
            );
        }
    }
    out
}

/// Pose l'image sur une toile transparente, à `offset` pixels du coin haut gauche.
pub fn place_on_canvas(raster: &Raster, width: u32, height: u32, offset: u32) -> Raster {
    let mut out = Raster::new(width, height);
    for y in 0..raster.height.min(height.saturating_sub(offset)) {
        for x in 0..raster.width.min(width.saturating_sub(offset)) {
            out.put(offset + x, offset + y, raster.at(x, y));
        }
    }
    out
}

/// Chaque pixel final prend une couleur franche de sa zone (voir [`Histogram::salient`]) :
/// des aplats nets, comme du pixel-art, au lieu d'une moyenne boueuse. Transparence tout
/// ou rien.
fn downscale(raster: &Raster, width: u32, height: u32, transparent: bool) -> Raster {
    let visible = |p: &[u8; 4]| !transparent || p[3] >= 128;
    let image = Histogram::of(raster.px.iter().copied().filter(visible));
    let mut out = Raster::new(width, height);
    let (w, h) = (raster.width, raster.height);
    for ty in 0..height {
        let y0 = ty * h / height;
        let y1 = ((ty + 1) * h / height).max(y0 + 1).min(h);
        for tx in 0..width {
            let x0 = tx * w / width;
            let x1 = ((tx + 1) * w / width).max(x0 + 1).min(w);
            let total = (x1 - x0) * (y1 - y0);
            let zone = Histogram::of(
                (y0..y1)
                    .flat_map(|y| (x0..x1).map(move |x| (x, y)))
                    .map(|(x, y)| raster.at(x, y))
                    .filter(visible),
            );
            let color = if transparent && zone.total * 2 < total {
                [0, 0, 0, 0]
            } else {
                zone.salient(&image).unwrap_or([0, 0, 0, 0])
            };
            out.put(tx, ty, color);
        }
    }
    out
}

/// Palette de `colors` teintes au plus (coupe médiane), chaque pixel ramené à la plus proche.
fn quantize(raster: &mut Raster, colors: usize) {
    let visible: Vec<[u8; 4]> = raster.px.iter().copied().filter(|p| p[3] > 0).collect();
    let mut distinct = visible.clone();
    distinct.sort_unstable();
    distinct.dedup();
    if distinct.len() <= colors {
        return;
    }

    let mut boxes: Vec<Vec<[u8; 4]>> = vec![visible];
    while boxes.len() < colors {
        let widest = boxes
            .iter()
            .enumerate()
            .filter(|(_, b)| b.len() > 1)
            .map(|(i, b)| {
                let (channel, range) = widest_channel(b);
                (i, channel, range)
            })
            .filter(|&(_, _, range)| range > 0)
            .max_by(|a, b| a.2.cmp(&b.2).then(b.0.cmp(&a.0)));
        let Some((index, channel, _)) = widest else {
            break;
        };
        let mut split = boxes.swap_remove(index);
        split.sort_by_key(|p| (p[channel], p[0], p[1], p[2]));
        let upper = split.split_off(split.len() / 2);
        boxes.push(split);
        boxes.push(upper);
    }

    let palette: Vec<[u8; 4]> = boxes
        .iter()
        .filter(|b| !b.is_empty())
        .map(|b| {
            let n = b.len() as u32;
            let sum = b.iter().fold([0u32; 3], |mut acc, p| {
                for (total, value) in acc.iter_mut().zip(p) {
                    *total += u32::from(*value);
                }
                acc
            });
            [
                (sum[0] / n) as u8,
                (sum[1] / n) as u8,
                (sum[2] / n) as u8,
                255,
            ]
        })
        .collect();

    for pixel in raster.px.iter_mut().filter(|p| p[3] > 0) {
        if let Some(nearest) = palette
            .iter()
            .min_by_key(|candidate| distance(**candidate, *pixel))
        {
            *pixel = [nearest[0], nearest[1], nearest[2], pixel[3]];
        }
    }
}

fn widest_channel(pixels: &[[u8; 4]]) -> (usize, u8) {
    (0..3)
        .map(|channel| {
            let (low, high) = pixels.iter().fold((u8::MAX, 0u8), |(lo, hi), p| {
                (lo.min(p[channel]), hi.max(p[channel]))
            });
            (channel, high.saturating_sub(low))
        })
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
        .unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHITE: [u8; 4] = [255, 255, 255, 255];
    const RED: [u8; 4] = [200, 30, 40, 255];

    /// Disque rouge sur fond blanc (dégradé léger), avec un liseré rose d'anticrénelage.
    fn disc(side: u32, gradient: bool) -> Raster {
        let mut raster = Raster::new(side, side);
        let (c, r) = (side as f32 / 2.0, side as f32 * 0.3);
        for y in 0..side {
            for x in 0..side {
                let d = ((x as f32 - c).powi(2) + (y as f32 - c).powi(2)).sqrt();
                let shade = if gradient { (y * 30 / side) as u8 } else { 0 };
                let color = if d <= r {
                    RED
                } else if d <= r + 1.5 {
                    [240, 170, 170, 255]
                } else {
                    [255 - shade, 255 - shade, 255 - shade, 255]
                };
                raster.put(x, y, color);
            }
        }
        raster
    }

    fn opts(size: u32, colors: u32, transparent: bool) -> PixelOptions {
        PixelOptions {
            size,
            colors,
            transparent,
            tiling: Tiling::None,
            outline: false,
            width: None,
            height: None,
            atlas: false,
            crop: None,
        }
    }

    fn distinct(raster: &Raster) -> usize {
        let mut colors: Vec<[u8; 4]> = raster.px.iter().copied().filter(|p| p[3] > 0).collect();
        colors.sort_unstable();
        colors.dedup();
        colors.len()
    }

    #[test]
    fn an_object_on_a_plain_background_becomes_a_clean_sprite() {
        for gradient in [false, true] {
            let out = convert(&disc(512, gradient), &opts(16, 8, true)).unwrap();
            assert_eq!((out.width, out.height), (16, 16));
            for (x, y) in [(0, 0), (15, 0), (0, 15), (15, 15)] {
                assert_eq!(out.at(x, y)[3], 0, "coin ({x},{y}) transparent");
            }
            // Cadré : le disque occupe presque toute la largeur.
            let row: Vec<bool> = (0..16).map(|x| out.at(x, 8)[3] == 255).collect();
            assert!(row.iter().filter(|v| **v).count() >= 13, "{row:?}");
            let center = out.at(8, 8);
            assert!(distance(center, RED) < 20 * 20, "centre rouge : {center:?}");
            // Plus aucune trace du fond blanc.
            assert!(out
                .px
                .iter()
                .all(|p| p[3] == 0 || distance(*p, WHITE) > 90 * 90));
        }
    }

    #[test]
    fn small_rare_details_survive_the_reduction() {
        // Pierre grise, éclats rouges de 12 px posés à cheval sur quatre zones de 16 px.
        let mut ore = Raster::new(256, 256);
        for y in 0..256 {
            for x in 0..256 {
                let grain = ((x * 7 + y * 13) % 11) as u8;
                ore.put(x, y, [118 + grain, 118 + grain, 122 + grain, 255]);
            }
        }
        for (cx, cy) in [(48, 48), (144, 80), (208, 176), (80, 208)] {
            for y in cy - 6..cy + 6 {
                for x in cx - 6..cx + 6 {
                    ore.put(x, y, RED);
                }
            }
        }
        let out = convert(&ore, &opts(16, 16, false)).unwrap();
        let red = out
            .px
            .iter()
            .filter(|p| distance(**p, RED) < 30 * 30)
            .count();
        assert!((4..=16).contains(&red), "{red} pixels rouges");
    }

    #[test]
    fn a_block_texture_fills_the_whole_tile() {
        let out = convert(&disc(300, false), &opts(32, 0, false)).unwrap();
        assert_eq!((out.width, out.height), (32, 32));
        assert!(out.px.iter().all(|p| p[3] == 255));
        assert_eq!(out.at(0, 0), WHITE);
    }

    #[test]
    fn an_already_transparent_image_keeps_its_alpha() {
        let mut source = Raster::new(64, 64);
        for y in 16..48 {
            for x in 16..48 {
                source.put(x, y, [250, 250, 250, 255]);
            }
        }
        let out = convert(&source, &opts(16, 0, true)).unwrap();
        // Le carré presque blanc n'est pas pris pour du fond.
        assert_eq!(out.at(8, 8), [250, 250, 250, 255]);
        assert_eq!(out.at(0, 0)[3], 0);
    }

    #[test]
    fn the_palette_is_limited() {
        let mut source = Raster::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                source.put(x, y, [(x * 4) as u8, (y * 4) as u8, 128, 255]);
            }
        }
        for colors in [2, 4, 16] {
            let out = convert(&source, &opts(16, colors, false)).unwrap();
            assert!(distinct(&out) <= colors as usize, "{colors} couleurs");
            assert!(distinct(&out) >= 2);
        }
        assert!(distinct(&convert(&source, &opts(16, 0, false)).unwrap()) > 16);
    }

    #[test]
    fn conversion_is_deterministic_and_round_trips_through_png() {
        let source = disc(200, true);
        let a = convert(&source, &opts(16, 16, true))
            .unwrap()
            .png()
            .unwrap();
        let b = convert(&source, &opts(16, 16, true))
            .unwrap()
            .png()
            .unwrap();
        assert_eq!(a, b);
        let decoded = decode(&a).unwrap();
        assert_eq!((decoded.width, decoded.height), (16, 16));
        assert_eq!(extension_of(&a), Some("png"));
    }

    #[test]
    fn bad_inputs_are_refused() {
        assert!(decode(b"pas une image").is_err());
        assert!(convert(&disc(32, false), &opts(24, 0, true)).is_err());
        assert!(convert(&disc(32, false), &opts(16, 1, true)).is_err());
        // Trop large : refusé à la lecture de l'en-tête, avant toute allocation.
        let wide = Raster::new(MAX_SIDE + 1, 1).png().unwrap();
        assert!(decode(&wide).is_err());
    }

    /// Pierre ondulée, plus claire à droite qu'à gauche : ne se raccorde pas telle quelle.
    /// `frame` : cadre noir de cette épaisseur autour.
    fn stone(side: u32, frame: u32) -> Raster {
        let mut raster = Raster::new(side, side);
        for y in 0..side {
            for x in 0..side {
                let color = if x < frame || y < frame || x >= side - frame || y >= side - frame {
                    [10, 10, 10, 255]
                } else {
                    let (fx, fy) = (x as f32, y as f32);
                    let v = 100.0
                        + 30.0 * (fx * 0.05).sin() * (fy * 0.07).cos()
                        + fx * 0.25
                        + ((x * 7 + y * 13) % 9) as f32;
                    let v = v.clamp(0.0, 255.0) as u8;
                    [v, v, v.saturating_add(8), 255]
                };
                raster.put(x, y, color);
            }
        }
        raster
    }

    fn tiled(tiling: Tiling) -> PixelOptions {
        PixelOptions {
            tiling,
            ..opts(16, 0, false)
        }
    }

    #[test]
    fn a_tiling_face_connects_at_the_edges() {
        let source = stone(300, 0);
        let plain = convert_full(&source, &opts(16, 0, false)).unwrap();
        let both = convert_full(&source, &tiled(Tiling::Both)).unwrap();
        let (before, after) = (plain.seam.unwrap(), both.seam.unwrap());
        assert!(before < 60 && after >= 75, "raccord {before} → {after}");
        assert!(both.notes.iter().any(|n| n.contains("deux sens")));

        // En largeur seulement : gauche-droite raccordés, haut et bas laissés tels quels.
        let across = convert_full(&source, &tiled(Tiling::Horizontal)).unwrap();
        assert!(across.notes.iter().any(|n| n.contains("gauche et droit")));
        assert!(across.seam.unwrap() >= 75, "{:?}", across.seam);
    }

    #[test]
    fn the_frame_drawn_by_a_model_is_removed() {
        let framed = stone(320, 20);
        let plain = convert_full(&framed, &opts(16, 0, false)).unwrap();
        assert!(
            plain.raster.at(0, 0)[0] < 30,
            "sans raccord : image intacte"
        );
        let both = convert_full(&framed, &tiled(Tiling::Both)).unwrap();
        assert!(both.raster.px.iter().all(|p| p[0] > 60), "cadre retiré");
        assert!(both.notes.iter().any(|n| n.contains("Cadre")));
        // Un dégradé régulier n'est pas pris pour un cadre.
        let unframed = convert_full(&stone(320, 0), &tiled(Tiling::Both)).unwrap();
        assert!(!unframed.notes.iter().any(|n| n.contains("Cadre")));
    }

    #[test]
    fn items_get_an_outline_and_gui_elements_their_own_size() {
        let outlined = PixelOptions {
            outline: true,
            ..opts(16, 8, true)
        };
        let out = convert(&disc(256, false), &outlined).unwrap();
        assert_eq!((out.width, out.height), (16, 16));
        // Premier pixel visible de la ligne du milieu : le contour, bien plus sombre.
        let edge = (0..16).map(|x| out.at(x, 8)).find(|p| p[3] > 0).unwrap();
        assert!(edge[0] < 100, "contour sombre : {edge:?}");

        let button = PixelOptions {
            width: Some(200),
            height: Some(20),
            ..opts(16, 0, false)
        };
        let out = convert(&disc(300, false), &button).unwrap();
        assert_eq!((out.width, out.height), (200, 20));
        let panel = PixelOptions {
            width: Some(176),
            height: Some(166),
            atlas: true,
            ..opts(16, 0, false)
        };
        let out = convert(&disc(300, false), &panel).unwrap();
        assert_eq!((out.width, out.height), (256, 256));
        assert_eq!(out.at(200, 200)[3], 0, "hors de l'élément : transparent");
        assert_eq!(out.at(10, 10)[3], 255);

        assert!(validate(&PixelOptions {
            width: Some(300),
            height: Some(20),
            ..opts(16, 0, false)
        })
        .is_err());
        assert!(validate(&PixelOptions {
            width: Some(30),
            height: None,
            ..opts(16, 0, false)
        })
        .is_err());
        assert!(validate(&PixelOptions {
            atlas: true,
            ..opts(16, 0, false)
        })
        .is_err());
        assert_eq!(aspect_ratio(16, 16), "1:1");
        assert_eq!(aspect_ratio(200, 20), "21:9");
        assert_eq!(aspect_ratio(176, 166), "1:1");
        assert_eq!(aspect_ratio(24, 17), "4:3");
    }

    #[test]
    fn a_chosen_zone_becomes_the_texture() {
        // Moitié gauche rouge, moitié droite bleue : la zone de droite donne du bleu.
        let mut source = Raster::new(200, 100);
        for y in 0..100 {
            for x in 0..200 {
                source.put(x, y, if x < 100 { RED } else { [20, 60, 220, 255] });
            }
        }
        let right = PixelOptions {
            crop: Some(CropRect {
                x: 110,
                y: 10,
                width: 80,
                height: 80,
            }),
            ..opts(16, 0, false)
        };
        let out = convert(&source, &right).unwrap();
        assert!(out.px.iter().all(|p| p[2] > 200), "que du bleu");
        // Zone qui déborde : ramenée dans l'image ; zone vide : refusée.
        let over = PixelOptions {
            crop: Some(CropRect {
                x: 150,
                y: 50,
                width: 500,
                height: 500,
            }),
            ..opts(16, 0, false)
        };
        assert!(convert(&source, &over).is_ok());
        let tiny = PixelOptions {
            crop: Some(CropRect {
                x: 199,
                y: 99,
                width: 1,
                height: 1,
            }),
            ..opts(16, 0, false)
        };
        assert!(convert(&source, &tiny).is_err());
    }

    #[test]
    fn icons_are_enlarged_without_smoothing() {
        let mut small = Raster::new(16, 16);
        small.put(0, 0, RED);
        let big = upscale_to(&small, 64);
        assert_eq!((big.width, big.height), (64, 64));
        assert_eq!(big.at(3, 3), RED);
        assert_eq!(big.at(4, 4), [0, 0, 0, 0]);
    }
}
