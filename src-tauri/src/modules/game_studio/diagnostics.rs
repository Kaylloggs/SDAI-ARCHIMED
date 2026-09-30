//! Lecture des erreurs dans la sortie des outils (§107) : GDScript et Godot, C# (Unity,
//! MSBuild), C++ (MSVC, clang, éditeur de liens), journaux Unreal et UAT, Python (Blender),
//! résultats de tests NUnit (Unity). Chaque erreur reçoit, quand elle est connue, sa cause
//! probable et une piste de correction, et les systèmes du graphe dont les fichiers sont
//! concernés.

use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;

use super::types::{GameDiagnostic, GameEngine, GameGraph, GameIssueSeverity, GameLogLevel};

/// Au-delà, la liste n'aide plus : les premières erreurs sont les causes.
const MAX_DIAGNOSTICS: usize = 200;
const MAX_WARNINGS: usize = 50;

struct Patterns {
    godot_at: Regex,
    compiler: Regex,
    linker: Regex,
    gcc: Regex,
    unreal_log: Regex,
    python_file: Regex,
    python_error: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        // `   at: GDScript::reload (res://scripts/main.gd:3)` ou `   at: load (modules/x.cpp:12)`
        godot_at: Regex::new(r"^\s*at: .*?\(([^()]+?):(\d+)\)\s*$").unwrap(),
        // C# et C++ MSVC : `Assets/X.cs(12,5): error CS1002: ; expected [proj]`
        compiler: Regex::new(
            r"^\s*(?P<file>[^\s(][^(]*?)\((?P<line>\d+)(?:,(?P<col>\d+))?\)\s*:\s*(?:fatal )?(?P<sev>error|warning) (?P<code>[A-Z]+\d+)\s*:\s*(?P<msg>.*?)(?:\s+\[[^\]]+\])?\s*$",
        )
        .unwrap(),
        linker: Regex::new(r"^\s*(?P<file>\S+) : (?:fatal )?error (?P<code>LNK\d+): (?P<msg>.*)$").unwrap(),
        // clang et gcc : `Source/X.cpp:12:5: error: message`
        gcc: Regex::new(r"^\s*(?P<file>[^\s:][^:]*?):(?P<line>\d+):(?P<col>\d+): (?:fatal )?(?P<sev>error|warning): (?P<msg>.*)$").unwrap(),
        // `[2026.09.30-18.00.00:000][  0]LogBlueprint: Error: [Compiler] …`
        unreal_log: Regex::new(r"^(?:\[[^\]]*\])*\s*(?P<cat>Log\w+): (?P<sev>Error|Warning): (?P<msg>.*)$").unwrap(),
        python_file: Regex::new(r#"^\s*File "(?P<file>[^"]+)", line (?P<line>\d+)"#).unwrap(),
        python_error: Regex::new(r"^(?P<kind>[A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt)): ?(?P<msg>.*)$").unwrap(),
    })
}

/// Niveau d'une ligne pour la coloration de la console.
pub fn line_level(text: &str) -> GameLogLevel {
    let lower = text.to_lowercase();
    let trimmed = lower.trim_start();
    if trimmed.starts_with("script error")
        || trimmed.starts_with("error")
        || trimmed.starts_with("user error")
        || lower.contains(": error ")
        || lower.contains(": error:")
        || lower.contains("error: ")
        || trimmed.starts_with("traceback")
        || lower.contains("exception:")
    {
        GameLogLevel::Error
    } else if trimmed.starts_with("warning")
        || trimmed.starts_with("script warning")
        || lower.contains(": warning ")
        || lower.contains(": warning:")
        || lower.contains("warning: ")
    {
        GameLogLevel::Warning
    } else {
        GameLogLevel::Info
    }
}

/// Chemin relatif au projet quand c'est possible (`res://`, chemin absolu dans le projet).
fn relative(file: &str, root: &Path) -> String {
    let file = file.trim();
    if let Some(rest) = file.strip_prefix("res://") {
        return rest.to_string();
    }
    let normal = file.replace('\\', "/");
    let base = root.display().to_string().replace('\\', "/");
    let base = base.trim_end_matches('/');
    if !base.is_empty()
        && normal.len() > base.len()
        && normal[..base.len()].eq_ignore_ascii_case(base)
    {
        return normal[base.len()..].trim_start_matches('/').to_string();
    }
    normal
}

fn diagnostic(severity: GameIssueSeverity, message: &str, source: &str) -> GameDiagnostic {
    GameDiagnostic {
        severity,
        message: message.trim().to_string(),
        file: None,
        line: None,
        column: None,
        code: None,
        source: source.to_string(),
        likely_cause: None,
        suggestion: None,
        systems: Vec::new(),
    }
}

/// Erreurs et avertissements lus dans une sortie complète.
pub fn parse(lines: &[String], root: &Path, engine: Option<GameEngine>) -> Vec<GameDiagnostic> {
    let p = patterns();
    let mut out: Vec<GameDiagnostic> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim_end();
        let next = lines.get(i + 1).map(|l| l.trim_end());
        // Godot répète chaque erreur d'analyse d'un script par un « Failed to load script » :
        // les erreurs utiles sont déjà lues.
        if line.starts_with("ERROR: Failed to load script") && line.contains("\"Parse error\"") {
            i += if next.is_some_and(|n| n.trim_start().starts_with("at:")) {
                2
            } else {
                1
            };
            continue;
        }
        let mut consumed = 1;
        let found = parse_godot(line, next, root, engine)
            .inspect(|_| consumed = 2)
            .or_else(|| parse_compiler(p, line, root))
            .or_else(|| parse_unreal(p, line, engine))
            .or_else(|| {
                parse_unity(line, next, engine).map(|(d, n)| {
                    consumed = n;
                    d
                })
            })
            .or_else(|| {
                parse_python(p, lines, i, root).map(|(d, n)| {
                    consumed = n;
                    d
                })
            });
        if let Some(mut d) = found {
            explain(&mut d);
            let duplicate = out
                .iter()
                .any(|o| o.message == d.message && o.file == d.file && o.line == d.line);
            if !duplicate {
                out.push(d);
            }
        }
        i += consumed.max(1);
    }
    limit(out)
}

fn limit(all: Vec<GameDiagnostic>) -> Vec<GameDiagnostic> {
    let mut warnings = 0;
    let mut out = Vec::new();
    // Les erreurs d'abord : ce sont elles qui font échouer.
    for d in all
        .iter()
        .filter(|d| d.severity == GameIssueSeverity::Error)
    {
        out.push(d.clone());
    }
    for d in all
        .into_iter()
        .filter(|d| d.severity != GameIssueSeverity::Error)
    {
        if warnings < MAX_WARNINGS {
            warnings += 1;
            out.push(d);
        }
    }
    out.truncate(MAX_DIAGNOSTICS);
    out
}

/// Godot : `SCRIPT ERROR: …`, `ERROR: …`, `USER ERROR: …`, `WARNING: …`, suivis de `at: …`.
fn parse_godot(
    line: &str,
    next: Option<&str>,
    root: &Path,
    engine: Option<GameEngine>,
) -> Option<GameDiagnostic> {
    if engine.is_some_and(|e| e != GameEngine::Godot) {
        return None;
    }
    let (severity, message, script) = if let Some(m) = line.strip_prefix("SCRIPT ERROR: ") {
        (GameIssueSeverity::Error, m, true)
    } else if let Some(m) = line.strip_prefix("SCRIPT WARNING: ") {
        (GameIssueSeverity::Warning, m, true)
    } else if let Some(m) = line.strip_prefix("USER ERROR: ") {
        (GameIssueSeverity::Error, m, true)
    } else if let Some(m) = line.strip_prefix("USER WARNING: ") {
        (GameIssueSeverity::Warning, m, true)
    } else if let Some(m) = line.strip_prefix("ERROR: ") {
        (GameIssueSeverity::Error, m, false)
    } else if let Some(m) = line.strip_prefix("WARNING: ") {
        (GameIssueSeverity::Warning, m, false)
    } else {
        return None;
    };
    let at = next.and_then(|n| patterns().godot_at.captures(n))?;
    let file = at.get(1).map(|m| m.as_str()).unwrap_or_default();
    let in_project = file.starts_with("res://");
    let source = if script || in_project {
        "GDScript"
    } else {
        "Godot"
    };
    let mut d = diagnostic(
        severity,
        message.strip_prefix("Parse Error: ").unwrap_or(message),
        source,
    );
    if message.starts_with("Parse Error: ") {
        d.code = Some("parse".to_string());
    }
    if in_project {
        d.file = Some(relative(file, root));
        d.line = at.get(2).and_then(|m| m.as_str().parse().ok());
    }
    Some(d)
}

fn parse_compiler(p: &Patterns, line: &str, root: &Path) -> Option<GameDiagnostic> {
    if let Some(c) = p.compiler.captures(line) {
        let code = c["code"].to_string();
        let source = if code.starts_with("CS") {
            "C#"
        } else if code.starts_with("MSB") || code.starts_with("NU") {
            "MSBuild"
        } else if code.starts_with('C') {
            "C++"
        } else {
            "Compilateur"
        };
        let severity = if &c["sev"] == "error" {
            GameIssueSeverity::Error
        } else {
            GameIssueSeverity::Warning
        };
        let mut d = diagnostic(severity, &c["msg"], source);
        d.file = Some(relative(&c["file"], root));
        d.line = c["line"].parse().ok();
        d.column = c.name("col").and_then(|m| m.as_str().parse().ok());
        d.code = Some(code);
        return Some(d);
    }
    if let Some(c) = p.linker.captures(line) {
        let mut d = diagnostic(GameIssueSeverity::Error, &c["msg"], "Éditeur de liens");
        d.code = Some(c["code"].to_string());
        d.file = Some(relative(&c["file"], root));
        return Some(d);
    }
    if let Some(c) = p.gcc.captures(line) {
        let severity = if &c["sev"] == "error" {
            GameIssueSeverity::Error
        } else {
            GameIssueSeverity::Warning
        };
        let mut d = diagnostic(severity, &c["msg"], "C++");
        d.file = Some(relative(&c["file"], root));
        d.line = c["line"].parse().ok();
        d.column = c["col"].parse().ok();
        return Some(d);
    }
    None
}

fn parse_unreal(p: &Patterns, line: &str, engine: Option<GameEngine>) -> Option<GameDiagnostic> {
    if engine.is_some_and(|e| e != GameEngine::Unreal) {
        return None;
    }
    if let Some(c) = p.unreal_log.captures(line) {
        let severity = if &c["sev"] == "Error" {
            GameIssueSeverity::Error
        } else {
            GameIssueSeverity::Warning
        };
        let source = if &c["cat"] == "LogBlueprint" {
            "Blueprint"
        } else {
            "Unreal"
        };
        let mut d = diagnostic(severity, &c["msg"], source);
        d.code = Some(c["cat"].to_string());
        return Some(d);
    }
    // UAT et UBT : `ERROR: …` en tête de ligne (Godot l'utilise aussi, d'où le moteur).
    if engine == Some(GameEngine::Unreal) {
        if let Some(m) = line.trim_start().strip_prefix("ERROR: ") {
            return Some(diagnostic(GameIssueSeverity::Error, m, "Unreal (UAT)"));
        }
    }
    None
}

/// Unity : messages d'arrêt du mode batch et exceptions des scripts d'éditeur.
fn parse_unity(
    line: &str,
    next: Option<&str>,
    engine: Option<GameEngine>,
) -> Option<(GameDiagnostic, usize)> {
    if engine != Some(GameEngine::Unity) {
        return None;
    }
    let trimmed = line.trim();
    if trimmed.starts_with("Aborting batchmode due to failure:") {
        let detail = next
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .unwrap_or("échec sans détail");
        return Some((diagnostic(GameIssueSeverity::Error, detail, "Unity"), 2));
    }
    if trimmed == "Scripts have compiler errors." {
        return Some((diagnostic(GameIssueSeverity::Error, trimmed, "Unity"), 1));
    }
    if trimmed.starts_with("BuildFailedException:")
        || trimmed.starts_with("Build Finished, Result: Failure")
    {
        return Some((diagnostic(GameIssueSeverity::Error, trimmed, "Unity"), 1));
    }
    if trimmed.starts_with("No valid Unity Editor license found")
        || trimmed.contains("No ULF license found")
        || trimmed.contains("LICENSE SYSTEM") && trimmed.to_lowercase().contains("error")
    {
        let mut d = diagnostic(GameIssueSeverity::Error, trimmed, "Unity");
        d.code = Some("license".to_string());
        return Some((d, 1));
    }
    None
}

/// Trace Python complète : erreur rattachée au dernier fichier cité.
fn parse_python(
    p: &Patterns,
    lines: &[String],
    start: usize,
    root: &Path,
) -> Option<(GameDiagnostic, usize)> {
    if !lines[start]
        .trim_start()
        .starts_with("Traceback (most recent call last):")
    {
        return None;
    }
    let mut file = None;
    let mut line_no = None;
    let mut i = start + 1;
    while i < lines.len() && i < start + 200 {
        let text = lines[i].trim_end();
        if let Some(c) = p.python_file.captures(text) {
            file = Some(relative(&c["file"], root));
            line_no = c["line"].parse().ok();
        } else if let Some(c) = p.python_error.captures(text) {
            let mut d = diagnostic(
                GameIssueSeverity::Error,
                &format!("{}: {}", &c["kind"], &c["msg"]),
                "Python",
            );
            d.code = Some(c["kind"].to_string());
            d.file = file;
            d.line = line_no;
            return Some((d, i - start + 1));
        }
        i += 1;
    }
    None
}

/// Tests échoués d'un fichier de résultats NUnit 3 (Unity Test Framework).
pub fn parse_nunit(xml: &str) -> Vec<GameDiagnostic> {
    static CASE: OnceLock<Regex> = OnceLock::new();
    static MESSAGE: OnceLock<Regex> = OnceLock::new();
    let case =
        CASE.get_or_init(|| Regex::new(r#"(?s)<test-case\b([^>]*)>(.*?)</test-case>"#).unwrap());
    let message = MESSAGE.get_or_init(|| {
        Regex::new(r#"(?s)<message>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</message>"#).unwrap()
    });
    let attr = |attrs: &str, name: &str| -> Option<String> {
        let key = format!("{name}=\"");
        let start = attrs.find(&key)? + key.len();
        let end = attrs[start..].find('"')? + start;
        Some(attrs[start..end].to_string())
    };
    case.captures_iter(xml)
        .filter(|c| attr(&c[1], "result").as_deref() == Some("Failed"))
        .map(|c| {
            let name = attr(&c[1], "fullname")
                .or_else(|| attr(&c[1], "name"))
                .unwrap_or_default();
            let detail = message
                .captures(&c[2])
                .map(|m| m[1].trim().to_string())
                .unwrap_or_default();
            let mut d = diagnostic(
                GameIssueSeverity::Error,
                &if detail.is_empty() {
                    format!("Test échoué : {name}")
                } else {
                    format!("Test échoué : {name} — {detail}")
                },
                "Tests Unity",
            );
            d.code = Some("test".to_string());
            d.likely_cause = Some(
                "Le comportement vérifié par ce test a changé ou n'est pas encore écrit."
                    .to_string(),
            );
            d
        })
        .collect()
}

/// Cause probable et piste de correction des erreurs les plus courantes.
fn explain(d: &mut GameDiagnostic) {
    let code = d.code.as_deref().unwrap_or_default();
    let msg = d.message.to_lowercase();
    let (cause, fix): (&str, &str) = match (d.source.as_str(), code) {
        (_, "CS0246") => ("Type ou espace de noms inconnu : using manquant, paquet absent ou faute de frappe.", "Ajoutez le using, installez le paquet dans le Package Manager, ou corrigez le nom."),
        (_, "CS0103") => ("Nom inconnu à cet endroit : variable non déclarée, hors de portée, ou faute de frappe.", "Déclarez-le, ou vérifiez l'orthographe et la portée."),
        (_, "CS1002") => ("Point-virgule manquant.", "Ajoutez « ; » à la fin de l'instruction indiquée."),
        (_, "CS1513") | (_, "CS1514") => ("Accolade manquante.", "Vérifiez que chaque « { » a sa « } »."),
        (_, "CS0117") | (_, "CS1061") => ("Ce membre n'existe pas sur ce type (API changée, faute de frappe).", "Vérifiez le nom du membre dans la documentation de la version utilisée."),
        (_, "CS0029") | (_, "CS0266") => ("Types incompatibles dans une affectation.", "Convertissez la valeur, ou changez le type de la variable."),
        (_, "CS0120") => ("Membre d'instance utilisé comme s'il était statique.", "Passez par une instance (GetComponent, référence), ou rendez le membre static."),
        (_, "CS0101") => ("Deux types portent le même nom dans le même espace de noms.", "Renommez l'un d'eux ou supprimez le doublon."),
        (_, "C2065") => ("Identifiant non déclaré.", "Incluez l'en-tête qui le déclare, ou corrigez le nom."),
        (_, "C2039") => ("Ce membre n'existe pas sur cette classe.", "Vérifiez le nom et la version de l'API d'Unreal."),
        (_, "C1083") => ("Fichier d'en-tête introuvable.", "Vérifiez le chemin de l'include et ajoutez le module dans PublicDependencyModuleNames du .Build.cs."),
        (_, "LNK2019") | (_, "LNK2001") => ("Symbole déclaré mais jamais défini, ou module non lié.", "Ajoutez le module dans le .Build.cs, ou écrivez l'implémentation manquante."),
        (_, "LNK1104") => ("Fichier de sortie verrouillé, souvent par l'éditeur ouvert (Live Coding).", "Fermez l'éditeur Unreal ou désactivez Live Coding, puis relancez."),
        (_, "license") => ("Unity n'a pas de licence active sur cette machine.", "Ouvrez Unity Hub, connectez-vous et activez une licence (Personal est gratuite)."),
        (_, "ModuleNotFoundError") => ("Module Python absent de l'interpréteur utilisé.", "Installez-le pour ce Python (celui de Blender a le sien), ou retirez l'import."),
        (_, "SyntaxError") | (_, "IndentationError") => ("Erreur de syntaxe Python.", "Corrigez la ligne indiquée (indentation, parenthèses, deux-points)."),
        ("GDScript", _) if msg.contains("not declared in the current scope") => ("Nom inconnu : variable ou fonction non déclarée, ou faute de frappe.", "Déclarez-la avec var ou func, ou corrigez l'orthographe."),
        ("GDScript", _) if msg.contains("cannot assign a value of type") => ("Valeur d'un type différent de celui déclaré pour la variable.", "Changez le type annoté, ou convertissez la valeur (int(), str())."),
        ("GDScript", _) if msg.starts_with("expected") || msg.contains("unexpected") => ("Erreur de syntaxe GDScript.", "Relisez la ligne : parenthèse, deux-points ou valeur manquante."),
        ("GDScript", _) if msg.contains("could not find type") || msg.contains("could not resolve") => ("Type inconnu : class_name absent, ou script non chargé.", "Ajoutez class_name au script visé, ou utilisez preload()."),
        ("GDScript", _) if msg.contains("on a null value") || msg.contains("null instance") => ("Objet absent au moment de l'appel : nœud introuvable ou pas encore prêt.", "Vérifiez le chemin du nœud (get_node, $), utilisez @onready, ou testez is_instance_valid()."),
        ("GDScript", _) if msg.contains("nonexistent function") => ("Cette fonction n'existe pas sur l'objet appelé.", "Vérifiez le nom de la fonction et le type réel de l'objet."),
        ("GDScript", _) if msg.contains("out of bounds") || msg.contains("invalid get index") => ("Accès à un index ou une clé qui n'existe pas.", "Vérifiez la taille du tableau ou la présence de la clé avant l'accès."),
        ("Godot", _) if msg.contains("export template") || msg.contains("no export template found") => ("Modèles d'export absents pour cette version de Godot.", "Dans Godot : Éditeur > Gérer les modèles d'export > Télécharger."),
        ("Unreal" | "Unreal (UAT)", _) if msg.contains("live coding") => ("Live Coding est actif dans l'éditeur ouvert.", "Fermez l'éditeur Unreal ou appuyez sur Ctrl+Alt+F11, puis relancez."),
        ("Unreal" | "Unreal (UAT)", _) if msg.contains("visual studio") || msg.contains("msvc") || msg.contains("toolchain") => ("Compilateur C++ absent ou incomplet.", "Installez Visual Studio 2022 avec « Développement de jeux en C++ »."),
        ("Blueprint", _) => ("Un Blueprint ne compile plus.", "Ouvrez-le dans l'éditeur : le nœud en erreur est surligné."),
        _ => return,
    };
    d.likely_cause = Some(cause.to_string());
    d.suggestion = Some(fix.to_string());
}

/// Motif de fichier rattaché à un système : chemin exact, dossier, ou motif `*`/`**`.
pub fn pattern_matches(pattern: &str, file: &str) -> bool {
    let pattern = pattern.trim().replace('\\', "/");
    let pattern = pattern
        .trim_start_matches("./")
        .trim_start_matches("res://");
    let file = file.replace('\\', "/");
    if pattern.is_empty() {
        return false;
    }
    if !pattern.contains(['*', '?']) {
        let dir = pattern.trim_end_matches('/');
        return file.eq_ignore_ascii_case(dir)
            || file
                .to_lowercase()
                .starts_with(&format!("{}/", dir.to_lowercase()));
    }
    let mut re = String::from("(?i)^");
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    re.push_str("(?:.*/)?");
                } else {
                    re.push_str(".*");
                }
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            other => re.push_str(&regex::escape(&other.to_string())),
        }
    }
    re.push('$');
    Regex::new(&re).map(|r| r.is_match(&file)).unwrap_or(false)
}

/// Rattache chaque erreur aux systèmes dont les fichiers la contiennent.
pub fn attach_systems(diagnostics: &mut [GameDiagnostic], graph: &GameGraph) {
    for d in diagnostics.iter_mut() {
        let Some(file) = d.file.as_deref() else {
            continue;
        };
        d.systems = graph
            .systems
            .iter()
            .filter(|s| s.files.iter().any(|p| pattern_matches(p, file)))
            .map(|s| s.id.clone())
            .collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines().map(str::to_string).collect()
    }

    #[test]
    fn reads_real_godot_parse_and_runtime_errors() {
        // Sortie réelle de Godot 4.4.1 (vérification et test de démarrage).
        let out = lines(
            "Godot Engine v4.4.1.stable.official.49a5bc7b6 - https://godotengine.org\n\nSCRIPT ERROR: Parse Error: Cannot assign a value of type \"String\" as \"int\".\n          at: GDScript::reload (res://scripts/casse.gd:3)\nSCRIPT ERROR: Parse Error: Identifier \"y\" not declared in the current scope.\n          at: GDScript::reload (res://scripts/casse.gd:4)\nERROR: Failed to load script \"res://scripts/casse.gd\" with error \"Parse error\".\n   at: load (modules/gdscript/gdscript.cpp:3022)\nGAMESTUDIO_SCRIPT_FAILED res://scripts/casse.gd\nSCRIPT ERROR: Cannot call method 'queue_free' on a null value.\n          at: _ready (res://scripts/main.gd:5)\nGAMESTUDIO_CHECK checked=4 failed=1",
        );
        let d = parse(&out, Path::new("/jeux/crocs"), Some(GameEngine::Godot));
        assert_eq!(d.len(), 3, "{d:#?}");
        assert_eq!(d[0].file.as_deref(), Some("scripts/casse.gd"));
        assert_eq!(d[0].line, Some(3));
        assert_eq!(d[0].source, "GDScript");
        assert!(d[0].likely_cause.as_deref().unwrap().contains("type"));
        assert!(d[1].message.starts_with("Identifier \"y\""));
        assert!(d[1].suggestion.is_some());
        assert_eq!(d[2].line, Some(5));
        assert!(d[2].likely_cause.as_deref().unwrap().contains("nœud"));
    }

    #[test]
    fn reads_csharp_msvc_linker_and_clang() {
        let out = lines(concat!(
            "Assets/Scripts/Player.cs(12,5): error CS1002: ; expected\n",
            "C:\\Jeux\\Crocs\\Source\\Crocs\\Hero.cpp(40): error C2065: 'Speed': undeclared identifier [C:\\Jeux\\Crocs\\Crocs.vcxproj]\n",
            "Hero.cpp.obj : error LNK2019: unresolved external symbol \"void Foo(void)\"\n",
            "/home/me/crocs/Source/Crocs/Hero.cpp:7:3: error: use of undeclared identifier 'x'\n",
            "Assets/Scripts/Old.cs(3,1): warning CS0618: 'X' is obsolete\n",
        ));
        let d = parse(&out, Path::new("C:\\Jeux\\Crocs"), None);
        assert_eq!(d.len(), 5, "{d:#?}");
        assert_eq!(d[0].source, "C#");
        assert_eq!((d[0].line, d[0].column), (Some(12), Some(5)));
        assert!(d[0].likely_cause.is_some());
        assert_eq!(d[1].file.as_deref(), Some("Source/Crocs/Hero.cpp"));
        assert_eq!(d[1].code.as_deref(), Some("C2065"));
        assert_eq!(d[1].message, "'Speed': undeclared identifier");
        assert_eq!(d[2].source, "Éditeur de liens");
        assert_eq!(d[3].line, Some(7));
        assert_eq!(
            d[4].severity,
            GameIssueSeverity::Warning,
            "les avertissements viennent après"
        );
    }

    #[test]
    fn reads_unreal_unity_and_python() {
        let unreal = lines("[2026.09.30-10.00.00:000][  0]LogBlueprint: Error: [Compiler] BP_Hero : Pin Speed no longer exists\nERROR: Unable to build while Live Coding is active. Exit the editor and game, or press Ctrl+Alt+F11");
        let d = parse(&unreal, Path::new("/p"), Some(GameEngine::Unreal));
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].source, "Blueprint");
        assert!(d[1].suggestion.as_deref().unwrap().contains("Ctrl+Alt+F11"));

        let unity = lines("Scripts have compiler errors.\nAborting batchmode due to failure:\nExecuting method ArchimedGameStudio.Setup failed");
        let d = parse(&unity, Path::new("/p"), Some(GameEngine::Unity));
        assert_eq!(d.len(), 2);
        assert!(d[1].message.contains("ArchimedGameStudio.Setup"));

        let python = lines("Traceback (most recent call last):\n  File \"/p/tools/export.py\", line 8, in <module>\n    import numpyx\nModuleNotFoundError: No module named 'numpyx'");
        let d = parse(&python, Path::new("/p"), None);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].file.as_deref(), Some("tools/export.py"));
        assert_eq!(d[0].line, Some(8));
        assert!(d[0].likely_cause.is_some());
    }

    #[test]
    fn godot_error_prefix_is_not_read_as_uat() {
        let out = lines("ERROR: Something\n   at: foo (core/x.cpp:1)");
        let d = parse(&out, Path::new("/p"), Some(GameEngine::Unreal));
        assert_eq!(d[0].source, "Unreal (UAT)");
        let d = parse(&out, Path::new("/p"), Some(GameEngine::Godot));
        assert_eq!(d[0].source, "Godot");
        assert!(d[0].file.is_none(), "fichier du moteur, pas du projet");
    }

    #[test]
    fn nunit_failures() {
        let xml = r#"<test-run><test-case id="1" name="Passes" fullname="Game.Tests.Passes" result="Passed"></test-case><test-case id="2" name="Jumps" fullname="Game.Tests.Jumps" result="Failed"><failure><message><![CDATA[Expected 2 but was 1]]></message></failure></test-case></test-run>"#;
        let d = parse_nunit(xml);
        assert_eq!(d.len(), 1);
        assert!(d[0].message.contains("Game.Tests.Jumps"));
        assert!(d[0].message.contains("Expected 2 but was 1"));
    }

    #[test]
    fn file_patterns() {
        assert!(pattern_matches("scripts/combat", "scripts/combat/sword.gd"));
        assert!(pattern_matches(
            "scripts/combat/",
            "scripts/combat/sword.gd"
        ));
        assert!(pattern_matches(
            "Scripts/Combat/**",
            "Scripts/Combat/Melee/Sword.cs"
        ));
        assert!(pattern_matches("**/*.gd", "a/b/c.gd"));
        assert!(pattern_matches("scripts/*.gd", "scripts/main.gd"));
        assert!(!pattern_matches("scripts/*.gd", "scripts/sub/main.gd"));
        assert!(pattern_matches("res://scripts/main.gd", "scripts/main.gd"));
        assert!(!pattern_matches("scripts/comb", "scripts/combat/sword.gd"));
    }

    #[test]
    fn line_levels() {
        assert_eq!(line_level("SCRIPT ERROR: x"), GameLogLevel::Error);
        assert_eq!(
            line_level("Assets/A.cs(1,1): warning CS0618: x"),
            GameLogLevel::Warning
        );
        assert_eq!(line_level("Importing 12 files"), GameLogLevel::Info);
    }
}
