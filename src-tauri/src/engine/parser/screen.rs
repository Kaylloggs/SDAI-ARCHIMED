//! Écran virtuel : les CLI modernes redessinent l'écran avec des déplacements de
//! curseur ; retirer les codes ANSI d'un flux produirait du texte dupliqué.
//! On lit donc l'écran *rendu*, comme un humain (architecture.md §7.4).

pub struct Screen {
    parser: vt100::Parser,
}

impl Screen {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, 0),
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    /// Position du curseur (ligne, colonne), à partir de 0.
    pub fn cursor(&self) -> (u16, u16) {
        self.parser.screen().cursor_position()
    }

    /// Lignes affichées, sans les espaces de fin.
    pub fn lines(&self) -> Vec<String> {
        self.parser
            .screen()
            .contents()
            .lines()
            .map(|line| line.trim_end().to_string())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_redraws_instead_of_concatenating() {
        let mut screen = Screen::new(10, 40);
        // Écrit « Chargement… », revient en début de ligne, efface, écrit la question.
        screen.feed(b"Chargement...\r\x1b[2KContinuer ? [Y/n] ");
        let lines = screen.lines();
        assert_eq!(lines[0], "Continuer ? [Y/n]");
    }

    #[test]
    fn strips_colors() {
        let mut screen = Screen::new(5, 40);
        screen.feed(b"\x1b[1;32mOK\x1b[0m tout va bien");
        assert_eq!(screen.lines()[0], "OK tout va bien");
    }
}
