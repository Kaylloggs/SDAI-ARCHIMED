//! Textures dessinées par Higgsfield, par la couche d'images du core (`core::imaging`) :
//! avec une clé d'API (rangée sous `mcstudio-higgsfield`, ou relue sur place chez un autre
//! module, jamais recopiée), ou avec le compte de la personne par la CLI officielle
//! (connexion dans le navigateur, crédits de son abonnement).

use crate::core::imaging::{cancel_pair, ImageRequest, Imaging, InputImage, ProviderId, ProviderModel};
use crate::core::{AppError, AppResult};

use super::types::{ImageModel, ImageModelList};

/// Fournisseur du core derrière le choix de la personne.
pub fn provider_id(account: bool) -> ProviderId {
    if account {
        ProviderId::HiggsfieldAccount
    } else {
        ProviderId::Higgsfield
    }
}

/// Modèle du core → modèle du sélecteur de Mod Studio. Seuls ceux qui créent à partir d'un
/// texte dessinent une texture (la référence, si le modèle la lit, s'ajoute en entrée).
fn texture_model(model: ProviderModel) -> Option<ImageModel> {
    let caps = &model.capabilities;
    if !caps.text_to_image {
        return None;
    }
    Some(ImageModel {
        image_input: caps.image_input && caps.max_input_images != Some(0),
        id: model.id,
        name: model.name,
        free: model.free,
        description: model.description,
        text_output: false,
    })
}

pub async fn models(imaging: &Imaging, account: bool) -> AppResult<ImageModelList> {
    let list = imaging.provider(provider_id(account))?.models().await?;
    Ok(ImageModelList {
        offline: list.offline,
        models: list.models.into_iter().filter_map(texture_model).collect(),
    })
}

/// Une image au format demandé ; la référence part en entrée si elle est donnée.
pub async fn generate(
    imaging: &Imaging,
    account: bool,
    model: &ImageModel,
    prompt: &str,
    reference: Option<&[u8]>,
    aspect: &str,
) -> AppResult<Vec<u8>> {
    let provider = imaging.provider(provider_id(account))?;
    let request = ImageRequest {
        model: model.id.clone(),
        prompt: prompt.to_string(),
        images: reference
            .map(|bytes| {
                vec![InputImage {
                    bytes: bytes.to_vec(),
                    mime: "image/png".into(),
                }]
            })
            .unwrap_or_default(),
        // Retiré par le fournisseur si le modèle ne l'accepte pas.
        aspect_ratio: Some(aspect.to_string()),
        count: 1,
        ..ImageRequest::default()
    };
    // Pas d'annulation côté atelier : l'émetteur vit le temps de la demande.
    let (_keep, cancel) = cancel_pair();
    let response = provider.generate(&request, cancel).await?;
    response
        .images
        .into_iter()
        .next()
        .map(|image| image.bytes)
        .ok_or_else(|| AppError::internal("Higgsfield n'a renvoyé aucune image."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::imaging::{CapabilitySource, ModelCapabilities};

    fn model(text: bool, input: bool, max: Option<u32>) -> ProviderModel {
        ProviderModel {
            provider: ProviderId::HiggsfieldAccount,
            id: "nano_banana_2".into(),
            name: "Nano Banana Pro".into(),
            description: String::new(),
            capabilities: ModelCapabilities {
                text_to_image: text,
                image_input: input,
                max_input_images: max,
                ..ModelCapabilities::minimal(CapabilitySource::Docs)
            },
            pricing: Vec::new(),
            free: false,
        }
    }

    #[test]
    fn only_text_to_image_models_draw_textures() {
        assert!(texture_model(model(false, true, Some(1))).is_none());
        let kept = texture_model(model(true, true, Some(14))).unwrap();
        assert!(kept.image_input && !kept.free && !kept.text_output);
        assert!(!texture_model(model(true, true, Some(0))).unwrap().image_input);
        assert_eq!(provider_id(true), ProviderId::HiggsfieldAccount);
        assert_eq!(provider_id(false), ProviderId::Higgsfield);
    }
}
