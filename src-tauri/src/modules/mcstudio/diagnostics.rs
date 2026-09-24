//! Lecture des journaux de build : chaque erreur reconnue devient une cause probable,
//! un fichier, une ligne et une solution, en français. Rien n'est deviné au-delà de ce
//! que le journal contient ; une erreur non reconnue garde son message d'origine.

use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;

use super::types::{BuildIssue, IssueKind};

const MAX_ISSUES: usize = 50;

struct Patterns {
    javac: Regex,
    kotlin: Regex,
    major: Regex,
    java_required: Regex,
    plugin_missing: Regex,
    could_not_find: Regex,
}

fn patterns() -> Option<&'static Patterns> {
    static PATTERNS: OnceLock<Option<Patterns>> = OnceLock::new();
    PATTERNS
        .get_or_init(|| {
            Some(Patterns {
                javac: Regex::new(r"^(?P<file>(?:[A-Za-z]:)?[^:]+\.java):(?P<line>\d+): error: (?P<msg>.+)$").ok()?,
                kotlin: Regex::new(r"^e: (?:file://)?(?P<file>.+\.kt):(?P<line>\d+):(?P<col>\d+) (?P<msg>.+)$").ok()?,
                major: Regex::new(r"Unsupported class file major version (\d+)").ok()?,
                java_required: Regex::new(r"(?i)(?:requires Java|JVM runtime version|compatible with Java) (\d+)").ok()?,
                plugin_missing: Regex::new(r"Plugin \[id: '([^']+)'(?:, version: '([^']+)')?.*\] was not found").ok()?,
                could_not_find: Regex::new(r"Could not (?:find|resolve) ([A-Za-z0-9_.\-]+:[A-Za-z0-9_.\-]+(?::[A-Za-z0-9_.+\-\[\],()]+)?)").ok()?,
            })
        })
        .as_ref()
}

fn issue(kind: IssueKind, title: &str, message: &str, hint: Option<&str>) -> BuildIssue {
    BuildIssue {
        kind,
        title: title.to_string(),
        file: None,
        line: None,
        column: None,
        message: message.trim().to_string(),
        hint: hint.map(str::to_string),
    }
}

fn relative(root: &Path, file: &str) -> String {
    let path = Path::new(file.trim());
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

const MOD_PACKAGES: &[&str] = &[
    "net.minecraft",
    "com.mojang",
    "net.fabricmc",
    "net.minecraftforge",
    "net.neoforged",
];

/// Explication d'une erreur javac.
fn explain_java(message: &str, context: &[String]) -> (IssueKind, &'static str, &'static str) {
    let about_game = context
        .iter()
        .chain(std::iter::once(&message.to_string()))
        .any(|line| MOD_PACKAGES.iter().any(|package| line.contains(package)));
    if message.starts_with("cannot find symbol") {
        return (
            if about_game { IssueKind::Mapping } else { IssueKind::Java },
            "Classe, méthode ou variable inconnue",
            "Ce nom n'existe pas ici. Vérifiez l'orthographe et l'import ; pour une classe du jeu, le nom dépend de la version de Minecraft et des mappings du projet (Yarn pour Fabric, officiels pour Forge et NeoForge).",
        );
    }
    if message.starts_with("package ") && message.ends_with("does not exist") {
        return (
            if about_game { IssueKind::Mapping } else { IssueKind::Java },
            "Import introuvable",
            "Ce package n'existe pas pour cette version de Minecraft ou ce loader. Un code écrit pour une autre version ou un autre loader doit être adapté, pas seulement réimporté.",
        );
    }
    if message.contains("cannot be applied to given types") || message.starts_with("no suitable") {
        return (
            IssueKind::Java,
            "Mauvais arguments pour une méthode ou un constructeur",
            "La signature attendue diffère : elle a pu changer dans cette version de Minecraft. Comparez avec la déclaration de la classe utilisée.",
        );
    }
    if message.starts_with("incompatible types") {
        return (
            IssueKind::Java,
            "Types incompatibles",
            "La valeur n'a pas le type attendu à cet endroit.",
        );
    }
    if message.contains("does not override") || message.contains("is not abstract") {
        return (
            IssueKind::Java,
            "Méthode obligatoire manquante",
            "La classe hérite d'une méthode abstraite qu'elle doit implémenter (ou dont la signature a changé).",
        );
    }
    if message.contains("has private access") || message.contains("is not public") {
        return (
            IssueKind::Java,
            "Élément inaccessible",
            "Cet élément est privé dans cette version : passez par une méthode publique.",
        );
    }
    if message.ends_with("expected")
        || message.starts_with("illegal start")
        || message.starts_with("unclosed")
    {
        return (IssueKind::Java, "Erreur de syntaxe Java", "Symbole manquant ou en trop (point-virgule, parenthèse, accolade) près de cette ligne.");
    }
    (
        IssueKind::Java,
        "Erreur de compilation Java",
        "Lisez le message du compilateur à cette ligne.",
    )
}

/// Causes probables trouvées dans le journal, dans l'ordre d'apparition.
pub fn analyze(lines: &[String], root: &Path) -> Vec<BuildIssue> {
    let Some(p) = patterns() else {
        return Vec::new();
    };
    let mut issues: Vec<BuildIssue> = Vec::new();

    for (index, line) in lines.iter().enumerate() {
        let text = line.trim_end();
        if let Some(caps) = p.javac.captures(text) {
            let context: Vec<String> = lines.iter().skip(index + 1).take(5).cloned().collect();
            let message = &caps["msg"];
            let (kind, title, hint) = explain_java(message, &context);
            let detail = context
                .iter()
                .filter(|l| {
                    l.trim_start().starts_with("symbol:") || l.trim_start().starts_with("location:")
                })
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join("\n");
            let text = if detail.is_empty() {
                message.to_string()
            } else {
                format!("{message}\n{detail}")
            };
            let mut found = issue(kind, title, &text, Some(hint));
            found.file = Some(relative(root, &caps["file"]));
            found.line = caps["line"].parse().ok();
            issues.push(found);
            continue;
        }
        if let Some(caps) = p.kotlin.captures(text) {
            let mut found = issue(
                IssueKind::Java,
                "Erreur de compilation Kotlin",
                &caps["msg"],
                None,
            );
            found.file = Some(relative(root, &caps["file"]));
            found.line = caps["line"].parse().ok();
            found.column = caps["col"].parse().ok();
            issues.push(found);
            continue;
        }
        if let Some(caps) = p.major.captures(text) {
            issues.push(issue(
                IssueKind::JavaVersion,
                "Version de Java incompatible",
                text,
                Some(&format!(
                    "Du code compilé pour Java {} est lu par un outil trop ancien. Choisissez le JDK demandé par le profil du projet.",
                    caps[1].parse::<u32>().map(|m| m.saturating_sub(44)).unwrap_or(0)
                )),
            ));
            continue;
        }
        if let Some(caps) = p.java_required.captures(text) {
            issues.push(issue(
                IssueKind::JavaVersion,
                "Ce projet demande une autre version de Java",
                text,
                Some(&format!(
                    "Installez ou sélectionnez un JDK {} pour ce projet.",
                    &caps[1]
                )),
            ));
            continue;
        }
        if let Some(caps) = p.plugin_missing.captures(text) {
            let version = caps
                .get(2)
                .map(|v| format!(" {}", v.as_str()))
                .unwrap_or_default();
            issues.push(issue(
                IssueKind::Dependency,
                &format!("Plugin Gradle introuvable : {}{version}", &caps[1]),
                text,
                Some("Version de plugin inexistante, ou dépôt Maven injoignable. Vérifiez la connexion ; sinon, ajustez la version dans le profil du projet."),
            ));
            continue;
        }
        let network = [
            "Could not GET",
            "Could not HEAD",
            "UnknownHostException",
            "Connection refused",
            "Connect timed out",
            "Read timed out",
            "PKIX path building failed",
            "No cached version of",
            "java.net.SocketException",
        ];
        if network.iter().any(|needle| text.contains(needle)) {
            let refused = text.contains("status code 403") || text.contains("status code 407");
            issues.push(issue(
                IssueKind::Network,
                if refused { "Téléchargement refusé par le réseau" } else { "Téléchargement impossible" },
                text,
                Some(if refused {
                    "Le serveur ou un proxy a refusé l'accès (403/407). Vérifiez le pare-feu ou le proxy de votre réseau, puis relancez."
                } else {
                    "Une connexion Internet est nécessaire pour télécharger Gradle, Minecraft ou une dépendance. Relancez une fois connecté : les builds suivants réutilisent le cache."
                }),
            ));
            continue;
        }
        if let Some(caps) = p.could_not_find.captures(text) {
            issues.push(issue(
                IssueKind::Dependency,
                &format!("Dépendance introuvable : {}", &caps[1]),
                text,
                Some("Vérifiez la version dans gradle.properties ou build.gradle, et que le dépôt Maven qui la publie est déclaré."),
            ));
            continue;
        }
        if [
            "JsonSyntaxException",
            "MalformedJsonException",
            "JsonParseException",
        ]
        .iter()
        .any(|n| text.contains(n))
        {
            issues.push(issue(IssueKind::Json, "Fichier JSON invalide", text, Some("Un fichier JSON du mod est mal formé : lancez la validation du projet pour le localiser.")));
            continue;
        }
        if text.contains("GradleWrapperMain") {
            issues.push(issue(
                IssueKind::Gradle,
                "Gradle Wrapper endommagé",
                text,
                Some("gradle/wrapper/gradle-wrapper.jar manque ou est abîmé. Recréez le projet ou restaurez ce fichier."),
            ));
            continue;
        }
        if text.contains("JAVA_HOME is set to an invalid directory") {
            issues.push(issue(
                IssueKind::JavaVersion,
                "JDK introuvable",
                text,
                Some("Le JDK choisi a été déplacé ou désinstallé : relancez la détection de Java."),
            ));
        }
    }

    // Rien de précis : on garde le bloc « What went wrong » de Gradle tel quel.
    if issues.is_empty() {
        if let Some(start) = lines
            .iter()
            .position(|l| l.trim_start().starts_with("* What went wrong"))
        {
            let block: Vec<&str> = lines[start + 1..]
                .iter()
                .map(|l| l.trim())
                .take_while(|l| !l.starts_with("* Try") && !l.starts_with("* Exception"))
                .filter(|l| !l.is_empty())
                .collect();
            if !block.is_empty() {
                issues.push(issue(
                    IssueKind::Gradle,
                    "Gradle a signalé une erreur",
                    &block.join("\n"),
                    None,
                ));
            }
        }
    }

    let mut seen = HashSet::new();
    issues.retain(|i| seen.insert((i.title.clone(), i.file.clone(), i.line, i.message.clone())));
    // La cause la plus en amont d'abord : sans réseau, les dépendances « introuvables »
    // n'en sont que la conséquence.
    issues.sort_by_key(|i| priority(i.kind));
    issues.truncate(MAX_ISSUES);
    issues
}

fn priority(kind: IssueKind) -> u8 {
    match kind {
        IssueKind::Network => 0,
        IssueKind::JavaVersion => 1,
        IssueKind::Java | IssueKind::Mapping => 2,
        IssueKind::Json => 3,
        IssueKind::Dependency => 4,
        IssueKind::Gradle => 5,
        IssueKind::Unknown => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines().map(str::to_string).collect()
    }

    #[test]
    fn javac_errors_point_to_file_and_line() {
        let root = Path::new("/p/mod");
        let log = lines(
            "> Task :compileJava FAILED\n\
/p/mod/src/main/java/com/x/registry/ModItems.java:14: error: cannot find symbol\n\
    public static final Item RUBY = register(\"ruby\", new Item(new Item.Settings().maxCount(16)));\n\
                                                                                ^\n\
  symbol:   method maxCount(int)\n\
  location: class net.minecraft.item.Item.Settings\n\
1 error\n",
        );
        let issues = analyze(&log, root);
        assert_eq!(issues.len(), 1);
        let first = &issues[0];
        assert_eq!(first.kind, IssueKind::Mapping);
        assert_eq!(
            first.file.as_deref(),
            Some("src/main/java/com/x/registry/ModItems.java")
        );
        assert_eq!(first.line, Some(14));
        assert_eq!(
            first.message,
            "cannot find symbol\nsymbol:   method maxCount(int)\nlocation: class net.minecraft.item.Item.Settings"
        );
    }

    #[test]
    fn windows_paths_and_syntax_errors() {
        let log = lines(r"C:\mods\m\src\main\java\a\B.java:3: error: ';' expected");
        let issues = analyze(&log, Path::new(r"C:\mods\m"));
        assert_eq!(issues[0].title, "Erreur de syntaxe Java");
        assert_eq!(issues[0].line, Some(3));
    }

    #[test]
    fn environment_problems_are_named() {
        let root = Path::new("/p");
        let network = analyze(
            &lines("> Could not GET 'https://maven.fabricmc.net/x.pom'."),
            root,
        );
        assert_eq!(network[0].kind, IssueKind::Network);
        let plugin = analyze(&lines("Plugin [id: 'fabric-loom', version: '1.99-SNAPSHOT'] was not found in any of the following sources:"), root);
        assert_eq!(plugin[0].kind, IssueKind::Dependency);
        assert!(plugin[0].title.contains("fabric-loom 1.99-SNAPSHOT"));
        let java = analyze(&lines("Unsupported class file major version 65"), root);
        assert_eq!(java[0].kind, IssueKind::JavaVersion);
        assert!(java[0].hint.as_deref().unwrap_or("").contains("Java 21"));
        let dep = analyze(
            &lines("   > Could not find net.fabricmc.fabric-api:fabric-api:0.0.1+1.21.1."),
            root,
        );
        assert_eq!(dep[0].kind, IssueKind::Dependency);
    }

    #[test]
    fn gradle_block_is_the_fallback() {
        let log = lines("FAILURE: Build failed with an exception.\n\n* What went wrong:\nExecution failed for task ':remapJar'.\n> boom\n\n* Try:\n> Run with --stacktrace");
        let issues = analyze(&log, Path::new("/p"));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].kind, IssueKind::Gradle);
        assert!(issues[0].message.contains("remapJar") && issues[0].message.contains("boom"));
    }

    /// Journal réel : NeoForge 1.21.1, dépôt maven.neoforged.net bloqué par un proxy.
    #[test]
    fn real_blocked_repository_log_blames_the_network() {
        let log = lines(include_str!("fixtures/neoforge-maven-403.txt"));
        let issues = analyze(&log, Path::new("/work/testmod"));
        assert_eq!(issues[0].kind, IssueKind::Network);
        assert_eq!(issues[0].title, "Téléchargement refusé par le réseau");
        assert!(issues
            .iter()
            .any(|i| i.kind == IssueKind::Dependency && i.title.contains("neoform-runtime")));
    }

    #[test]
    fn duplicates_are_collapsed() {
        let log = lines("Could not GET 'x'\nCould not GET 'x'");
        assert_eq!(analyze(&log, Path::new("/p")).len(), 1);
    }
}
