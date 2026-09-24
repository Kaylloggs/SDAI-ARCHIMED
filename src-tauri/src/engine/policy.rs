use regex::Regex;
use std::sync::OnceLock;

use super::event::{AutoMode, RiskLevel};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Deny: refus automatique (listes de blocage, Phase 2)
pub enum Verdict {
    Allow,
    Ask,
    Deny,
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // reason: affiché dans le journal d'audit (Phase 2)
pub struct Decision {
    pub verdict: Verdict,
    pub risk: RiskLevel,
    pub reason: String,
}

/// Motifs jamais auto-validés, quel que soit le Mode Auto (guidelines.md §11).
fn critical_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"(?i)\brm\s+-[a-z]*r[a-z]*f?\s+[/~]",
            r"(?i)remove-item\b.*-recurse.*\b(c:\\?|%userprofile%|\$env:userprofile|~)",
            r"(?i)\bformat\s+[a-z]:",
            r"(?i)\breg\s+delete\b",
            r"(?i)\bbcdedit\b",
            r"(?i)\bvssadmin\s+delete\b",
            r"(?i)set-mppreference\b.*disablerealtimemonitoring",
            r"(?i)\b(diskpart|cipher\s+/w)\b",
            r"(?i)\b(shutdown|takeown\s+/f\s+c:)\b",
            r"(?i)\.ssh[/\\]id_(rsa|ed25519)\b",
            r"(?i)(credentials\.json|\.aws[/\\]credentials|\.npmrc|\.env\.production)",
        ]
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect()
    })
}

fn high_patterns() -> &'static Vec<Regex> {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"(?i)\b(rm|del|remove-item|rmdir)\b",
            r"(?i)\b(curl|wget|invoke-webrequest)\b.*\.(exe|msi|ps1|bat)",
            r"(?i)\bgit\s+push\b.*--force",
            r"(?i)\bnpm\s+publish\b",
            r"(?i)\b(schtasks|sc\.exe|net\s+user)\b",
        ]
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect()
    })
}

/// Outils en lecture seule : risque faible par défaut.
const READ_ONLY_TOOLS: &[&str] = &[
    "Read", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite", "Task", "NotebookRead",
    "view_file", "list_dir", "grep_search", "codebase_search", "read_resource", "search_web",
];

const EDIT_TOOLS: &[&str] = &[
    "Write", "Edit", "MultiEdit", "NotebookEdit", "write_to_file", "edit_file", "replace_file_content",
];

const SHELL_TOOLS: &[&str] = &["Bash", "PowerShell", "run_command", "run_terminal_cmd"];

/// Classe une demande d'outil. `payload` = texte représentatif (commande, chemin…).
pub fn classify(tool: &str, payload: &str) -> (RiskLevel, String) {
    if critical_patterns().iter().any(|re| re.is_match(payload)) {
        return (
            RiskLevel::Critical,
            "motif destructeur ou secret détecté".to_string(),
        );
    }

    if READ_ONLY_TOOLS.contains(&tool) {
        return (RiskLevel::Low, "outil en lecture seule".to_string());
    }

    if SHELL_TOOLS.contains(&tool) {
        if high_patterns().iter().any(|re| re.is_match(payload)) {
            return (RiskLevel::High, "commande à effet destructeur".to_string());
        }
        return (RiskLevel::Medium, "exécution de commande".to_string());
    }

    if EDIT_TOOLS.contains(&tool) {
        return (RiskLevel::Medium, "modification de fichier".to_string());
    }

    if high_patterns().iter().any(|re| re.is_match(payload)) {
        return (RiskLevel::High, "motif sensible détecté".to_string());
    }

    (RiskLevel::Medium, "outil non classé".to_string())
}

/// Le chemin visé sort-il du dossier de travail ? Comparaison lexicale (`..` résolus),
/// insensible à la casse et aux séparateurs, comme les chemins Windows.
pub fn outside(target: &str, cwd: &str) -> bool {
    fn parts(path: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for part in path.replace('\\', "/").split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    out.pop();
                }
                other => out.push(other.to_lowercase()),
            }
        }
        out
    }
    let target = target.trim().trim_matches('"');
    if target.starts_with('~') {
        return true;
    }
    let absolute = target.starts_with('/')
        || target.starts_with('\\')
        || target.as_bytes().get(1) == Some(&b':');
    let full = if absolute {
        target.to_string()
    } else {
        format!("{cwd}/{target}")
    };
    !parts(&full).starts_with(&parts(cwd))
}

/// Comme [`classify`], en tenant compte du dossier de travail : une modification de
/// fichier hors de ce dossier est à risque élevé (jamais validée d'office en Smart).
pub fn classify_in(
    tool: &str,
    payload: &str,
    target: Option<&str>,
    cwd: Option<&str>,
) -> (RiskLevel, String) {
    let (risk, reason) = classify(tool, payload);
    if risk < RiskLevel::High && EDIT_TOOLS.contains(&tool) {
        if let (Some(target), Some(cwd)) = (target, cwd) {
            if outside(target, cwd) {
                return (
                    RiskLevel::High,
                    "modification hors du dossier de travail".to_string(),
                );
            }
        }
    }
    (risk, reason)
}

/// Décision sans cible ni dossier de travail (tests des règles de base).
#[cfg(test)]
pub fn evaluate(tool: &str, payload: &str, mode: AutoMode) -> Decision {
    evaluate_in(tool, payload, None, None, mode)
}

pub fn evaluate_in(
    tool: &str,
    payload: &str,
    target: Option<&str>,
    cwd: Option<&str>,
    mode: AutoMode,
) -> Decision {
    let (risk, reason) = classify_in(tool, payload, target, cwd);

    let verdict = match (mode, risk) {
        (_, RiskLevel::Critical) => Verdict::Ask,
        (AutoMode::Off, _) => Verdict::Ask,
        (AutoMode::Smart, RiskLevel::Low | RiskLevel::Medium) => Verdict::Allow,
        (AutoMode::Smart, RiskLevel::High) => Verdict::Ask,
        (AutoMode::Full, _) => Verdict::Allow,
    };

    Decision {
        verdict,
        risk,
        reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_tools_are_low_risk() {
        let (risk, _) = classify("Read", "C:/projet/fichier.rs");
        assert_eq!(risk, RiskLevel::Low);
    }

    #[test]
    fn destructive_command_is_critical() {
        let (risk, _) = classify("Bash", "rm -rf ~/Documents");
        assert_eq!(risk, RiskLevel::Critical);
    }

    #[test]
    fn critical_never_auto_allowed() {
        let decision = evaluate("Bash", "format c:", AutoMode::Full);
        assert_eq!(decision.verdict, Verdict::Ask);
    }

    #[test]
    fn smart_allows_edits_but_asks_for_delete() {
        assert_eq!(
            evaluate("Write", "src/main.rs", AutoMode::Smart).verdict,
            Verdict::Allow
        );
        assert_eq!(
            evaluate("Bash", "del build.log", AutoMode::Smart).verdict,
            Verdict::Ask
        );
    }

    #[test]
    fn edits_outside_the_working_folder_are_never_auto_allowed_in_smart() {
        let cwd = Some("C:\\Mods\\work\\t1");
        let inside = evaluate_in("Write", "", Some("src/Main.java"), cwd, AutoMode::Smart);
        assert_eq!(inside.verdict, Verdict::Allow);
        let absolute_inside = evaluate_in(
            "Edit",
            "",
            Some("c:/mods/WORK/t1/build.gradle"),
            cwd,
            AutoMode::Smart,
        );
        assert_eq!(absolute_inside.verdict, Verdict::Allow);
        for escape in [
            "C:\\Mods\\real\\build.gradle",
            "../real/x.java",
            "~/x",
            "D:/x",
        ] {
            let decision = evaluate_in("Write", "", Some(escape), cwd, AutoMode::Smart);
            assert_eq!(decision.verdict, Verdict::Ask, "{escape}");
            assert_eq!(decision.risk, RiskLevel::High);
        }
        // Sans dossier connu, rien ne change.
        assert_eq!(
            evaluate_in("Write", "", Some("D:/x"), None, AutoMode::Smart).verdict,
            Verdict::Allow
        );
        assert!(!outside("/home/a/proj/src/x", "/home/a/proj"));
        assert!(outside("/home/a/projet2/x", "/home/a/proj"));
    }

    #[test]
    fn off_asks_everything() {
        assert_eq!(
            evaluate("Read", "fichier.txt", AutoMode::Off).verdict,
            Verdict::Ask
        );
    }
}
