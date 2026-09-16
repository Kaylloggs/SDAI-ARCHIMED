# SDAI ARCHIMED

> Assistant personnel de bureau (Windows `.exe`) — interface de messagerie unifiée au-dessus des CLI d'IA (Claude Code, Antigravity, Codex…), avec contrôle système total et architecture **100 % modulaire** par blocs.

## Vision
- **Multi-CLI** : choisir l'agent (Claude / Antigravity / …) et le modèle à la volée, dans une seule conversation.
- **Parsing Intelligent** : les questions des CLI (`[Y/n]`, menus, demandes de permission) deviennent des cartes cliquables. Le terminal brut reste caché.
- **Mode Auto** : l'IA agit sans validation constante, encadrée par une policy de risque (les actions critiques sont toujours demandées).
- **Contrôle système** : fichiers, scripts, téléchargements.
- **Skills** : import, activation, synchronisation vers les CLI.
- **Blocs Lego** : chaque fonctionnalité est un module auto-découvert (`src/modules/<id>`), qui s'ajoute seul à la navigation.

## Stack
Tauri 2 · Rust (tokio, portable-pty, vt100, ts-rs, rmcp) · React 19 + TypeScript + Vite · Tailwind CSS v4 + shadcn/ui · zustand · motion · xterm.js · pnpm.

## Prérequis (Windows 10/11)
| Outil | Version | Vérifier |
|---|---|---|
| Node.js | ≥ 20 (testé 24) | `node -v` |
| pnpm | ≥ 9 | `pnpm -v` |
| Rust (toolchain MSVC) | stable ≥ 1.85 | `rustc -V` |
| Visual Studio Build Tools | « Développement Desktop en C++ » | — |
| WebView2 | inclus dans Windows 11 | — |
| Claude Code CLI (optionnel) | dernière | `claude --version` |
| Antigravity CLI (optionnel) | dernière | `agy --help` |

## Lancer en développement
```bash
pnpm install
pnpm tauri dev
```

## Compiler le `.exe`
Double-cliquer sur **`build.bat`**, ou :
```bash
powershell -ExecutionPolicy Bypass -File .\build.ps1
```
Options : `-DebugBuild` · `-Bundles nsis|msi|all|none` · `-SkipInstall` · `-SkipChecks` · `-Clean`.
Résultat dans `release/<version>/` : `SDAI-Archimed.exe` (portable) + installeurs.

## Commandes utiles
| Commande | Rôle |
|---|---|
| `pnpm check` | types, lint, format, validation des modules |
| `pnpm test` | tests frontend |
| `pnpm gen:bindings` | régénère les types TS depuis Rust |
| `pnpm new:module <id> [--backend]` | crée un nouveau bloc |

## Modules livrés
> **Règle** : tout module ajouté doit apparaître dans ce tableau, dans `architecture.md` (§2) et dans `CHANGELOG.md`. `pnpm check` échoue sinon.

| Module | Catégorie | Rôle | Backend |
|---|---|---|---|
| `home` | Essentiel | Launchpad : une tuile par module actif | — |
| `chat` | Intelligence | Conversations multi-CLI : sessions multiples, dossier de travail, pièces jointes, cartes de validation, Mode Auto | moteur core |
| `code` | Intelligence | Éditeur de projet façon VS Code : arborescence, onglets, coloration syntaxique, chat latéral, drag & drop de fichiers à modifier | plugin `code` |
| `skills` | Intelligence | Bibliothèque de skills, activation, synchronisation vers les CLI | plugin `skills` |
| `settings` | Réglages | Thèmes, détection des CLI, modules, données | — |

## Carte de la documentation
| Fichier | Contenu |
|---|---|
| [`guidelines.md`](guidelines.md) | **Bible** : règles, conventions, créer un module/adaptateur/règle |
| [`architecture.md`](architecture.md) | arborescence, IPC, moteur CLI, Parsing Intelligent, policy, skills |
| [`design.md`](design.md) | design system : tokens, typo, motion, composants, skills de design |
| `CLAUDE.md` / `AGENTS.md` | points d'entrée pour agents IA |
| `docs/adr/` | décisions d'architecture |

## Statut
**Phase 1 terminée** : l'application se lance, découvre ses modules, détecte les CLI installées et dialogue avec Claude Code (protocole de permission → cartes cliquables) et Antigravity.
Voir `CHANGELOG.md` pour le détail et la liste des travaux de Phase 2 (transport PTY, règles de parsing, validation interactive Antigravity, persistance des sessions).
