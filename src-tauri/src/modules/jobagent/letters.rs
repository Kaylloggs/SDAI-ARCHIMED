//! Rédaction des candidatures par le CLI Antigravity (`agy`).
//!
//! Pourquoi `agy` plutôt que le moteur de chat : une lettre est un aller-retour unique,
//! sans outils ni contexte de projet. Passer par Antigravity coûte nettement moins cher
//! qu'un tour de conversation complet, et laisse la conversation de l'utilisateur intacte.
//!
//! Le style est tenu par le skill **humanizer** (installé avec Claude Code) : ses règles
//! sont injectées dans le prompt, parce qu'`agy` ne connaît pas les skills de Claude.
//! Sans lui, on retombe sur un jeu de consignes minimal équivalent.

use std::path::PathBuf;
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::core::{AppError, AppResult};

/// Ce qu'on demande d'écrire.
#[derive(Debug, Deserialize)]
pub struct LetterRequest {
    /// `letter` (lettre de motivation), `email` (mail de candidature), `answer` (réponse libre).
    pub kind: String,
    pub offer: Value,
    /// Texte du CV, déjà extrait.
    pub cv: Option<String>,
    /// Ce que la personne veut mettre en avant.
    pub notes: Option<String>,
    /// `fr` ou `en` — par défaut la langue de l'annonce.
    pub language: Option<String>,
    /// Question posée par le formulaire, pour `kind = "answer"`.
    pub question: Option<String>,
    /// Modèle Antigravity ; `None` = celui par défaut du CLI.
    pub model: Option<String>,
    /// Le message part à une personne de l'entreprise, pas à l'adresse de l'annonce.
    #[serde(default)]
    pub direct_contact: bool,
    /// La candidature a déjà été déposée par la voie officielle.
    #[serde(default)]
    pub already_applied: bool,
}

#[derive(Debug, Serialize)]
pub struct LetterResult {
    pub text: String,
    /// Tokens consommés par Antigravity, pour l'affichage du coût.
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Emplacements où chercher le skill humanizer.
fn humanizer_rules() -> String {
    let home = dirs_home();
    let candidates = [
        home.join(".claude/skills/humanizer/SKILL.md"),
        home.join(".claude/skills/anthropic-skills/humanizer/SKILL.md"),
    ];
    for path in candidates {
        if let Ok(text) = std::fs::read_to_string(&path) {
            // Le skill est long : on garde le corps des règles, pas ses métadonnées.
            let body = text
                .split("---")
                .last()
                .unwrap_or(&text)
                .trim()
                .chars()
                .take(6000)
                .collect::<String>();
            return body;
        }
    }
    FALLBACK_RULES.to_string()
}

/// Consignes de repli quand le skill humanizer n'est pas installé.
const FALLBACK_RULES: &str = "\
Écris comme une personne, pas comme un modèle de langue :
- pas de superlatifs creux (« passionné », « dynamique », « à la pointe »), pas de formules toutes faites ;
- pas de triades rythmées, pas de « non seulement… mais aussi », pas de tirets cadratins décoratifs ;
- des phrases de longueurs inégales, du concret : ce qui a été fait, où, avec quel résultat ;
- aucune promesse invérifiable, aucune information inventée sur le parcours ;
- ton direct et poli, sans flagornerie envers l'entreprise.";

fn dirs_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// Construit la consigne envoyée à Antigravity.
fn prompt(request: &LetterRequest) -> String {
    let offer = &request.offer;
    let field = |key: &str| offer.get(key).and_then(Value::as_str).unwrap_or("");
    let language = request.language.as_deref().unwrap_or("fr");
    let langue = if language == "en" { "anglais" } else { "français" };

    let quoi = match (request.kind.as_str(), request.direct_contact) {
        ("email", true) => {
            "un e-mail court adressé à quelqu'un de l'entreprise (objet + corps, 120 mots maximum)"
        }
        ("email", false) => "un e-mail de candidature (objet + corps, 150 mots maximum)",
        ("answer", _) => "une réponse à la question d'un formulaire de candidature",
        _ => "une lettre de motivation (250 à 320 mots)",
    };

    let mut sections = vec![format!(
        "Tu rédiges {quoi}, en {langue}. Rends uniquement le texte final, sans commentaire, \
sans titre ajouté, sans balise de code."
    )];

    sections.push(format!(
        "OFFRE\n- Poste : {}\n- Entreprise : {}\n- Lieu : {}\n- Contrat : {}\n- Source : {}\n- Lien : {}",
        field("title"),
        field("company"),
        field("location"),
        field("contract"),
        field("source_label"),
        field("url"),
    ));

    if request.direct_contact {
        // Écrire deux fois à la même entreprise se retourne contre la personne si le
        // message ne dit pas d'où il vient : la démarche doit être annoncée telle
        // quelle, en une phrase, sans excuse ni relance déguisée.
        let deja = if request.already_applied {
            "La candidature est déjà partie par la voie officielle (annonce ou formulaire)."
        } else {
            "La candidature part par la voie officielle (annonce ou formulaire) en même temps que ce message."
        };
        sections.push(format!(
            "CONTEXTE — DÉMARCHE DIRECTE
- Ce message ne va pas à la boîte de candidature de l'annonce, mais à une adresse de l'entreprise.
- {deja}
- Dis-le franchement en une phrase : l'annonce a été vue, la candidature déposée, et la personne
  préfère aussi s'adresser directement à quelqu'un de l'entreprise.
- Reste bref et utile : deux ou trois phrases sur ce qui colle au poste, une proposition d'échange.
- Pas d'excuse pour le double envoi, pas de relance, pas de pression, pas de pièce jointe annoncée
  qui n'existe pas."
        ));
    }

    if let Some(description) = offer.get("description").and_then(Value::as_str) {
        let trimmed: String = description.chars().take(2500).collect();
        sections.push(format!("TEXTE DE L'ANNONCE\n{trimmed}"));
    }
    if let Some(cv) = request.cv.as_deref().filter(|cv| !cv.trim().is_empty()) {
        let trimmed: String = cv.chars().take(6000).collect();
        sections.push(format!(
            "CV DE LA PERSONNE (n'invente rien qui n'y figure pas)\n{trimmed}"
        ));
    }
    if let Some(notes) = request.notes.as_deref().filter(|n| !n.trim().is_empty()) {
        sections.push(format!("À METTRE EN AVANT\n{notes}"));
    }
    if let Some(question) = request.question.as_deref() {
        sections.push(format!("QUESTION POSÉE\n{question}"));
    }

    sections.push(format!("STYLE — RÈGLES À SUIVRE\n{}", humanizer_rules()));
    sections.join("\n\n")
}

/// Demande le texte à `agy` et renvoie sa réponse.
pub async fn write(request: LetterRequest) -> AppResult<LetterResult> {
    let binary = which::which("agy").map_err(|_| {
        AppError::invalid(
            "Antigravity CLI (`agy`) est introuvable : installez-le, ou rédigez la lettre depuis le module Chat.",
        )
    })?;

    let mut args: Vec<String> = Vec::new();
    if let Some(model) = request.model.as_deref() {
        let (id, effort) = crate::engine::event::split_model(model);
        args.push("--model".to_string());
        args.push(id.to_string());
        if let Some(effort) = effort {
            args.push("--effort".to_string());
            args.push(effort.to_string());
        }
    }
    // Même protocole que l'adaptateur du moteur : `-p=` vide en dernier, message sur stdin.
    args.extend(
        [
            "--print-timeout",
            "10m",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "-p=",
        ]
        .iter()
        .map(|s| s.to_string()),
    );

    let mut child = crate::core::process::async_command(&binary)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let message = json!({
        "event": "user",
        "message": {"role": "user", "content": [{"type": "text", "text": prompt(&request)}]}
    });
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{}\n", serde_json::to_string(&message)?).as_bytes())
            .await?;
        stdin.flush().await?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::internal("sortie d'Antigravity illisible"))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut outcome = None;
    while let Some(line) = lines.next_line().await? {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("event").and_then(Value::as_str) == Some("result") {
            outcome = value.get("result").cloned();
            break;
        }
    }
    // Le processus reste ouvert pour d'autres tours : ici, un seul suffit.
    let _ = child.kill().await;

    let result = outcome.ok_or_else(|| AppError::internal("Antigravity n'a rien renvoyé"))?;
    if result.get("status").and_then(Value::as_str) == Some("ERROR") {
        let detail = result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("erreur inconnue");
        return Err(AppError::internal(format!("Antigravity : {detail}")));
    }

    let usage = result.get("usage").cloned().unwrap_or_default();
    let count = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
    Ok(LetterResult {
        text: result
            .get("response")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string(),
        input_tokens: count("input_tokens"),
        output_tokens: count("output_tokens"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offer() -> Value {
        json!({
            "title": "Chargé de communication",
            "company": "Studio Kite",
            "location": "Paris, France",
            "contract": "fulltime",
            "source_label": "HelloWork",
            "url": "https://example.test/offre/1",
            "description": "Vous animerez les réseaux sociaux."
        })
    }

    #[test]
    fn prompt_contains_offer_cv_and_style_rules() {
        let text = prompt(&LetterRequest {
            kind: "letter".into(),
            offer: offer(),
            cv: Some("Licence en information-communication".into()),
            notes: Some("Disponible en janvier".into()),
            language: None,
            question: None,
            model: None,
            direct_contact: false,
            already_applied: false,
        });
        assert!(text.contains("Studio Kite"));
        assert!(text.contains("Licence en information-communication"));
        assert!(text.contains("Disponible en janvier"));
        assert!(text.contains("STYLE"));
        assert!(text.contains("lettre de motivation"));
    }

    #[test]
    fn email_and_answer_change_the_instruction() {
        let email = prompt(&LetterRequest {
            kind: "email".into(),
            offer: offer(),
            cv: None,
            notes: None,
            language: Some("en".into()),
            question: None,
            model: None,
            direct_contact: false,
            already_applied: false,
        });
        assert!(email.contains("e-mail de candidature"));
        assert!(email.contains("anglais"));

        let answer = prompt(&LetterRequest {
            kind: "answer".into(),
            offer: offer(),
            cv: None,
            notes: None,
            language: None,
            question: Some("Pourquoi nous ?".into()),
            model: None,
            direct_contact: false,
            already_applied: false,
        });
        assert!(answer.contains("Pourquoi nous ?"));
    }

    #[test]
    fn direct_contact_announces_the_application_already_sent() {
        let direct = prompt(&LetterRequest {
            kind: "email".into(),
            offer: offer(),
            cv: None,
            notes: None,
            language: None,
            question: None,
            model: None,
            direct_contact: true,
            already_applied: true,
        });
        assert!(direct.contains("DÉMARCHE DIRECTE"));
        assert!(direct.contains("déjà partie"));
        assert!(direct.contains("quelqu'un de l'entreprise"));

        // Sans candidature déposée, le message ne doit pas prétendre le contraire.
        let pending = prompt(&LetterRequest {
            kind: "email".into(),
            offer: offer(),
            cv: None,
            notes: None,
            language: None,
            question: None,
            model: None,
            direct_contact: true,
            already_applied: false,
        });
        assert!(!pending.contains("déjà partie"));
        assert!(pending.contains("en même temps que ce message"));
    }
}
