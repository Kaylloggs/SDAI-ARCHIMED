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

#[cfg(test)]
mod tests {
    use super::*;

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
