//! Traitements faits sur la machine, sans aucun envoi : décodage, recadrage, redimensionnement,
//! rotation, réglages, masques, fusion, détourage d'une couleur, conversion de format.
//! Toutes les fonctions sont pures (image en entrée, image en sortie) et testées.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::{self, FilterType};
use image::{DynamicImage, GrayImage, ImageFormat, Luma, Rgba, RgbaImage};

use crate::core::imaging::http;
use crate::core::{AppError, AppResult};

use super::types::ExportFormat;

/// Plus grand côté accepté (au-delà, la mémoire d'un PC ordinaire ne suit plus).
pub const MAX_SIDE: u32 = 16384;

pub fn decode(bytes: &[u8]) -> AppResult<DynamicImage> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| AppError::invalid(format!("Image illisible : {e}")))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| AppError::invalid(format!("Image illisible : {e}")))?;
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err(AppError::invalid(format!(
            "Image trop grande ({width} × {height}) : {MAX_SIDE} pixels de côté au plus."
        )));
    }
    image::load_from_memory(bytes).map_err(|e| AppError::invalid(format!("Image illisible : {e}")))
}

/// Image reçue du frontend : base64 brut ou adresse `data:` (collage, masque, pinceau).
pub fn decode_transport(data: &str) -> AppResult<Vec<u8>> {
    let bytes = if data.trim_start().starts_with("data:") {
        http::decode_data_url(data.trim())?
    } else {
        http::decode_base64(data)?
    };
    if bytes.len() > http::MAX_IMAGE_BYTES {
        return Err(AppError::invalid("Image trop lourde (48 Mo au plus)."));
    }
    Ok(bytes)
}

pub fn png(image: &RgbaImage) -> AppResult<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|e| AppError::internal(format!("encodage PNG : {e}")))?;
    Ok(out.into_inner())
}

/// Vignette pour l'historique (côté le plus long : `side`).
pub fn thumbnail(image: &RgbaImage, side: u32) -> AppResult<Vec<u8>> {
    let (w, h) = image.dimensions();
    let scale = side as f32 / w.max(h) as f32;
    if scale >= 1.0 {
        return png(image);
    }
    let small = imageops::resize(
        image,
        ((w as f32 * scale).round() as u32).max(1),
        ((h as f32 * scale).round() as u32).max(1),
        FilterType::Triangle,
    );
    png(&small)
}

pub fn crop(image: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> AppResult<RgbaImage> {
    let (w, h) = image.dimensions();
    if width == 0 || height == 0 || x >= w || y >= h {
        return Err(AppError::invalid("Zone de recadrage vide ou hors de l'image."));
    }
    let width = width.min(w - x);
    let height = height.min(h - y);
    Ok(imageops::crop_imm(image, x, y, width, height).to_image())
}

pub fn resize(image: &RgbaImage, width: u32, height: u32) -> AppResult<RgbaImage> {
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return Err(AppError::invalid(format!("Taille invalide : de 1 à {MAX_SIDE} pixels de côté.")));
    }
    Ok(imageops::resize(image, width, height, FilterType::Lanczos3))
}

/// Agrandissement local (Lanczos) et, en option, renforcement léger des contours.
pub fn upscale(image: &RgbaImage, factor: f32, sharpen: bool) -> AppResult<RgbaImage> {
    if !(1.0..=8.0).contains(&factor) {
        return Err(AppError::invalid("Facteur d'agrandissement : de 1 à 8."));
    }
    let (w, h) = image.dimensions();
    let big = resize(image, (w as f32 * factor).round() as u32, (h as f32 * factor).round() as u32)?;
    Ok(if sharpen { imageops::unsharpen(&big, 1.2, 4) } else { big })
}

/// Rotation horaire. Les multiples de 90° sont exacts ; les autres agrandissent la toile
/// (coins transparents) avec un échantillonnage bilinéaire.
pub fn rotate(image: &RgbaImage, degrees: f32) -> RgbaImage {
    let normalized = degrees.rem_euclid(360.0);
    let exact = |d: f32| (normalized - d).abs() < 0.01;
    if exact(0.0) || exact(360.0) {
        return image.clone();
    }
    if exact(90.0) {
        return imageops::rotate90(image);
    }
    if exact(180.0) {
        return imageops::rotate180(image);
    }
    if exact(270.0) {
        return imageops::rotate270(image);
    }
    let (w, h) = (image.width() as f32, image.height() as f32);
    let angle = normalized.to_radians();
    let (sin, cos) = angle.sin_cos();
    let out_w = (w * cos.abs() + h * sin.abs()).ceil() as u32;
    let out_h = (w * sin.abs() + h * cos.abs()).ceil() as u32;
    let (cx, cy) = (w / 2.0, h / 2.0);
    let (ox, oy) = (out_w as f32 / 2.0, out_h as f32 / 2.0);
    RgbaImage::from_fn(out_w, out_h, |x, y| {
        // Point d'origine : rotation inverse autour des centres.
        let dx = x as f32 + 0.5 - ox;
        let dy = y as f32 + 0.5 - oy;
        let sx = dx * cos + dy * sin + cx - 0.5;
        let sy = -dx * sin + dy * cos + cy - 0.5;
        bilinear(image, sx, sy)
    })
}

fn bilinear(image: &RgbaImage, x: f32, y: f32) -> Rgba<u8> {
    let (w, h) = (image.width() as i64, image.height() as i64);
    if x < -1.0 || y < -1.0 || x > w as f32 || y > h as f32 {
        return Rgba([0, 0, 0, 0]);
    }
    let (x0, y0) = (x.floor() as i64, y.floor() as i64);
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let pixel = |px: i64, py: i64| -> [f32; 4] {
        if px < 0 || py < 0 || px >= w || py >= h {
            [0.0; 4]
        } else {
            let p = image.get_pixel(px as u32, py as u32).0;
            [p[0] as f32, p[1] as f32, p[2] as f32, p[3] as f32]
        }
    };
    let (a, b, c, d) = (pixel(x0, y0), pixel(x0 + 1, y0), pixel(x0, y0 + 1), pixel(x0 + 1, y0 + 1));
    let mut out = [0u8; 4];
    for i in 0..4 {
        let top = a[i] * (1.0 - fx) + b[i] * fx;
        let bottom = c[i] * (1.0 - fx) + d[i] * fx;
        out[i] = (top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0) as u8;
    }
    Rgba(out)
}

pub fn flip(image: &RgbaImage, horizontal: bool) -> RgbaImage {
    if horizontal {
        imageops::flip_horizontal(image)
    } else {
        imageops::flip_vertical(image)
    }
}

/// Luminosité (-100…100), contraste (-100…100), teinte (degrés).
pub fn adjust(image: &RgbaImage, brightness: i32, contrast: f32, hue: i32) -> RgbaImage {
    let mut out = image.clone();
    if brightness != 0 {
        out = imageops::brighten(&out, brightness.clamp(-100, 100) * 255 / 100);
    }
    if contrast.abs() > f32::EPSILON {
        out = imageops::contrast(&out, contrast.clamp(-100.0, 100.0));
    }
    if hue != 0 {
        out = imageops::huerotate(&out, hue);
    }
    out
}

/// Masque en niveaux de gris (blanc = zone choisie), mis à la taille de l'image.
pub fn mask(png_bytes: &[u8], width: u32, height: u32) -> AppResult<GrayImage> {
    let decoded = decode(png_bytes)?;
    let gray = if decoded.color().has_alpha() {
        // Un masque peint sur calque transparent : l'opacité fait foi.
        let rgba = decoded.to_rgba8();
        GrayImage::from_fn(rgba.width(), rgba.height(), |x, y| {
            let p = rgba.get_pixel(x, y).0;
            let luminance = (p[0] as u32 + p[1] as u32 + p[2] as u32) / 3;
            Luma([((luminance * p[3] as u32) / 255) as u8])
        })
    } else {
        decoded.to_luma8()
    };
    Ok(if gray.dimensions() == (width, height) {
        gray
    } else {
        imageops::resize(&gray, width, height, FilterType::Triangle)
    })
}

pub fn mask_is_empty(mask: &GrayImage) -> bool {
    !mask.pixels().any(|p| p.0[0] > 16)
}

/// Rectangle englobant la zone du masque.
pub fn mask_bounds(mask: &GrayImage) -> Option<(u32, u32, u32, u32)> {
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, p) in mask.enumerate_pixels() {
        if p.0[0] > 16 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    (x0 != u32::MAX).then(|| (x0, y0, x1 - x0 + 1, y1 - y0 + 1))
}

/// Agrandit un rectangle d'une marge (part de son plus grand côté), avec un côté minimal,
/// sans sortir de l'image : c'est le contexte envoyé au modèle autour de la zone.
pub fn with_context(rect: (u32, u32, u32, u32), margin: f32, min_side: u32, bounds: (u32, u32)) -> (u32, u32, u32, u32) {
    let (x, y, w, h) = rect;
    let pad = ((w.max(h) as f32) * margin).round() as u32;
    let want_w = (w + 2 * pad).max(min_side).min(bounds.0);
    let want_h = (h + 2 * pad).max(min_side).min(bounds.1);
    let cx = x + w / 2;
    let cy = y + h / 2;
    let left = cx.saturating_sub(want_w / 2).min(bounds.0 - want_w);
    let top = cy.saturating_sub(want_h / 2).min(bounds.1 - want_h);
    (left, top, want_w, want_h)
}

/// Adoucit le bord du masque (raccord invisible).
pub fn feather(mask: &GrayImage, radius: f32) -> GrayImage {
    if radius <= 0.0 {
        return mask.clone();
    }
    imageops::blur(mask, radius)
}

/// `base` où le masque vaut blanc est remplacé par `overlay` (mêmes dimensions). Hors du
/// masque, les pixels de `base` sont gardés à l'identique.
pub fn composite(base: &RgbaImage, overlay: &RgbaImage, mask: &GrayImage) -> RgbaImage {
    let mut out = base.clone();
    for (x, y, pixel) in out.enumerate_pixels_mut() {
        let a = mask.get_pixel(x, y).0[0] as u32;
        if a == 0 {
            continue;
        }
        let o = overlay.get_pixel(x, y).0;
        let b = pixel.0;
        let mut mixed = [0u8; 4];
        for i in 0..4 {
            mixed[i] = ((b[i] as u32 * (255 - a) + o[i] as u32 * a) / 255) as u8;
        }
        *pixel = Rgba(mixed);
    }
    out
}

/// Masque en noir et blanc, pour l'envoyer au modèle avec l'image.
pub fn mask_png(mask: &GrayImage) -> AppResult<Vec<u8>> {
    let mut out = Cursor::new(Vec::new());
    mask.write_to(&mut out, ImageFormat::Png)
        .map_err(|e| AppError::internal(format!("encodage du masque : {e}")))?;
    Ok(out.into_inner())
}

/// Place l'image sur une toile plus grande ; le nouveau pourtour est rempli de `fill`.
/// Renvoie la toile et le masque des zones nouvelles (blanc = à inventer).
pub fn extend_canvas(image: &RgbaImage, width: u32, height: u32, offset_x: u32, offset_y: u32, fill: Rgba<u8>) -> AppResult<(RgbaImage, GrayImage)> {
    let (w, h) = image.dimensions();
    if width < w || height < h || offset_x + w > width || offset_y + h > height {
        return Err(AppError::invalid("La nouvelle toile doit contenir l'image entière."));
    }
    if width > MAX_SIDE || height > MAX_SIDE {
        return Err(AppError::invalid(format!("Toile trop grande : {MAX_SIDE} pixels de côté au plus.")));
    }
    let mut canvas = RgbaImage::from_pixel(width, height, fill);
    imageops::replace(&mut canvas, image, offset_x as i64, offset_y as i64);
    let mask = GrayImage::from_fn(width, height, |x, y| {
        let inside = x >= offset_x && x < offset_x + w && y >= offset_y && y < offset_y + h;
        Luma([if inside { 0 } else { 255 }])
    });
    Ok((canvas, mask))
}

/// Flou gaussien dans (ou hors de) la zone du masque.
pub fn blur(image: &RgbaImage, sigma: f32, mask: Option<&GrayImage>, inside: bool) -> RgbaImage {
    let blurred = imageops::blur(image, sigma.clamp(0.5, 60.0));
    match mask {
        None => blurred,
        Some(mask) => {
            let soft = feather(mask, 2.0);
            let chosen = if inside {
                soft
            } else {
                GrayImage::from_fn(soft.width(), soft.height(), |x, y| Luma([255 - soft.get_pixel(x, y).0[0]]))
            };
            composite(image, &blurred, &chosen)
        }
    }
}

/// Déplace les pixels du masque de (dx, dy). Renvoie l'image et le masque de la zone quittée
/// (à combler, par l'IA ou non).
pub fn move_region(image: &RgbaImage, mask: &GrayImage, dx: i32, dy: i32) -> (RgbaImage, GrayImage) {
    let (w, h) = image.dimensions();
    let mut out = image.clone();
    let mut hole = GrayImage::new(w, h);
    for (x, y, p) in mask.enumerate_pixels() {
        if p.0[0] > 127 {
            hole.put_pixel(x, y, Luma([255]));
        }
    }
    for (x, y, p) in mask.enumerate_pixels() {
        let a = p.0[0] as u32;
        if a == 0 {
            continue;
        }
        let (tx, ty) = (x as i64 + dx as i64, y as i64 + dy as i64);
        if tx < 0 || ty < 0 || tx >= w as i64 || ty >= h as i64 {
            continue;
        }
        let (tx, ty) = (tx as u32, ty as u32);
        let src = image.get_pixel(x, y).0;
        let dst = out.get_pixel(tx, ty).0;
        let mut mixed = [0u8; 4];
        for i in 0..4 {
            mixed[i] = ((dst[i] as u32 * (255 - a) + src[i] as u32 * a) / 255) as u8;
        }
        out.put_pixel(tx, ty, Rgba(mixed));
        // La zone recouverte n'est plus un trou.
        hole.put_pixel(tx, ty, Luma([0]));
    }
    (out, hole)
}

/// Couleur dominante du pourtour (fond uni demandé au modèle pour le détourage).
pub fn border_color(image: &RgbaImage) -> [u8; 3] {
    let (w, h) = image.dimensions();
    let mut samples: Vec<[u8; 3]> = Vec::new();
    let step = ((w + h) / 400).max(1);
    for x in (0..w).step_by(step as usize) {
        for y in [0, h - 1] {
            let p = image.get_pixel(x, y).0;
            samples.push([p[0], p[1], p[2]]);
        }
    }
    for y in (0..h).step_by(step as usize) {
        for x in [0, w - 1] {
            let p = image.get_pixel(x, y).0;
            samples.push([p[0], p[1], p[2]]);
        }
    }
    let mut median = [0u8; 3];
    for (channel, slot) in median.iter_mut().enumerate() {
        let mut values: Vec<u8> = samples.iter().map(|s| s[channel]).collect();
        values.sort_unstable();
        *slot = values[values.len() / 2];
    }
    median
}

/// Rend transparente la couleur `color` (distance ≤ `tolerance`), avec un bord progressif et
/// le retrait du reflet coloré sur les contours.
pub fn chroma_key(image: &RgbaImage, color: [u8; 3], tolerance: u8) -> RgbaImage {
    let tolerance = tolerance.max(1) as f32;
    let soft = tolerance * 1.6;
    let key = [color[0] as f32, color[1] as f32, color[2] as f32];
    let mut out = image.clone();
    for pixel in out.pixels_mut() {
        let p = pixel.0;
        let rgb = [p[0] as f32, p[1] as f32, p[2] as f32];
        let distance = ((rgb[0] - key[0]).powi(2) + (rgb[1] - key[1]).powi(2) + (rgb[2] - key[2]).powi(2)).sqrt();
        if distance <= tolerance {
            *pixel = Rgba([0, 0, 0, 0]);
        } else if distance < soft {
            let keep = (distance - tolerance) / (soft - tolerance);
            // Retire la part de la couleur de fond mêlée au contour.
            let mut cleaned = [0u8; 4];
            for i in 0..3 {
                let value = (rgb[i] - key[i] * (1.0 - keep)) / keep.max(0.05);
                cleaned[i] = value.round().clamp(0.0, 255.0) as u8;
            }
            cleaned[3] = (p[3] as f32 * keep).round() as u8;
            *pixel = Rgba(cleaned);
        }
    }
    out
}

/// Aplatit la transparence sur une couleur (pour les formats sans transparence).
pub fn flatten(image: &RgbaImage, matte: [u8; 3]) -> image::RgbImage {
    image::RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let p = image.get_pixel(x, y).0;
        let a = p[3] as u32;
        let mix = |c: u8, m: u8| ((c as u32 * a + m as u32 * (255 - a)) / 255) as u8;
        image::Rgb([mix(p[0], matte[0]), mix(p[1], matte[1]), mix(p[2], matte[2])])
    })
}

pub fn has_transparency(image: &RgbaImage) -> bool {
    image.pixels().any(|p| p.0[3] < 255)
}

/// Encode dans le format demandé. Renvoie les octets et ce qu'il faut savoir.
pub fn encode(image: &RgbaImage, format: ExportFormat, quality: u8, matte: [u8; 3]) -> AppResult<(Vec<u8>, Vec<String>)> {
    let mut notes = Vec::new();
    let mut out = Cursor::new(Vec::new());
    let failed = |e: image::ImageError| AppError::internal(format!("encodage : {e}"));
    match format {
        ExportFormat::Png => image.write_to(&mut out, ImageFormat::Png).map_err(failed)?,
        ExportFormat::Jpeg => {
            if has_transparency(image) {
                notes.push("JPEG n'a pas de transparence : le fond transparent a été rempli.".into());
            }
            let flat = flatten(image, matte);
            JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
                .encode_image(&flat)
                .map_err(failed)?;
        }
        ExportFormat::Webp => {
            notes.push("WebP enregistré sans perte (qualité maximale, fichier plus lourd).".into());
            image.write_to(&mut out, ImageFormat::WebP).map_err(failed)?;
        }
        ExportFormat::Tiff => image.write_to(&mut out, ImageFormat::Tiff).map_err(failed)?,
        ExportFormat::Gif => {
            notes.push("GIF : 256 couleurs au plus, transparence tout ou rien.".into());
            image.write_to(&mut out, ImageFormat::Gif).map_err(failed)?;
        }
        ExportFormat::Bmp => {
            if has_transparency(image) {
                notes.push("BMP : la transparence a été remplie.".into());
            }
            DynamicImage::ImageRgb8(flatten(image, matte))
                .write_to(&mut out, ImageFormat::Bmp)
                .map_err(failed)?;
        }
    }
    Ok((out.into_inner(), notes))
}

/// Réduit (jamais n'agrandit) pour que le plus grand côté tienne dans `max_side`.
pub fn fit_within(image: &RgbaImage, max_side: u32) -> RgbaImage {
    let (w, h) = image.dimensions();
    if w.max(h) <= max_side || max_side == 0 {
        return image.clone();
    }
    let scale = max_side as f32 / w.max(h) as f32;
    imageops::resize(image, ((w as f32 * scale).round() as u32).max(1), ((h as f32 * scale).round() as u32).max(1), FilterType::Lanczos3)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| Rgba([(x * 7 % 256) as u8, (y * 11 % 256) as u8, 90, 255]))
    }

    #[test]
    fn composite_keeps_every_pixel_outside_the_mask() {
        let base = gradient(40, 30);
        let overlay = RgbaImage::from_pixel(40, 30, Rgba([255, 0, 0, 255]));
        let mask = GrayImage::from_fn(40, 30, |x, y| Luma([if (10..20).contains(&x) && (5..15).contains(&y) { 255 } else { 0 }]));
        let out = composite(&base, &overlay, &mask);
        for (x, y, p) in out.enumerate_pixels() {
            if (10..20).contains(&x) && (5..15).contains(&y) {
                assert_eq!(p.0, [255, 0, 0, 255]);
            } else {
                assert_eq!(p, base.get_pixel(x, y), "pixel {x},{y} modifié hors du masque");
            }
        }
    }

    #[test]
    fn mask_bounds_and_context_stay_inside_the_image() {
        let mask = GrayImage::from_fn(100, 80, |x, y| Luma([if (40..50).contains(&x) && (30..34).contains(&y) { 255 } else { 0 }]));
        assert_eq!(mask_bounds(&mask), Some((40, 30, 10, 4)));
        let ctx = with_context((40, 30, 10, 4), 0.5, 64, (100, 80));
        assert_eq!((ctx.2, ctx.3), (64, 64));
        assert!(ctx.0 + ctx.2 <= 100 && ctx.1 + ctx.3 <= 80);
        assert!(ctx.0 <= 40 && ctx.1 <= 30);
        assert_eq!(mask_bounds(&GrayImage::new(5, 5)), None);
        assert!(mask_is_empty(&GrayImage::new(5, 5)));
    }

    #[test]
    fn canvas_extension_keeps_the_original_and_marks_new_areas() {
        let image = gradient(10, 10);
        let (canvas, mask) = extend_canvas(&image, 30, 10, 10, 0, Rgba([128, 128, 128, 255])).unwrap();
        assert_eq!(canvas.dimensions(), (30, 10));
        assert_eq!(canvas.get_pixel(15, 5), image.get_pixel(5, 5));
        assert_eq!(mask.get_pixel(0, 0).0[0], 255);
        assert_eq!(mask.get_pixel(15, 5).0[0], 0);
        assert!(extend_canvas(&image, 8, 10, 0, 0, Rgba([0; 4])).is_err());
    }

    #[test]
    fn rotation_resizing_and_flipping() {
        let image = gradient(20, 10);
        assert_eq!(rotate(&image, 90.0).dimensions(), (10, 20));
        assert_eq!(rotate(&image, -90.0).dimensions(), (10, 20));
        assert_eq!(rotate(&image, 180.0).get_pixel(0, 0), image.get_pixel(19, 9));
        let tilted = rotate(&image, 45.0);
        assert!(tilted.width() > 20 && tilted.get_pixel(0, 0).0[3] == 0, "coins transparents");
        assert_eq!(upscale(&image, 2.0, true).unwrap().dimensions(), (40, 20));
        assert!(upscale(&image, 0.5, false).is_err());
        assert_eq!(flip(&image, true).get_pixel(0, 0), image.get_pixel(19, 0));
        assert_eq!(crop(&image, 5, 2, 100, 100).unwrap().dimensions(), (15, 8));
        assert!(crop(&image, 30, 0, 5, 5).is_err());
        assert_eq!(fit_within(&image, 10).dimensions(), (10, 5));
        assert_eq!(fit_within(&image, 100).dimensions(), (20, 10));
    }

    #[test]
    fn a_flat_background_is_keyed_out_and_the_subject_kept() {
        let mut image = RgbaImage::from_pixel(20, 20, Rgba([255, 0, 255, 255]));
        for x in 6..14 {
            for y in 6..14 {
                image.put_pixel(x, y, Rgba([30, 160, 40, 255]));
            }
        }
        assert_eq!(border_color(&image), [255, 0, 255]);
        let keyed = chroma_key(&image, [255, 0, 255], 60);
        assert_eq!(keyed.get_pixel(0, 0).0[3], 0);
        assert_eq!(keyed.get_pixel(10, 10).0, [30, 160, 40, 255]);
        assert!(has_transparency(&keyed));
    }

    #[test]
    fn moving_a_region_leaves_a_hole_to_fill() {
        let image = gradient(20, 20);
        let mask = GrayImage::from_fn(20, 20, |x, y| Luma([if x < 4 && y < 4 { 255 } else { 0 }]));
        let (moved, hole) = move_region(&image, &mask, 10, 10);
        assert_eq!(moved.get_pixel(10, 10), image.get_pixel(0, 0));
        assert_eq!(hole.get_pixel(1, 1).0[0], 255);
        assert_eq!(hole.get_pixel(12, 12).0[0], 0);
    }

    #[test]
    fn every_export_format_encodes_and_decodes() {
        let mut image = gradient(12, 9);
        image.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        for format in [ExportFormat::Png, ExportFormat::Jpeg, ExportFormat::Webp, ExportFormat::Tiff, ExportFormat::Gif, ExportFormat::Bmp] {
            let (bytes, notes) = encode(&image, format, 85, [255, 255, 255]).unwrap();
            let back = decode(&bytes).unwrap();
            assert_eq!((back.width(), back.height()), (12, 9), "{format:?}");
            if format == ExportFormat::Jpeg {
                assert!(notes.iter().any(|n| n.contains("transparence")));
                assert_eq!(back.to_rgba8().get_pixel(0, 0).0[3], 255);
            }
        }
    }

    #[test]
    fn masks_follow_the_image_size_and_painted_alpha() {
        let mut painted = RgbaImage::new(4, 4);
        painted.put_pixel(1, 1, Rgba([255, 255, 255, 255]));
        let mask = mask(&png(&painted).unwrap(), 8, 8).unwrap();
        assert_eq!(mask.dimensions(), (8, 8));
        assert!(mask.get_pixel(3, 3).0[0] > 100);
        assert_eq!(mask.get_pixel(7, 7).0[0], 0);
    }
}
