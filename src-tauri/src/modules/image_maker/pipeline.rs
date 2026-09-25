//! Opérations d'IA : ce qu'on envoie au modèle, et comment son résultat est recollé.
//!
//! Aucun modèle branché n'accepte de masque natif (Gemini ne l'offre que sur Vertex AI,
//! OpenRouter ne l'expose pas) : pour une zone, on envoie l'image (ou la zone et son contexte)
//! avec le masque en seconde image et une consigne, puis on **recolle ici** le résultat à
//! travers le masque adouci. Hors de la zone, chaque pixel d'origine est gardé à l'identique.
//! L'extension de toile suit le même principe : l'original est replacé au pixel près.

use image::{GrayImage, Luma, Rgba, RgbaImage};
use serde_json::{json, Value};

use crate::core::imaging::{ImageRequest, InputImage, ModelCapabilities};
use crate::core::{AppError, AppResult};

use super::local;
use super::types::{AiOperation, AiSettings, BackgroundAction, InpaintMode, NodeKind, ReferenceRole};

/// Ce qu'il faut faire de l'image renvoyée par le modèle.
#[derive(Clone)]
pub enum Finish {
    /// Gardée telle quelle.
    AsIs,
    /// Mise à la taille de `rect`, puis recollée dans `source` à travers `mask` (taille réelle).
    PasteBack { source: RgbaImage, rect: (u32, u32, u32, u32), mask: GrayImage },
    /// Mise à la taille de la toile, l'original replacé exactement à sa place.
    Outpaint { original: RgbaImage, width: u32, height: u32, offset: (u32, u32) },
    /// Fond uni demandé au modèle, rendu transparent ici.
    KeyBackground,
}

/// Une opération prête à partir : demandes au modèle et suite à donner.
pub struct Prepared {
    pub requests: Vec<ImageRequest>,
    pub finish: Finish,
    pub kind: NodeKind,
    pub label: String,
    pub parent: Option<String>,
    pub references: Vec<String>,
    pub mask_png: Option<Vec<u8>>,
    pub params: Value,
}

/// Images d'un projet déjà lues, fournies par le service.
pub struct Inputs {
    pub source: Option<(RgbaImage, Vec<u8>, String)>,
    /// Références dans l'ordre : (octets, type MIME, rôle).
    pub references: Vec<(Vec<u8>, String, String)>,
}

const KEEP_REST: &str = "Do not change anything outside that area. Return the whole first image at the same framing.";

/// Format proposé par le modèle le plus proche de w/h.
pub fn nearest_ratio(width: u32, height: u32, ratios: &[String]) -> Option<String> {
    let target = width as f64 / height.max(1) as f64;
    ratios
        .iter()
        .filter_map(|r| {
            let (a, b) = r.split_once(':')?;
            let value = a.trim().parse::<f64>().ok()? / b.trim().parse::<f64>().ok()?;
            Some((r.clone(), (value.ln() - target.ln()).abs()))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(r, _)| r)
}

fn references_sentence(references: &[(Vec<u8>, String, String)], first_index: usize) -> String {
    if references.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = references
        .iter()
        .enumerate()
        .map(|(i, (_, _, role))| {
            let n = first_index + i;
            if role.trim().is_empty() {
                format!("image {n} is a reference")
            } else {
                format!("image {n} shows the {}", role.trim())
            }
        })
        .collect();
    format!(" Use the attached reference images: {}.", parts.join(", "))
}

/// Réglages retenus : seulement ce que le modèle accepte.
fn base_request(settings: &AiSettings, caps: &ModelCapabilities, prompt: String, images: Vec<InputImage>, ratio: Option<String>) -> ImageRequest {
    ImageRequest {
        model: settings.model.clone(),
        prompt,
        negative_prompt: settings.negative_prompt.clone().filter(|_| caps.negative_prompt),
        images,
        aspect_ratio: ratio.filter(|r| caps.aspect_ratios.contains(r)),
        resolution: settings.resolution.clone().filter(|r| caps.resolutions.contains(r)),
        count: 1,
        seed: settings.seed.filter(|_| caps.seed),
        quality: settings.quality.clone().filter(|q| caps.qualities.contains(q)),
        transparent_background: settings.transparent_background && caps.transparent_background,
    }
}

/// Découpe `count` résultats en demandes, selon ce que le modèle produit à la fois.
fn split(request: ImageRequest, count: u32, per_request: u32) -> Vec<ImageRequest> {
    let count = count.clamp(1, 20);
    let per = per_request.max(1);
    let mut out = Vec::new();
    let mut left = count;
    while left > 0 {
        let n = left.min(per);
        out.push(ImageRequest { count: n, ..request.clone() });
        left -= n;
    }
    out
}

fn input(bytes: Vec<u8>, mime: String) -> InputImage {
    InputImage { bytes, mime }
}

/// Plus grand côté envoyé à un modèle : au-delà, la demande s'alourdit sans rien apporter
/// (les modèles produisent 1K à 4K) et dépasse les limites de taille de certaines API.
pub const SEND_SIDE: u32 = 2048;

fn send_dims(width: u32, height: u32) -> (u32, u32) {
    let side = width.max(height);
    if side <= SEND_SIDE {
        return (width, height);
    }
    let scale = SEND_SIDE as f64 / side as f64;
    (((width as f64 * scale).round() as u32).max(1), ((height as f64 * scale).round() as u32).max(1))
}

/// Image prête à envoyer : réduite à `SEND_SIDE`, PNG si elle a de la transparence, JPEG sinon.
pub fn sendable(image: &RgbaImage) -> AppResult<InputImage> {
    let (w, h) = send_dims(image.width(), image.height());
    let fitted = if (w, h) == image.dimensions() {
        image.clone()
    } else {
        image::imageops::resize(image, w, h, image::imageops::FilterType::Lanczos3)
    };
    if local::has_transparency(&fitted) {
        Ok(input(local::png(&fitted)?, "image/png".into()))
    } else {
        let (bytes, _) = local::encode(&fitted, super::types::ExportFormat::Jpeg, 92, [255, 255, 255])?;
        Ok(input(bytes, "image/jpeg".into()))
    }
}

fn png_input(image: &RgbaImage) -> AppResult<InputImage> {
    sendable(image)
}

fn need_image_input(caps: &ModelCapabilities) -> AppResult<()> {
    if caps.image_input {
        Ok(())
    } else {
        Err(AppError::invalid(
            "Ce modèle ne reçoit pas d'image : choisissez un modèle qui accepte des images (édition, référence).",
        ))
    }
}

fn source(inputs: &Inputs) -> AppResult<&(RgbaImage, Vec<u8>, String)> {
    inputs.source.as_ref().ok_or_else(|| AppError::invalid("Choisissez d'abord une image."))
}

/// Prépare une opération. `caps` : capacités du modèle choisi.
pub fn prepare(operation: &AiOperation, settings: &AiSettings, caps: &ModelCapabilities, inputs: &Inputs) -> AppResult<Prepared> {
    let prompt = settings.prompt.trim().to_string();
    let reference_ids = |refs: &[ReferenceRole]| refs.iter().map(|r| r.node.clone()).collect::<Vec<_>>();
    let reference_inputs = || inputs.references.iter().map(|(b, m, _)| input(b.clone(), m.clone())).collect::<Vec<_>>();
    let mut params = json!({
        "operation": operation_name(operation),
        "aspectRatio": settings.aspect_ratio,
        "resolution": settings.resolution,
        "seed": settings.seed,
    });
    match operation {
        AiOperation::Generate { references } => {
            if prompt.is_empty() {
                return Err(AppError::invalid("Décrivez l'image à créer."));
            }
            if !references.is_empty() {
                need_image_input(caps)?;
            }
            let text = format!("{prompt}{}", references_sentence(&inputs.references, 1));
            let request = base_request(settings, caps, text, reference_inputs(), settings.aspect_ratio.clone());
            Ok(Prepared {
                requests: split(request, settings.count, caps.max_images_per_request),
                finish: Finish::AsIs,
                kind: if references.is_empty() { NodeKind::Generate } else { NodeKind::Combine },
                label: if references.is_empty() { "Génération".into() } else { "Composition de références".into() },
                parent: None,
                references: reference_ids(references),
                mask_png: None,
                params,
            })
        }
        AiOperation::Edit { source: id, references } => {
            need_image_input(caps)?;
            if prompt.is_empty() {
                return Err(AppError::invalid("Décrivez la modification."));
            }
            let (image, bytes, mime) = source(inputs)?;
            let mut images = vec![input(bytes.clone(), mime.clone())];
            images.extend(reference_inputs());
            let text = format!(
                "Edit the first image: {prompt}.{} Keep everything that is not mentioned unchanged.",
                references_sentence(&inputs.references, 2)
            );
            let ratio = nearest_ratio(image.width(), image.height(), &caps.aspect_ratios);
            let request = base_request(settings, caps, text, images, ratio);
            Ok(Prepared {
                requests: split(request, settings.count, caps.max_images_per_request),
                finish: Finish::AsIs,
                kind: NodeKind::Edit,
                label: "Modification".into(),
                parent: Some(id.clone()),
                references: reference_ids(references),
                mask_png: None,
                params,
            })
        }
        AiOperation::Inpaint { source: id, mask_png, mode } => {
            need_image_input(caps)?;
            let (image, _, _) = source(inputs)?;
            let mask_bytes = local::decode_transport(mask_png)?;
            let full_mask = local::mask(&mask_bytes, image.width(), image.height())?;
            let bounds = local::mask_bounds(&full_mask)
                .ok_or_else(|| AppError::invalid("Sélectionnez d'abord la zone à modifier."))?;
            if prompt.is_empty() && *mode != InpaintMode::Remove {
                return Err(AppError::invalid("Décrivez ce qui doit apparaître dans la zone."));
            }
            let min_side = 512.min(image.width()).min(image.height());
            let mut rect = local::with_context(bounds, 0.35, min_side, image.dimensions());
            if let Some(ratio) = nearest_ratio(rect.2, rect.3, &caps.aspect_ratios) {
                rect = fit_ratio(rect, &ratio, image.dimensions());
            }
            let crop = local::crop(image, rect.0, rect.1, rect.2, rect.3)?;
            let crop_mask = image::imageops::crop_imm(&full_mask, rect.0, rect.1, rect.2, rect.3).to_image();
            let binary = GrayImage::from_fn(crop_mask.width(), crop_mask.height(), |x, y| {
                Luma([if crop_mask.get_pixel(x, y).0[0] > 16 { 255 } else { 0 }])
            });
            let text = match mode {
                InpaintMode::Replace => format!("In the first image, replace only what is inside the area shown in white in the second image (a mask) with: {prompt}. Match the perspective, lighting and style of the scene. {KEEP_REST}"),
                InpaintMode::Remove => format!(
                    "In the first image, remove what is inside the area shown in white in the second image (a mask) and fill it with the surrounding background, as if it had never been there.{} {KEEP_REST}",
                    if prompt.is_empty() { String::new() } else { format!(" {prompt}.") }
                ),
                InpaintMode::Add => format!("In the first image, add {prompt} inside the area shown in white in the second image (a mask), blending it naturally with the scene (scale, lighting, shadows). {KEEP_REST}"),
                InpaintMode::Modify => format!("In the first image, change what is inside the area shown in white in the second image (a mask): {prompt}. Keep its shape and position. {KEEP_REST}"),
            };
            let ratio = nearest_ratio(rect.2, rect.3, &caps.aspect_ratios);
            let request = base_request(settings, caps, text, vec![png_input(&crop)?, png_input_gray(&binary)?], ratio);
            params["rect"] = json!([rect.0, rect.1, rect.2, rect.3]);
            params["mode"] = json!(mode);
            Ok(Prepared {
                requests: split(request, settings.count, caps.max_images_per_request),
                finish: Finish::PasteBack { source: image.clone(), rect, mask: full_mask },
                kind: NodeKind::Inpaint,
                label: match mode {
                    InpaintMode::Replace => "Remplacement dans la zone",
                    InpaintMode::Remove => "Effacement dans la zone",
                    InpaintMode::Add => "Ajout dans la zone",
                    InpaintMode::Modify => "Retouche de la zone",
                }
                .into(),
                parent: Some(id.clone()),
                references: Vec::new(),
                mask_png: Some(mask_bytes),
                params,
            })
        }
        AiOperation::Outpaint { source: id, width, height, offset_x, offset_y } => {
            need_image_input(caps)?;
            let (image, _, _) = source(inputs)?;
            let (canvas, new_area) = local::extend_canvas(image, *width, *height, *offset_x, *offset_y, Rgba([127, 127, 127, 255]))?;
            if local::mask_is_empty(&new_area) {
                return Err(AppError::invalid("La nouvelle toile est de la même taille que l'image : rien à étendre."));
            }
            let text = format!(
                "The first image is a picture placed on a larger canvas. The flat gray areas, shown in white in the second image, are empty. Extend the picture into those areas so the scene continues seamlessly (same perspective, lighting and style).{} Keep the original picture unchanged and return the whole canvas.",
                if prompt.is_empty() { String::new() } else { format!(" In the new areas: {prompt}.") }
            );
            let ratio = nearest_ratio(*width, *height, &caps.aspect_ratios);
            let request = base_request(settings, caps, text, vec![png_input(&canvas)?, png_input_gray(&new_area)?], ratio);
            params["canvas"] = json!([width, height, offset_x, offset_y]);
            Ok(Prepared {
                requests: split(request, settings.count, caps.max_images_per_request),
                finish: Finish::Outpaint { original: image.clone(), width: *width, height: *height, offset: (*offset_x, *offset_y) },
                kind: NodeKind::Outpaint,
                label: format!("Extension {width} × {height}"),
                parent: Some(id.clone()),
                references: Vec::new(),
                mask_png: Some(local::mask_png(&new_area)?),
                params,
            })
        }
        AiOperation::Variation { source: id, keep } => {
            need_image_input(caps)?;
            let (image, bytes, mime) = source(inputs)?;
            let keep: Vec<&str> = keep.iter().map(|k| k.trim()).filter(|k| !k.is_empty()).collect();
            let text = format!(
                "Create a new variation of this image.{}{}",
                if keep.is_empty() { String::new() } else { format!(" Keep exactly: {}.", keep.join(", ")) },
                if prompt.is_empty() { " Change the other details freely.".to_string() } else { format!(" Change: {prompt}.") }
            );
            params["keep"] = json!(keep);
            let ratio = nearest_ratio(image.width(), image.height(), &caps.aspect_ratios);
            let request = base_request(settings, caps, text, vec![input(bytes.clone(), mime.clone())], ratio);
            Ok(Prepared {
                requests: split(request, settings.count, caps.max_images_per_request),
                finish: Finish::AsIs,
                kind: NodeKind::Variation,
                label: "Variante".into(),
                parent: Some(id.clone()),
                references: Vec::new(),
                mask_png: None,
                params,
            })
        }
        AiOperation::Restyle { source: id, style } => {
            need_image_input(caps)?;
            if style.trim().is_empty() {
                return Err(AppError::invalid("Décrivez le style voulu."));
            }
            let (image, bytes, mime) = source(inputs)?;
            let text = format!(
                "Redraw this exact image in the following style: {}. Keep the composition, the subjects and their poses.{}",
                style.trim(),
                if prompt.is_empty() { String::new() } else { format!(" {prompt}.") }
            );
            params["style"] = json!(style.trim());
            let ratio = nearest_ratio(image.width(), image.height(), &caps.aspect_ratios);
            let request = base_request(settings, caps, text, vec![input(bytes.clone(), mime.clone())], ratio);
            Ok(Prepared {
                requests: split(request, settings.count, caps.max_images_per_request),
                finish: Finish::AsIs,
                kind: NodeKind::Restyle,
                label: format!("Style : {}", style.trim().chars().take(40).collect::<String>()),
                parent: Some(id.clone()),
                references: Vec::new(),
                mask_png: None,
                params,
            })
        }
        AiOperation::Upscale { source: id } => {
            need_image_input(caps)?;
            let (image, bytes, mime) = source(inputs)?;
            let text = "Recreate this image at a higher resolution with sharper and finer details. Do not change the content, the composition or the colors.".to_string();
            let mut request = base_request(settings, caps, text, vec![input(bytes.clone(), mime.clone())], nearest_ratio(image.width(), image.height(), &caps.aspect_ratios));
            // Le plus grand palier du modèle.
            request.resolution = caps.resolutions.last().cloned();
            params["resolution"] = json!(request.resolution);
            Ok(Prepared {
                requests: vec![request],
                finish: Finish::AsIs,
                kind: NodeKind::Upscale,
                label: "Amélioration par l'IA".into(),
                parent: Some(id.clone()),
                references: Vec::new(),
                mask_png: None,
                params,
            })
        }
        AiOperation::Restore { source: id } => {
            need_image_input(caps)?;
            let (image, bytes, mime) = source(inputs)?;
            let text = format!(
                "Restore this photo: remove noise, scratches, stains, blur and compression artifacts, and recover faded colors. Keep faces, text and details faithful to the original.{}",
                if prompt.is_empty() { String::new() } else { format!(" {prompt}.") }
            );
            let request = base_request(settings, caps, text, vec![input(bytes.clone(), mime.clone())], nearest_ratio(image.width(), image.height(), &caps.aspect_ratios));
            Ok(Prepared {
                requests: vec![request],
                finish: Finish::AsIs,
                kind: NodeKind::Restore,
                label: "Restauration".into(),
                parent: Some(id.clone()),
                references: Vec::new(),
                mask_png: None,
                params,
            })
        }
        AiOperation::Background { source: id, action } => {
            need_image_input(caps)?;
            let (image, bytes, mime) = source(inputs)?;
            let ratio = nearest_ratio(image.width(), image.height(), &caps.aspect_ratios);
            params["action"] = json!(action);
            match action {
                BackgroundAction::Remove => {
                    let native = caps.transparent_background;
                    let text = if native {
                        "Remove the background completely and keep only the main subject, unchanged.".to_string()
                    } else {
                        "Keep the main subject exactly as it is and replace the whole background with a flat, pure magenta color (#FF00FF): no shadow, no gradient, no texture.".to_string()
                    };
                    let mut request = base_request(settings, caps, text, vec![input(bytes.clone(), mime.clone())], ratio);
                    request.transparent_background = native;
                    params["method"] = json!(if native { "transparence du modèle" } else { "fond uni puis détourage local" });
                    Ok(Prepared {
                        requests: vec![request],
                        finish: if native { Finish::AsIs } else { Finish::KeyBackground },
                        kind: NodeKind::Background,
                        label: "Fond retiré".into(),
                        parent: Some(id.clone()),
                        references: Vec::new(),
                        mask_png: None,
                        params,
                    })
                }
                BackgroundAction::Replace => {
                    if prompt.is_empty() {
                        return Err(AppError::invalid("Décrivez le nouveau fond."));
                    }
                    let text = format!("Keep the main subject exactly as it is (same pose, same appearance) and replace the background with: {prompt}. Adapt the lighting of the scene naturally.");
                    let request = base_request(settings, caps, text, vec![input(bytes.clone(), mime.clone())], ratio);
                    Ok(Prepared {
                        requests: split(request, settings.count, caps.max_images_per_request),
                        finish: Finish::AsIs,
                        kind: NodeKind::Background,
                        label: "Nouveau fond".into(),
                        parent: Some(id.clone()),
                        references: Vec::new(),
                        mask_png: None,
                        params,
                    })
                }
            }
        }
    }
}

/// Masque envoyé à la même taille que l'image qu'il accompagne.
fn png_input_gray(mask: &GrayImage) -> AppResult<InputImage> {
    let (w, h) = send_dims(mask.width(), mask.height());
    let fitted = if (w, h) == mask.dimensions() {
        mask.clone()
    } else {
        image::imageops::resize(mask, w, h, image::imageops::FilterType::Triangle)
    };
    Ok(input(local::mask_png(&fitted)?, "image/png".into()))
}

pub fn operation_name(operation: &AiOperation) -> &'static str {
    match operation {
        AiOperation::Generate { .. } => "generate",
        AiOperation::Edit { .. } => "edit",
        AiOperation::Inpaint { .. } => "inpaint",
        AiOperation::Outpaint { .. } => "outpaint",
        AiOperation::Variation { .. } => "variation",
        AiOperation::Restyle { .. } => "restyle",
        AiOperation::Upscale { .. } => "upscale",
        AiOperation::Background { .. } => "background",
        AiOperation::Restore { .. } => "restore",
    }
}

/// Agrandit le rectangle vers le format `ratio` (« 4:3 »), sans sortir de l'image.
pub fn fit_ratio(rect: (u32, u32, u32, u32), ratio: &str, bounds: (u32, u32)) -> (u32, u32, u32, u32) {
    let Some((a, b)) = ratio.split_once(':') else { return rect };
    let (Ok(a), Ok(b)) = (a.parse::<f64>(), b.parse::<f64>()) else { return rect };
    let target = a / b;
    let (x, y, w, h) = rect;
    let (mut nw, mut nh) = (w as f64, h as f64);
    if nw / nh < target {
        nw = nh * target;
    } else {
        nh = nw / target;
    }
    let nw = (nw.round() as u32).min(bounds.0).max(1);
    let nh = (nh.round() as u32).min(bounds.1).max(1);
    let cx = x + w / 2;
    let cy = y + h / 2;
    let left = cx.saturating_sub(nw / 2).min(bounds.0 - nw);
    let top = cy.saturating_sub(nh / 2).min(bounds.1 - nh);
    (left, top, nw, nh)
}

/// Applique la suite prévue à une image renvoyée par le modèle.
pub fn finish(finish: &Finish, bytes: &[u8]) -> AppResult<Vec<u8>> {
    match finish {
        Finish::AsIs => Ok(bytes.to_vec()),
        Finish::KeyBackground => {
            let image = local::decode(bytes)?.to_rgba8();
            let color = local::border_color(&image);
            local::png(&local::chroma_key(&image, color, 70))
        }
        Finish::PasteBack { source, rect, mask } => {
            let result = local::decode(bytes)?.to_rgba8();
            let (x, y, w, h) = *rect;
            let fitted = image::imageops::resize(&result, w, h, image::imageops::FilterType::Lanczos3);
            let mut overlay = source.clone();
            image::imageops::replace(&mut overlay, &fitted, x as i64, y as i64);
            let radius = (w.min(h) as f32 / 120.0).clamp(1.5, 6.0);
            let soft = local::feather(&dilate(mask, radius), radius);
            // Hors du rectangle envoyé, rien ne peut changer.
            let limited = GrayImage::from_fn(soft.width(), soft.height(), |px, py| {
                let inside = px >= x && px < x + w && py >= y && py < y + h;
                Luma([if inside { soft.get_pixel(px, py).0[0] } else { 0 }])
            });
            local::png(&local::composite(source, &overlay, &limited))
        }
        Finish::Outpaint { original, width, height, offset } => {
            let result = local::decode(bytes)?.to_rgba8();
            let mut canvas = image::imageops::resize(&result, *width, *height, image::imageops::FilterType::Lanczos3);
            let (ox, oy) = *offset;
            // Raccord doux côté nouvelle zone, puis l'original exact par-dessus.
            let band = 6u32;
            let mut blended = canvas.clone();
            image::imageops::replace(&mut blended, original, ox as i64, oy as i64);
            let area = GrayImage::from_fn(*width, *height, |x, y| {
                let dx = if x < ox { ox - x } else if x >= ox + original.width() { x + 1 - (ox + original.width()) } else { 0 };
                let dy = if y < oy { oy - y } else if y >= oy + original.height() { y + 1 - (oy + original.height()) } else { 0 };
                let d = dx.max(dy);
                Luma([if d == 0 { 255 } else if d >= band { 0 } else { (255 * (band - d) / band) as u8 }])
            });
            // Dans la bande, l'original est prolongé par son bord le plus proche.
            let extended = edge_extend(original, *width, *height, (ox, oy));
            canvas = local::composite(&canvas, &extended, &area);
            image::imageops::replace(&mut canvas, original, ox as i64, oy as i64);
            local::png(&canvas)
        }
    }
}

/// Élargit la zone blanche d'un masque d'environ `radius` pixels (recouvre le bord de l'objet).
fn dilate(mask: &GrayImage, radius: f32) -> GrayImage {
    let blurred = image::imageops::blur(mask, radius);
    GrayImage::from_fn(mask.width(), mask.height(), |x, y| {
        Luma([if blurred.get_pixel(x, y).0[0] > 8 || mask.get_pixel(x, y).0[0] > 16 { 255 } else { 0 }])
    })
}

/// Toile où chaque pixel reprend le pixel le plus proche de l'original.
fn edge_extend(original: &RgbaImage, width: u32, height: u32, offset: (u32, u32)) -> RgbaImage {
    let (ox, oy) = offset;
    let (w, h) = original.dimensions();
    RgbaImage::from_fn(width, height, |x, y| {
        let sx = x.saturating_sub(ox).min(w - 1);
        let sy = y.saturating_sub(oy).min(h - 1);
        *original.get_pixel(sx, sy)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::imaging::{CapabilitySource, ProviderId};

    fn caps(image_input: bool) -> ModelCapabilities {
        let mut caps = ModelCapabilities::minimal(CapabilitySource::Api);
        caps.image_input = image_input;
        caps.aspect_ratios = vec!["1:1".into(), "16:9".into(), "4:3".into()];
        caps.resolutions = vec!["1K".into(), "2K".into()];
        caps
    }

    fn settings(prompt: &str, count: u32) -> AiSettings {
        AiSettings {
            provider: ProviderId::Gemini,
            model: "m".into(),
            prompt: prompt.into(),
            negative_prompt: Some("blur".into()),
            aspect_ratio: Some("16:9".into()),
            resolution: Some("4K".into()),
            count,
            seed: Some(3),
            quality: None,
            transparent_background: false,
        }
    }

    fn picture(w: u32, h: u32) -> RgbaImage {
        RgbaImage::from_fn(w, h, |x, y| Rgba([(x % 256) as u8, (y % 256) as u8, 60, 255]))
    }

    fn inputs(w: u32, h: u32) -> Inputs {
        let image = picture(w, h);
        let bytes = local::png(&image).unwrap();
        Inputs { source: Some((image, bytes, "image/png".into())), references: Vec::new() }
    }

    #[test]
    fn only_supported_settings_are_sent_and_counts_are_split() {
        let prepared = prepare(&AiOperation::Generate { references: vec![] }, &settings("un chevalier", 5), &caps(false), &inputs(4, 4)).unwrap();
        assert_eq!(prepared.requests.len(), 5, "une image par demande");
        let r = &prepared.requests[0];
        assert_eq!(r.aspect_ratio.as_deref(), Some("16:9"));
        assert_eq!(r.resolution, None, "4K n'est pas proposé par ce modèle");
        assert_eq!(r.seed, None);
        assert_eq!(r.negative_prompt, None);
        let mut many = caps(false);
        many.max_images_per_request = 4;
        let prepared = prepare(&AiOperation::Generate { references: vec![] }, &settings("x", 5), &many, &inputs(4, 4)).unwrap();
        assert_eq!(prepared.requests.iter().map(|r| r.count).collect::<Vec<_>>(), [4, 1]);
        assert!(prepare(&AiOperation::Generate { references: vec![] }, &settings("  ", 1), &caps(false), &inputs(4, 4)).is_err());
    }

    #[test]
    fn editing_needs_a_model_that_reads_images() {
        let op = AiOperation::Edit { source: "n-1".into(), references: vec![] };
        let error = prepare(&op, &settings("rends-le rouge", 1), &caps(false), &inputs(40, 30)).err().unwrap();
        assert!(error.message.contains("ne reçoit pas d'image"));
        let prepared = prepare(&op, &settings("rends-le rouge", 1), &caps(true), &inputs(40, 30)).unwrap();
        assert_eq!(prepared.requests[0].images.len(), 1);
        assert_eq!(prepared.requests[0].aspect_ratio.as_deref(), Some("4:3"), "format le plus proche de l'image");
    }

    #[test]
    fn inpainting_sends_the_area_with_context_and_pastes_back_only_inside_it() {
        let (w, h) = (1200u32, 800u32);
        let mut mask = GrayImage::new(w, h);
        for x in 600..700 {
            for y in 400..480 {
                mask.put_pixel(x, y, Luma([255]));
            }
        }
        let mask_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, local::mask_png(&mask).unwrap());
        let op = AiOperation::Inpaint { source: "n-1".into(), mask_png: mask_b64, mode: InpaintMode::Replace };
        let data = inputs(w, h);
        let prepared = prepare(&op, &settings("une moto", 1), &caps(true), &data).unwrap();
        let request = &prepared.requests[0];
        assert_eq!(request.images.len(), 2, "zone + masque");
        let Finish::PasteBack { rect, .. } = &prepared.finish else { panic!("recollage attendu") };
        assert!(rect.2 >= 512 && rect.0 <= 600 && rect.0 + rect.2 >= 700);
        // Le modèle renvoie la zone toute rouge : seul l'intérieur du masque (et son raccord) change.
        let red = RgbaImage::from_pixel(rect.2, rect.3, Rgba([255, 0, 0, 255]));
        let out = local::decode(&finish(&prepared.finish, &local::png(&red).unwrap()).unwrap()).unwrap().to_rgba8();
        let original = &data.source.as_ref().unwrap().0;
        assert_eq!(out.get_pixel(650, 440).0, [255, 0, 0, 255]);
        assert_eq!(out.get_pixel(10, 10), original.get_pixel(10, 10));
        assert_eq!(out.get_pixel(560, 440), original.get_pixel(560, 440), "hors zone et hors raccord : identique");
        let empty = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, local::mask_png(&GrayImage::new(w, h)).unwrap());
        let op = AiOperation::Inpaint { source: "n-1".into(), mask_png: empty, mode: InpaintMode::Remove };
        assert!(prepare(&op, &settings("", 1), &caps(true), &data).err().unwrap().message.contains("zone"));
    }

    #[test]
    fn outpainting_puts_the_original_back_pixel_for_pixel() {
        let data = inputs(100, 100);
        let op = AiOperation::Outpaint { source: "n-1".into(), width: 178, height: 100, offset_x: 39, offset_y: 0 };
        let prepared = prepare(&op, &settings("", 1), &caps(true), &data).unwrap();
        assert_eq!(prepared.requests[0].aspect_ratio.as_deref(), Some("16:9"));
        let blue = RgbaImage::from_pixel(1024, 576, Rgba([0, 0, 255, 255]));
        let out = local::decode(&finish(&prepared.finish, &local::png(&blue).unwrap()).unwrap()).unwrap().to_rgba8();
        assert_eq!(out.dimensions(), (178, 100));
        let original = &data.source.as_ref().unwrap().0;
        for (x, y, p) in original.enumerate_pixels() {
            assert_eq!(out.get_pixel(x + 39, y), p);
        }
        assert_eq!(out.get_pixel(0, 50).0, [0, 0, 255, 255], "loin du bord : image du modèle");
    }

    #[test]
    fn background_removal_keys_a_flat_color_when_the_model_has_no_transparency() {
        let data = inputs(20, 20);
        let op = AiOperation::Background { source: "n-1".into(), action: BackgroundAction::Remove };
        let prepared = prepare(&op, &settings("", 1), &caps(true), &data).unwrap();
        assert!(matches!(prepared.finish, Finish::KeyBackground));
        assert!(prepared.requests[0].prompt.contains("#FF00FF"));
        let mut native = caps(true);
        native.transparent_background = true;
        let prepared = prepare(&op, &settings("", 1), &native, &data).unwrap();
        assert!(matches!(prepared.finish, Finish::AsIs) && prepared.requests[0].transparent_background);
    }

    #[test]
    fn ratios_are_matched_and_fitted() {
        let list: Vec<String> = ["1:1", "16:9", "9:16", "4:3"].iter().map(|s| s.to_string()).collect();
        assert_eq!(nearest_ratio(1920, 1080, &list).as_deref(), Some("16:9"));
        assert_eq!(nearest_ratio(800, 810, &list).as_deref(), Some("1:1"));
        assert_eq!(nearest_ratio(10, 10, &[]), None);
        let fitted = fit_ratio((100, 100, 200, 100), "1:1", (1000, 1000));
        assert_eq!((fitted.2, fitted.3), (200, 200));
        let clamped = fit_ratio((0, 0, 100, 50), "16:9", (120, 60));
        assert!(clamped.2 <= 120 && clamped.3 <= 60);
    }
}
