//! En-tête YAML d'un `SKILL.md` (`---` … `---`), lu sans dépendance : clés de premier niveau,
//! valeurs simples, entre guillemets, ou en bloc (`>` replié, `|` littéral), et suites de
//! lignes indentées. Suffisant pour `name`, `description` et les autres champs usuels.

/// Champs lus et position du corps (ligne, à partir de 1, qui suit l'en-tête).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Frontmatter {
    pub fields: Vec<(String, String)>,
    /// `false` : pas d'en-tête, ou en-tête jamais refermé.
    pub present: bool,
    pub body_start: usize,
}

impl Frontmatter {
    pub fn get(&self, key: &str) -> Option<&str> {
        self.fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
}

pub fn parse(content: &str) -> Frontmatter {
    let lines: Vec<&str> = content.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") {
        return Frontmatter::default();
    }
    let Some(end) = lines.iter().skip(1).position(|l| l.trim() == "---").map(|i| i + 1) else {
        return Frontmatter::default();
    };

    let mut fields: Vec<(String, String)> = Vec::new();
    let mut index = 1;
    while index < end {
        let line = lines[index];
        index += 1;
        if line.trim().is_empty() || line.trim_start().starts_with('#') || line.starts_with([' ', '\t']) {
            continue;
        }
        let Some((key, rest)) = line.split_once(':') else { continue };
        let key = key.trim().to_string();
        let rest = rest.trim();

        // Lignes indentées qui suivent : suite de la valeur.
        let mut block = Vec::new();
        while index < end && (lines[index].starts_with([' ', '\t']) || lines[index].trim().is_empty()) {
            block.push(lines[index]);
            index += 1;
        }
        while block.last().is_some_and(|l| l.trim().is_empty()) {
            block.pop();
        }

        let value = if rest.starts_with('|') || rest.starts_with('>') {
            let literal = rest.starts_with('|');
            let indent = block
                .iter()
                .filter(|l| !l.trim().is_empty())
                .map(|l| l.len() - l.trim_start().len())
                .min()
                .unwrap_or(0);
            let body: Vec<&str> = block.iter().map(|l| l.get(indent..).unwrap_or("").trim_end()).collect();
            if literal {
                body.join("\n")
            } else {
                fold(&body)
            }
        } else if let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') {
            let mut text = rest.to_string();
            for extra in &block {
                text.push(' ');
                text.push_str(extra.trim());
            }
            unquote(&text, quote)
        } else {
            let mut parts = vec![rest.to_string()];
            parts.extend(block.iter().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()));
            parts.join(" ").trim().to_string()
        };
        if let Some(existing) = fields.iter_mut().find(|(k, _)| *k == key) {
            existing.1 = value;
        } else {
            fields.push((key, value));
        }
    }

    Frontmatter {
        fields,
        present: true,
        body_start: end + 2,
    }
}

/// Bloc replié (`>`) : lignes jointes par une espace, lignes vides gardées comme sauts.
fn fold(lines: &[&str]) -> String {
    let mut out = String::new();
    for line in lines {
        if line.is_empty() {
            out.push('\n');
        } else {
            if !out.is_empty() && !out.ends_with('\n') {
                out.push(' ');
            }
            out.push_str(line);
        }
    }
    out.trim().to_string()
}

fn unquote(text: &str, quote: char) -> String {
    let inner = text.trim();
    let inner = inner.strip_prefix(quote).unwrap_or(inner);
    let inner = inner.strip_suffix(quote).unwrap_or(inner);
    if quote == '\'' {
        inner.replace("''", "'")
    } else {
        inner.replace("\\\"", "\"").replace("\\n", "\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simple_quoted_and_block_values() {
        let content = "---\nname: pdf-tools\ndescription: \"Lit les PDF: texte et tableaux\"\nlicense: MIT\n---\n\n# Corps\n";
        let fm = parse(content);
        assert!(fm.present);
        assert_eq!(fm.get("name"), Some("pdf-tools"));
        assert_eq!(fm.get("description"), Some("Lit les PDF: texte et tableaux"));
        assert_eq!(fm.body_start, 6);

        let folded = parse("---\nname: x\ndescription: >\n  Première ligne\n  suite de la phrase.\n\n  Paragraphe.\n---\nbody");
        assert_eq!(folded.get("description"), Some("Première ligne suite de la phrase.\nParagraphe."));

        let literal = parse("---\ndescription: |\n  a\n    b\n---\n");
        assert_eq!(literal.get("description"), Some("a\n  b"));

        let continued = parse("---\ndescription: Une description\n  qui continue ici\nname: y\n---\n");
        assert_eq!(continued.get("description"), Some("Une description qui continue ici"));
        assert_eq!(continued.get("name"), Some("y"));
    }

    #[test]
    fn missing_or_unclosed_header() {
        assert!(!parse("# Titre\n").present);
        assert!(!parse("---\nname: x\n").present);
    }
}
