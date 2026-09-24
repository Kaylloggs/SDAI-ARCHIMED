//! Textures pixel-art générées de façon déterministe (même nom → même image).
//!
//! C'est le socle sans IA : une gemme pour un objet, une tuile pour un bloc, une icône
//! pour le mod. Les textures générées par un modèle d'image passent par `pixelart`, puis
//! par le même encodeur PNG.

use crate::core::{AppError, AppResult};

pub struct Image {
    pub width: u32,
    pub height: u32,
    rgba: Vec<u8>,
}

impl Image {
    fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            rgba: vec![0; (width * height * 4) as usize],
        }
    }

    /// Image déjà calculée (`rgba` : 4 octets par pixel, ligne par ligne).
    pub fn from_rgba(width: u32, height: u32, rgba: Vec<u8>) -> Self {
        debug_assert_eq!(rgba.len(), (width * height * 4) as usize);
        Self {
            width,
            height,
            rgba,
        }
    }

    fn set(&mut self, x: u32, y: u32, color: [u8; 4]) {
        if x < self.width && y < self.height {
            let i = ((y * self.width + x) * 4) as usize;
            self.rgba[i..i + 4].copy_from_slice(&color);
        }
    }

    pub fn png(&self) -> AppResult<Vec<u8>> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, self.width, self.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|e| AppError::internal(format!("PNG : {e}")))?;
            writer
                .write_image_data(&self.rgba)
                .map_err(|e| AppError::internal(format!("PNG : {e}")))?;
        }
        Ok(out)
    }
}

/// FNV-1a : graine stable, indépendante de la plateforme.
fn hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn noise(seed: u64, x: u32, y: u32) -> f32 {
    let mut h = seed ^ ((u64::from(x) << 32) | u64::from(y));
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    (h % 1000) as f32 / 1000.0
}

/// Couleur HSL (h en degrés, s et l entre 0 et 1) → RGBA opaque.
fn hsl(h: f32, s: f32, l: f32) -> [u8; 4] {
    let l = l.clamp(0.0, 1.0);
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let hp = (h.rem_euclid(360.0)) / 60.0;
    let x = c * (1.0 - (hp % 2.0 - 1.0).abs());
    let (r, g, b) = match hp as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = l - c / 2.0;
    let channel = |v: f32| ((v + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    [channel(r), channel(g), channel(b), 255]
}

fn hue_of(seed: u64) -> f32 {
    (seed % 360) as f32
}

/// Gemme 16 × 16 : losange ombré, contour sombre, reflet.
pub fn gem(name: &str) -> Image {
    let seed = hash(name);
    let hue = hue_of(seed);
    let mut image = Image::new(16, 16);
    for y in 0..16u32 {
        for x in 0..16u32 {
            let distance = (x as f32 - 7.5).abs() + (y as f32 - 7.5).abs();
            if distance > 7.0 {
                continue;
            }
            let color = if distance > 6.0 {
                hsl(hue, 0.55, 0.18)
            } else {
                // Lumière venue d'en haut à gauche.
                let light = 0.62 - (x + y) as f32 / 30.0 * 0.35 + noise(seed, x, y) * 0.05;
                hsl(hue, 0.7, light)
            };
            image.set(x, y, color);
        }
    }
    for (x, y) in [(5, 5), (6, 5), (5, 6)] {
        image.set(x, y, hsl(hue, 0.4, 0.9));
    }
    image
}

/// Tuile de bloc 16 × 16 : matière granuleuse, bords légèrement plus sombres.
pub fn block(name: &str) -> Image {
    let seed = hash(name);
    let hue = hue_of(seed);
    let mut image = Image::new(16, 16);
    for y in 0..16u32 {
        for x in 0..16u32 {
            let edge = x == 0 || y == 0 || x == 15 || y == 15;
            let light = 0.45 + (noise(seed, x, y) - 0.5) * 0.14 - if edge { 0.08 } else { 0.0 };
            image.set(x, y, hsl(hue, 0.45, light));
        }
    }
    image
}

/// Icône du mod 64 × 64 : motif symétrique propre au Mod ID sur fond sombre.
pub fn icon(mod_id: &str) -> Image {
    let seed = hash(mod_id);
    let hue = hue_of(seed);
    let mut image = Image::new(64, 64);
    let background = hsl(hue, 0.25, 0.14);
    let foreground = hsl(hue, 0.65, 0.6);
    for y in 0..64u32 {
        for x in 0..64u32 {
            image.set(x, y, background);
        }
    }
    // Grille 8 × 8 de cases de 6 px, moitié gauche tirée au sort puis reflétée.
    for row in 0..8u32 {
        for col in 0..4u32 {
            if noise(seed, col, row) < 0.5 {
                continue;
            }
            for mirrored in [col, 7 - col] {
                for dy in 0..6 {
                    for dx in 0..6 {
                        image.set(8 + mirrored * 6 + dx, 8 + row * 6 + dy, foreground);
                    }
                }
            }
        }
    }
    image
}

// ── Éléments d'interface, aux couleurs des écrans du jeu ────────────────────

const GUI_BLACK: [u8; 4] = [0, 0, 0, 255];
const GUI_WHITE: [u8; 4] = [255, 255, 255, 255];
const GUI_BASE: [u8; 4] = [198, 198, 198, 255];
const GUI_SHADOW: [u8; 4] = [85, 85, 85, 255];
const SLOT_DARK: [u8; 4] = [55, 55, 55, 255];
const SLOT_FILL: [u8; 4] = [139, 139, 139, 255];

/// Panneau d'écran : fond gris clair, contour noir aux coins arrondis, biseau clair en haut à
/// gauche et sombre en bas à droite.
fn draw_panel(image: &mut Image, x0: u32, y0: u32, w: u32, h: u32) {
    for j in 0..h {
        for i in 0..w {
            let (right, bottom) = (w - 1 - i, h - 1 - j);
            let near = |a: u32, b: u32| a + b < 2;
            // Coins arrondis : les trois pixels du coin restent transparents.
            if near(i, j) || near(right, j) || near(i, bottom) || near(right, bottom) {
                continue;
            }
            let diagonal = (i == 1 || right == 1) && (j == 1 || bottom == 1);
            let color = if i == 0 || j == 0 || right == 0 || bottom == 0 || diagonal {
                GUI_BLACK
            } else if (i <= 2 || j <= 2) && (right <= 2 || bottom <= 2) {
                GUI_BASE
            } else if i <= 2 || j <= 2 {
                GUI_WHITE
            } else if right <= 2 || bottom <= 2 {
                GUI_SHADOW
            } else {
                GUI_BASE
            };
            image.set(x0 + i, y0 + j, color);
        }
    }
}

/// Case d'inventaire 18 × 18 (bord sombre en haut à gauche, clair en bas à droite).
fn draw_slot(image: &mut Image, x0: u32, y0: u32) {
    for j in 0..18 {
        for i in 0..18 {
            let color = if (i == 17 && j == 0) || (i == 0 && j == 17) {
                SLOT_FILL
            } else if i == 0 || j == 0 {
                SLOT_DARK
            } else if i == 17 || j == 17 {
                GUI_WHITE
            } else {
                SLOT_FILL
            };
            image.set(x0 + i, y0 + j, color);
        }
    }
}

/// Fond d'écran de conteneur 176 × 166 sur une toile 256 × 256, avec l'inventaire du joueur
/// (3 × 9 cases et barre rapide) aux positions du jeu si demandé.
pub fn gui_panel(with_inventory: bool) -> Image {
    let mut image = Image::new(256, 256);
    draw_panel(&mut image, 0, 0, 176, 166);
    if with_inventory {
        for row in 0..3 {
            for col in 0..9 {
                draw_slot(&mut image, 7 + col * 18, 83 + row * 18);
            }
        }
        for col in 0..9 {
            draw_slot(&mut image, 7 + col * 18, 141);
        }
    }
    image
}

pub fn gui_slot() -> Image {
    let mut image = Image::new(18, 18);
    draw_slot(&mut image, 0, 0);
    image
}

/// Bouton 200 × 20 : contour noir, reflet en haut, ombre en bas.
pub fn gui_button() -> Image {
    let (w, h) = (200u32, 20u32);
    let mut image = Image::new(w, h);
    for j in 0..h {
        for i in 0..w {
            let color = if i == 0 || j == 0 || i == w - 1 || j == h - 1 {
                GUI_BLACK
            } else if j == 1 || i == 1 {
                [170, 170, 170, 255]
            } else if j >= h - 3 || i == w - 2 {
                [86, 86, 86, 255]
            } else {
                [111, 111, 111, 255]
            };
            image.set(i, j, color);
        }
    }
    image
}

/// Flèche de progression 24 × 17 (blanche, comme celle du four une fois pleine).
pub fn gui_arrow() -> Image {
    let mut image = Image::new(24, 17);
    for j in 0..17u32 {
        for i in 0..24u32 {
            let shaft = i < 15 && (6..=10).contains(&j);
            // Pointe : triangle de la colonne 15 (pleine hauteur) à la colonne 23.
            let head = i >= 15 && (i - 15) <= 8 && j.abs_diff(8) <= 8 - (i - 15);
            if shaft || head {
                image.set(i, j, GUI_WHITE);
            }
        }
    }
    image
}

/// Toile transparente.
pub fn blank(width: u32, height: u32) -> Image {
    Image::new(width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(image: &Image, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * image.width + x) * 4) as usize;
        [
            image.rgba[i],
            image.rgba[i + 1],
            image.rgba[i + 2],
            image.rgba[i + 3],
        ]
    }

    #[test]
    fn gui_elements_follow_the_game_layout() {
        let panel = gui_panel(true);
        assert_eq!((panel.width, panel.height), (256, 256));
        assert_eq!(pixel(&panel, 0, 0)[3], 0, "coin arrondi");
        assert_eq!(pixel(&panel, 2, 0), GUI_BLACK);
        assert_eq!(pixel(&panel, 1, 1), GUI_BLACK);
        assert_eq!(pixel(&panel, 3, 2), GUI_WHITE, "reflet de deux pixels");
        assert_eq!(pixel(&panel, 3, 3), GUI_BASE);
        assert_eq!(pixel(&panel, 173, 100), GUI_SHADOW);
        assert_eq!(pixel(&panel, 100, 164), GUI_SHADOW);
        assert_eq!(pixel(&panel, 88, 40), GUI_BASE);
        // Première case de l'inventaire du joueur : bord en (7, 83), intérieur en (8, 84).
        assert_eq!(pixel(&panel, 7, 84), SLOT_DARK);
        assert_eq!(pixel(&panel, 8, 84), SLOT_FILL);
        assert_eq!(
            pixel(&panel, 200, 200)[3],
            0,
            "hors du panneau : transparent"
        );
        assert_eq!(pixel(&gui_slot(), 17, 5), GUI_WHITE);
        assert_eq!((gui_button().width, gui_button().height), (200, 20));
        let arrow = gui_arrow();
        assert_eq!(pixel(&arrow, 23, 8), GUI_WHITE, "pointe");
        assert_eq!(pixel(&arrow, 5, 0)[3], 0);
    }

    #[test]
    fn textures_are_valid_png_with_expected_size() {
        for (image, size) in [
            (gem("ruby"), 16),
            (block("ruby_block"), 16),
            (icon("dragonrealms"), 64),
        ] {
            let bytes = image.png().unwrap();
            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
            let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
            let reader = decoder.read_info().unwrap();
            assert_eq!(reader.info().width, size);
            assert_eq!(reader.info().height, size);
        }
    }

    #[test]
    fn same_name_same_texture() {
        assert_eq!(gem("ruby").png().unwrap(), gem("ruby").png().unwrap());
        assert_ne!(gem("ruby").png().unwrap(), gem("sapphire").png().unwrap());
    }

    #[test]
    fn gem_has_transparent_corners() {
        let image = gem("ruby");
        assert_eq!(image.rgba[3], 0);
    }
}
