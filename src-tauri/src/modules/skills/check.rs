//! Vérification d'un skill avant son entrée dans la bibliothèque : format de l'en-tête, qualité
//! de la description (c'est elle qui décide quand une IA consulte le skill), longueur du corps,
//! liens vers des fichiers absents, fichiers jamais cités, scripts et commandes risquées,
//! secrets oubliés. Une erreur bloque l'enregistrement ; un avertissement ne fait qu'alerter.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

use super::frontmatter;
use super::types::{CheckIssue, CheckLevel};

/// Longueurs admises par le format Agent Skills (Claude Code, Antigravity…).
pub const NAME_MAX: usize = 64;
pub const DESCRIPTION_MAX: usize = 1024;
/// Au-delà, le corps devrait renvoyer vers des fichiers de `references/`.
const BODY_LINES_MAX: usize = 500;
/// Au-delà, un fichier de référence gagne à avoir un sommaire.
const REFERENCE_TOC_LINES: usize = 300;
const LARGE_FILE: u64 = 5 * 1024 * 1024;

/// Résumé d'un skill vérifié.
pub struct Checked {
    pub name: Option<String>,
    pub description: Option<String>,
    pub body_lines: usize,
    pub scripts: Vec<String>,
    pub issues: Vec<CheckIssue>,
}

/// Fichier du skill : chemin relatif (`/`), taille, contenu texte s'il en est un.
pub struct SkillFile {
    pub path: String,
    pub size: u64,
    pub text: Option<String>,
}

pub fn check(files: &[SkillFile]) -> Checked {
    let mut issues = Vec::new();
    let mut add = |level: CheckLevel, code: &str, message: String, file: Option<&str>, line: Option<usize>| {
        issues.push(CheckIssue {
            level,
            code: code.into(),
            message,
            file: file.map(Into::into),
            line,
        });
    };

    let scripts: Vec<String> = files.iter().filter(|f| is_script(&f.path)).map(|f| f.path.clone()).collect();

    let Some(skill_md) = files.iter().find(|f| f.path == "SKILL.md") else {
        add(CheckLevel::Error, "skill_md_missing", "Il manque le fichier SKILL.md, le cœur du skill.".into(), None, None);
        return Checked { name: None, description: None, body_lines: 0, scripts, issues };
    };
    let content = skill_md.text.clone().unwrap_or_default();
    let header = frontmatter::parse(&content);
    let name = header.get("name").map(str::to_string).filter(|n| !n.is_empty());
    let description = header.get("description").map(str::to_string).filter(|d| !d.is_empty());

    if !header.present {
        add(
            CheckLevel::Error,
            "frontmatter_missing",
            "SKILL.md doit commencer par un en-tête entre deux lignes « --- » avec name et description.".into(),
            Some("SKILL.md"),
            Some(1),
        );
    }

    match &name {
        None if header.present => add(CheckLevel::Error, "name_missing", "L'en-tête n'a pas de champ name.".into(), Some("SKILL.md"), Some(2)),
        Some(value) if !valid_name(value) => add(
            CheckLevel::Error,
            "name_format",
            format!("« {value} » : le nom ne peut contenir que des minuscules, des chiffres et des tirets, {NAME_MAX} caractères au plus (ex. « rapport-hebdo »)."),
            Some("SKILL.md"),
            line_of(&content, "name:"),
        ),
        _ => {}
    }

    match &description {
        None if header.present => add(
            CheckLevel::Error,
            "description_missing",
            "L'en-tête n'a pas de description : sans elle, aucune IA ne saura quand utiliser le skill.".into(),
            Some("SKILL.md"),
            None,
        ),
        Some(text) => {
            let at = line_of(&content, "description:");
            let length = text.chars().count();
            if length > DESCRIPTION_MAX {
                add(
                    CheckLevel::Error,
                    "description_too_long",
                    format!("Description de {length} caractères : {DESCRIPTION_MAX} au plus. Gardez ce qui dit quoi et quand, le détail va dans le corps."),
                    Some("SKILL.md"),
                    at,
                );
            } else if length < 60 {
                add(
                    CheckLevel::Warning,
                    "description_short",
                    "Description très courte : dites ce que fait le skill et dans quelles situations l'utiliser, avec les mots que la personne emploierait.".into(),
                    Some("SKILL.md"),
                    at,
                );
            }
            if !mentions_when(text) {
                add(
                    CheckLevel::Warning,
                    "description_no_trigger",
                    "La description ne dit pas quand utiliser le skill (« À utiliser quand… », « Use when… ») : les IA risquent de ne pas s'en servir.".into(),
                    Some("SKILL.md"),
                    at,
                );
            }
            if text.contains('<') && text.contains('>') {
                add(
                    CheckLevel::Warning,
                    "description_markup",
                    "La description contient des balises < > : certaines IA refusent les balises dans ce champ.".into(),
                    Some("SKILL.md"),
                    at,
                );
            }
        }
        None => {}
    }

    let body: Vec<&str> = if header.present {
        content.lines().skip(header.body_start.saturating_sub(1)).collect()
    } else {
        content.lines().collect()
    };
    let body_lines = body.len();
    if body.iter().filter(|l| !l.trim().is_empty()).count() < 3 {
        add(
            CheckLevel::Error,
            "body_empty",
            "Le corps de SKILL.md est presque vide : écrivez les étapes, les règles et un exemple.".into(),
            Some("SKILL.md"),
            Some(header.body_start.max(1)),
        );
    } else if body_lines > BODY_LINES_MAX {
        add(
            CheckLevel::Warning,
            "body_long",
            format!("SKILL.md fait {body_lines} lignes : au-delà de {BODY_LINES_MAX}, déplacez le détail dans references/ et indiquez quand le lire."),
            Some("SKILL.md"),
            None,
        );
    }

    // Fichiers cités par SKILL.md mais absents.
    let known: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    for (target, line) in cited_paths(&content) {
        let exists = known.iter().any(|path| *path == target || path.starts_with(&format!("{target}/")));
        if !exists {
            add(
                CheckLevel::Error,
                "link_missing",
                format!("SKILL.md cite « {target} », qui n'existe pas dans le skill."),
                Some("SKILL.md"),
                Some(line),
            );
        }
    }

    for file in files {
        // Fichiers de références jamais cités : l'IA ne saura pas qu'ils existent.
        if file.path.starts_with("references/") {
            let file_name = file.path.rsplit('/').next().unwrap_or(&file.path);
            let cited = content.contains(&file.path) || content.contains(file_name) || skill_mentions_folder(&content, "references");
            if !cited {
                add(
                    CheckLevel::Info,
                    "orphan_file",
                    format!("{} n'est jamais cité dans SKILL.md : dites quand le lire, sinon il ne servira pas.", file.path),
                    Some(&file.path),
                    None,
                );
            }
            if let Some(text) = &file.text {
                let lines = text.lines().count();
                if lines > REFERENCE_TOC_LINES && !has_toc(text) {
                    add(
                        CheckLevel::Info,
                        "reference_no_toc",
                        format!("{} fait {lines} lignes : un sommaire en tête aide l'IA à n'en lire que la partie utile.", file.path),
                        Some(&file.path),
                        Some(1),
                    );
                }
            }
        }
        if file.size > LARGE_FILE {
            add(
                CheckLevel::Warning,
                "large_file",
                format!("{} pèse {} Mo : un skill se copie vers chaque IA, gardez-le léger.", file.path, file.size / (1024 * 1024)),
                Some(&file.path),
                None,
            );
        }
        let Some(text) = &file.text else { continue };
        for (index, line) in text.lines().enumerate() {
            if let Some(kind) = secret_in(line) {
                add(
                    CheckLevel::Error,
                    "secret",
                    format!("Ce qui ressemble à {kind} est écrit en clair : retirez-le, un skill se copie et se partage."),
                    Some(&file.path),
                    Some(index + 1),
                );
            }
            // Commandes risquées : dans les scripts, et dans les blocs de code de SKILL.md.
            if (is_script(&file.path) || file.path == "SKILL.md") && !line.trim_start().starts_with('#') {
                if let Some(what) = risky_command(line) {
                    add(
                        CheckLevel::Warning,
                        "risky_command",
                        format!("Commande risquée ({what}) : vérifiez qu'elle est voulue et bornée."),
                        Some(&file.path),
                        Some(index + 1),
                    );
                }
            }
        }
    }

    if !scripts.is_empty() {
        add(
            CheckLevel::Info,
            "scripts_present",
            format!(
                "Le skill contient {} script(s) exécutable(s) ({}) : relisez-les, l'IA pourra les lancer.",
                scripts.len(),
                scripts.join(", ")
            ),
            None,
            None,
        );
    }

    Checked { name, description, body_lines, scripts, issues }
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= NAME_MAX
        && name.split('-').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

fn mentions_when(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "quand", "lorsque", "lorsqu", "dès que", "chaque fois", "si la personne", "si l'utilisateur", "à utiliser",
        "utilise ce skill", "utilisez ce skill", "when ", "whenever", "use this", "use it", "use for", "use when", "trigger",
        "if the user", "for any",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

fn line_of(content: &str, prefix: &str) -> Option<usize> {
    content.lines().position(|l| l.starts_with(prefix)).map(|i| i + 1)
}

fn skill_mentions_folder(content: &str, folder: &str) -> bool {
    content.contains(&format!("{folder}/*")) || content.contains(&format!("dossier {folder}")) || content.contains(&format!("{folder} folder"))
}

/// Chemins relatifs cités par SKILL.md (liens Markdown, code en ligne) sous `references/`,
/// `scripts/`, `assets/`, `templates/` ou `examples/`.
static CITED: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"(?:\]\(|`)((?:\./)?(?:references|scripts|assets|templates|examples)/[^)`\s#?*]+)").ok());

fn cited_paths(content: &str) -> Vec<(String, usize)> {
    let Some(pattern) = CITED.as_ref() else { return Vec::new() };
    let mut out: Vec<(String, usize)> = Vec::new();
    for (index, line) in content.lines().enumerate() {
        for capture in pattern.captures_iter(line) {
            let path = capture[1].trim_start_matches("./").trim_end_matches(['.', ',', ';', ':']).to_string();
            if !path.ends_with('/') && !out.iter().any(|(p, _)| *p == path) {
                out.push((path, index + 1));
            }
        }
    }
    out
}

fn has_toc(text: &str) -> bool {
    let head: String = text.lines().take(40).collect::<Vec<_>>().join("\n").to_lowercase();
    head.contains("sommaire") || head.contains("table des matières") || head.contains("contents") || head.matches("](#").count() >= 3
}

fn is_script(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.starts_with("scripts/")
        || [".sh", ".ps1", ".bat", ".cmd", ".py", ".js", ".mjs", ".ts", ".rb", ".pl"].iter().any(|ext| lower.ends_with(ext))
}

/// Motifs compilés une fois pour toutes.
fn compile(patterns: &[(&str, &'static str)]) -> Vec<(Regex, &'static str)> {
    patterns.iter().filter_map(|(pattern, label)| Regex::new(pattern).ok().map(|re| (re, *label))).collect()
}

static SECRETS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    compile(&[
        (r"sk-(?:ant-|or-|proj-)?[A-Za-z0-9_\-]{20,}", "une clé d'API"),
        (r"AKIA[0-9A-Z]{16}", "une clé AWS"),
        (r"gh[pousr]_[A-Za-z0-9]{30,}", "un jeton GitHub"),
        (r"xox[abprs]-[A-Za-z0-9-]{10,}", "un jeton Slack"),
        (r"AIza[0-9A-Za-z_\-]{35}", "une clé Google"),
        (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", "une clé privée"),
        (r#"(?i)(?:password|mot de passe|passwd|secret)\s*[:=]\s*["'][^"'\s]{6,}["']"#, "un mot de passe"),
    ])
});

static RISKY: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    compile(&[
        (r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r", "suppression récursive forcée"),
        (r"(?i)Remove-Item\b.*-Recurse\b.*-Force|Remove-Item\b.*-Force\b.*-Recurse", "suppression récursive forcée"),
        (r"(?i)\b(?:rd|rmdir|del)\s+/s\b", "suppression récursive"),
        (r"(?i)\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b", "script téléchargé puis exécuté"),
        (r"(?i)(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|]*\|\s*(?:iex|Invoke-Expression)", "script téléchargé puis exécuté"),
        (r"(?i)\b(?:powershell|pwsh)(?:\.exe)?\b.*\s-(?:e|enc|encodedcommand)\s", "commande PowerShell encodée"),
        (r"(?i)\breg(?:\.exe)?\s+(?:add|delete)\b", "modification du registre"),
        (r"(?i)Set-MpPreference\b|Add-MpPreference\b", "réglage de Microsoft Defender"),
        (r"(?i)\bformat\s+[a-z]:", "formatage d'un disque"),
        (r"\bchmod\s+-?R?\s*777\b", "droits ouverts à tous"),
    ])
});

fn secret_in(line: &str) -> Option<&'static str> {
    SECRETS.iter().find(|(re, _)| re.is_match(line)).map(|(_, kind)| *kind)
}

fn risky_command(line: &str) -> Option<&'static str> {
    RISKY.iter().find(|(re, _)| re.is_match(line)).map(|(_, what)| *what)
}

/// Fichiers d'un dossier de skill, lus pour la vérification (texte jusqu'à 2 Mo).
pub fn collect(root: &Path) -> Vec<SkillFile> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                stack.push(path);
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            let text = if size <= 2 * 1024 * 1024 {
                std::fs::read(&path)
                    .ok()
                    .filter(|bytes| !bytes.iter().take(8_000).any(|b| *b == 0))
                    .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            } else {
                None
            };
            files.push(SkillFile { path: relative, size, text });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, text: &str) -> SkillFile {
        SkillFile { path: path.into(), size: text.len() as u64, text: Some(text.into()) }
    }

    fn codes(checked: &Checked) -> Vec<&str> {
        checked.issues.iter().map(|i| i.code.as_str()).collect()
    }

    const GOOD: &str = "---\nname: rapport-hebdo\ndescription: Rédige le rapport hebdomadaire de l'équipe à partir des tickets. À utiliser quand la personne demande un point de la semaine, un récapitulatif ou un rapport d'avancement.\n---\n\n# Rapport hebdo\n\n1. Lire les tickets fermés.\n2. Regrouper par thème (voir `references/format.md`).\n3. Écrire le rapport.\n";

    #[test]
    fn a_well_formed_skill_has_no_errors() {
        let checked = check(&[file("SKILL.md", GOOD), file("references/format.md", "# Format\n")]);
        assert_eq!(checked.name.as_deref(), Some("rapport-hebdo"));
        assert!(checked.issues.iter().all(|i| i.level != CheckLevel::Error), "{:?}", codes(&checked));
        assert!(!codes(&checked).contains(&"orphan_file"));
    }

    #[test]
    fn reports_structure_problems() {
        assert_eq!(codes(&check(&[file("README.md", "x")])), ["skill_md_missing"]);

        let bad = "---\nname: Mon Skill\ndescription: Fait des trucs.\n---\ncorps\n";
        let checked = check(&[file("SKILL.md", bad)]);
        let found = codes(&checked);
        for expected in ["name_format", "description_short", "description_no_trigger", "body_empty"] {
            assert!(found.contains(&expected), "{expected} absent de {found:?}");
        }

        let long = format!("---\nname: a\ndescription: {} quand on veut\n---\n{}", "x".repeat(1100), "ligne\n".repeat(600));
        let found = codes(&check(&[file("SKILL.md", &long)])).join(",");
        assert!(found.contains("description_too_long") && found.contains("body_long"), "{found}");
    }

    #[test]
    fn missing_links_orphans_scripts_and_secrets() {
        let checked = check(&[
            file("SKILL.md", GOOD.replace("references/format.md", "references/absent.md").as_str()),
            file("references/format.md", "# Format\n"),
            file("scripts/clean.ps1", "Remove-Item C:\\temp -Recurse -Force\n$key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'\n"),
        ]);
        let found = codes(&checked);
        for expected in ["link_missing", "orphan_file", "risky_command", "secret", "scripts_present"] {
            assert!(found.contains(&expected), "{expected} absent de {found:?}");
        }
        assert_eq!(checked.scripts, ["scripts/clean.ps1"]);
        let secret = checked.issues.iter().find(|i| i.code == "secret").unwrap();
        assert_eq!((secret.file.as_deref(), secret.line), (Some("scripts/clean.ps1"), Some(2)));
    }

    #[test]
    fn names_follow_the_format() {
        assert!(valid_name("pdf-tools") && valid_name("v2-export"));
        assert!(!valid_name("PDF") && !valid_name("a--b") && !valid_name("-a") && !valid_name(&"a".repeat(65)));
    }
}
