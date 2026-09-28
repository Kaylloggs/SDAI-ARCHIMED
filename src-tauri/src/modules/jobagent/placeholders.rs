//! Champs à remplir laissés par le modèle dans une candidature (« Bonjour [name], »,
//! « chez [Entreprise] », « [Votre nom] ») : jamais envoyés tels quels.
//!
//! Le nom du destinataire est presque toujours inconnu : la salutation devient « Bonjour, »
//! (« Hello, » en anglais). L'entreprise et le poste sont remplis depuis l'annonce ; les autres
//! champs sont retirés, et une ligne qui n'était qu'un champ (signature, téléphone) disparaît.

use std::sync::OnceLock;

use regex::Regex;

/// Champ entre crochets, accolades (simples ou doubles) ou chevrons, sur une ligne.
const FIELD: &str = r"(?:\[[^\]\n]{1,60}\]|\{\{?[^}\n]{1,60}\}?\}|<[^<>\n@/]{1,60}>)";

fn regex(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("motif valide"))
}

fn greeting() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    regex(
        &CELL,
        &format!(r"(?im)^([ \t]*)(bonjour|bonsoir|hello|hi|dear|cher|chère|madame(?:,?[ \t]*monsieur)?|monsieur)[ \t]*{FIELD}(?:[ \t]*{FIELD})*[ \t]*[,!]?"),
    )
}

fn field() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    regex(&CELL, &format!("[ \t]?{FIELD}"))
}

/// Ligne réduite à des champs retirés (marqués `\0`).
fn emptied_line() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    regex(&CELL, r"(?m)^[ \t]*(?:\x00[ \t,.;:-]*)+$\n?")
}

/// Mots qui trahissent un champ à remplir (le reste entre crochets est gardé).
fn is_placeholder(inner: &str) -> bool {
    const WORDS: &[&str] = &[
        "nom", "name", "prénom", "prenom", "entreprise", "société", "societe", "company", "poste",
        "position", "role", "rôle", "job", "titre", "title", "recruteur", "recruiter", "destinataire",
        "recipient", "contact", "manager", "responsable", "votre", "your", "insérer", "inserer",
        "insert", "date", "adresse", "address", "téléphone", "telephone", "phone", "mail", "lien",
        "link", "linkedin", "signature", "ville", "city", "xxx", "...", "…",
    ];
    let lower = inner.to_lowercase();
    WORDS.iter().any(|word| lower.contains(word))
}

fn french(text: &str) -> bool {
    let lower = format!(" {} ", text.to_lowercase().replace(['\n', ',', '.', '!', '?'], " "));
    [" vous ", " bonjour ", " je ", " votre ", " cordialement ", " mon ", " avec ", " chez "]
        .iter()
        .any(|w| lower.contains(w))
        || lower.contains(['é', 'è', 'ê', 'à', 'ç', 'ù'])
}

/// Remplace ou retire les champs à remplir ; `company` et `title` viennent de l'annonce.
pub fn clean(text: &str, company: &str, title: &str) -> String {
    let fr = french(text);
    let company = company.trim();
    let title = title.trim();

    // 1. Salutation : jamais de nom inventé.
    let out = greeting().replace_all(text, |caps: &regex::Captures| {
        let indent = &caps[1];
        let word = caps[2].to_lowercase();
        let hello = match word.as_str() {
            w if w.starts_with("madame") || w == "monsieur" => "Madame, Monsieur,",
            "bonsoir" => "Bonsoir,",
            "bonjour" | "cher" | "chère" => "Bonjour,",
            _ if fr => "Bonjour,",
            _ => "Hello,",
        };
        format!("{indent}{hello}")
    });

    // 2. Entreprise et poste depuis l'annonce ; le reste est retiré.
    let out = field().replace_all(&out, |caps: &regex::Captures| {
        let whole = &caps[0];
        let lead = if whole.starts_with([' ', '\t']) { &whole[..1] } else { "" };
        let inner = whole.trim().trim_matches(|c| matches!(c, '[' | ']' | '{' | '}' | '<' | '>'));
        if !is_placeholder(inner) {
            return whole.to_string();
        }
        let lower = inner.to_lowercase();
        if ["entreprise", "société", "societe", "company"].iter().any(|w| lower.contains(w)) {
            let name = if company.is_empty() { if fr { "votre entreprise" } else { "your company" } } else { company };
            return format!("{lead}{name}");
        }
        if ["poste", "position", "job", "role", "rôle", "intitulé"].iter().any(|w| lower.contains(w)) {
            let name = if title.is_empty() { if fr { "ce poste" } else { "this position" } } else { title };
            return format!("{lead}{name}");
        }
        // Retiré : une ligne qui n'en contient pas d'autre disparaîtra à l'étape 3.
        format!("{lead}\u{0}")
    });

    // 3. Lignes réduites à des champs retirés (signature, coordonnées) : supprimées.
    let out = emptied_line().replace_all(&out, "").replace('\u{0}', "");

    // 4. Ponctuation et espaces laissés par les retraits.
    let tidy = [
        (r"[ \t]+([,.;:!?])", "$1"),
        (r"[ \t]{2,}", " "),
        (r"(?m)[ \t]+$", ""),
        (r"\n{3,}", "\n\n"),
    ];
    let mut out = out.to_string();
    for (pattern, replacement) in tidy {
        out = Regex::new(pattern).expect("motif valide").replace_all(&out, replacement).into_owned();
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn a_greeting_never_keeps_an_unknown_name() {
        assert_eq!(clean("Bonjour [name],\n\nJe candidate.", "", ""), "Bonjour,\n\nJe candidate.");
        assert_eq!(clean("Bonjour [Nom du recruteur] !\nMerci.", "", ""), "Bonjour,\nMerci.");
        assert_eq!(clean("Madame, Monsieur [Nom],\nVoici ma candidature.", "", ""), "Madame, Monsieur,\nVoici ma candidature.");
        assert_eq!(clean("Dear [Hiring Manager],\nI am applying.", "", ""), "Hello,\nI am applying.");
        assert_eq!(clean("Hi {{name}},\nThanks.", "", ""), "Hello,\nThanks.");
        // Déjà correct : inchangé.
        assert_eq!(clean("Bonjour Mme Martin,\nMerci.", "", ""), "Bonjour Mme Martin,\nMerci.");
    }

    #[test]
    fn company_and_title_come_from_the_offer_and_other_fields_go() {
        let text = "Bonjour [Prénom],\n\nLe poste de [Intitulé du poste] chez [Nom de l'entreprise] m'intéresse.\nJe vous joins mon CV [lien].\n\nCordialement,\n[Votre nom]\n[Téléphone]";
        assert_eq!(
            clean(text, "Studio Lune", "Développeur Rust"),
            "Bonjour,\n\nLe poste de Développeur Rust chez Studio Lune m'intéresse.\nJe vous joins mon CV.\n\nCordialement,"
        );
        assert_eq!(clean("Je rejoindrais [Entreprise] avec plaisir.", "", ""), "Je rejoindrais votre entreprise avec plaisir.");
    }

    #[test]
    fn real_brackets_are_left_alone() {
        let text = "Bonjour,\nMon portfolio [PDF] est joint, voir la section [3].";
        assert_eq!(clean(text, "", ""), text);
    }
}
