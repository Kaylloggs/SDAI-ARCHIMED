# SDAI ARCHIMED — Architecture

> Document de référence technique. Règles de codage : `guidelines.md`. Règles visuelles : `design.md`.

## Sommaire
1. Vue d'ensemble
2. Arborescence complète
3. Séquence de démarrage
4. Communication Front ↔ Back (IPC)
5. Système de modules (blocs Lego)
6. Moteur Multi-CLI
7. Parsing Intelligent (questions → composants cliquables)
8. Mode Auto et policy de sécurité
9. Contrôle système
10. Gestionnaire de Skills
11. Données et stockage
12. Pipeline de build

---

## 1. Vue d'ensemble

```
┌──────────────────────────── WebView (React) ────────────────────────────┐
│  AppShell ── TitleBar · Sidebar(catégories) · Launchpad(blocs) · Ctrl+K │
│     │                                                                    │
│  ModuleRegistry (import.meta.glob) ──► routes, nav, slots, services,     │
│     │                                   cartes, commandes, réglages      │
│  modules/chat ─ modules/skills ─ modules/files ─ modules/<futur>…        │
│     │  api.ts (invoke)             ▲ Channel<EngineEvent> (flux ordonné) │
└─────┼──────────────────────────────┼─────────────────────────────────────┘
      ▼ invoke / plugin:<id>|cmd     │
┌──────────────────────────── Rust (Tauri 2) ─────────────────────────────┐
│ core (AppError, state, paths, config, logs)                              │
│ engine ── SessionManager ── Session ── Transport (Structured | Pty)      │
│             │                  │            └─ vt100 Screen ─ Detector   │
│             │                  └─ CliAdapter (claude | antigravity | toml)│
│             └─ policy (risk + auto mode) ─ audit.jsonl                   │
│ system (fs · shell · net)            modules/* (plugins Tauri inline)    │
└───────────────┬──────────────────────────────────────────────────────────┘
                ▼ stdin/stdout NDJSON (+ control_request/response) ou ConPTY
          claude.exe · agy.exe · codex …
```

Principe directeur : **le core fournit des mécanismes, les modules fournissent des fonctionnalités.**

---

## 2. Arborescence

État réel du dépôt. `(prévu)` = planifié, pas encore écrit — ne pas supposer que le fichier existe.

```
SDAI ARCHIMED/
├── README.md · guidelines.md · architecture.md · design.md
├── CLAUDE.md · AGENTS.md · CHANGELOG.md
├── build.ps1 · build.bat                # build du .exe + installeurs
├── package.json · pnpm-workspace.yaml · vite.config.ts · vitest.config.ts
├── tsconfig.json · tsconfig.node.json · index.html
├── docs/adr/                            # décisions d'architecture
│   ├── 0001-claude-permissions-via-stdio-control-protocol.md
│   └── 0002-modules-as-inline-tauri-plugins.md
├── scripts/
│   ├── new-module.mjs                   # pnpm new:module <id> [--category] [--backend]
│   └── check-modules.mjs                # invariants de modularité (pnpm check)
│
├── src/                                 # ═════════ FRONTEND ═════════
│   ├── main.tsx
│   ├── core/
│   │   ├── modules/                     # define-module · manifest.schema · registry
│   │   │                                # · useModules · services · slots · types · index
│   │   ├── shell/                       # AppShell · TitleBar · Sidebar · StatusBar
│   │   │                                # · CommandPalette · ModuleErrorBoundary
│   │   ├── ipc/                         # invoke.ts (invokeCore/invokeModule) · index
│   │   │   └── bindings/                # GÉNÉRÉ par ts-rs — ne pas éditer
│   │   ├── engine/                      # types · engine.api · session.store · __tests__
│   │   ├── cards/                       # PromptCard · DiffView · ToolCallCard
│   │   ├── bus/event-bus.ts
│   │   ├── stores/                      # modules.store · ui.store
│   │   └── lib/cn.ts
│   ├── design-system/
│   │   ├── tokens.css                   # source de vérité visuelle (@theme Tailwind v4)
│   │   ├── globals.css · motion.ts
│   │   └── primitives/                  # Button · Card · GlassPanel · Badge · Kbd
│   │                                    # · SectionHeader · EmptyState
│   └── modules/
│       ├── _template/                   # copié par new-module (ignoré par le registre)
│       ├── home/                        # launchpad
│       ├── chat/                        # module.config · index · README · hooks/
│       │   └── components/              # Timeline · Composer · RawTerminalDrawer
│       ├── skills/                      # module.config · index · api · README
│       ├── settings/
│       ├── files/                       # (prévu) explorateur et actions système
│       ├── voice/                       # (prévu)
│       └── image-gen/                   # (prévu)
│
└── src-tauri/                           # ═════════ BACKEND ═════════
    ├── Cargo.toml · build.rs · tauri.conf.json
    ├── capabilities/
    │   ├── default.json                 # fenêtre, plugins officiels, fs/shell
    │   └── modules.generated.json       # GÉNÉRÉ par build.rs
    ├── icons/ · binaries/               # binaries/ : sidecars éventuels (aucun aujourd'hui)
    ├── resources/                       # (prévu) adapters/*.toml · prompt-rules/*.toml
    └── src/
        ├── main.rs · lib.rs             # plugins, state, registre des modules, commandes
        ├── core/                        # error.rs (AppError) · paths.rs · mod.rs
        ├── engine/
        │   ├── mod.rs · commands.rs     # engine_* exposées au frontend
        │   ├── manager.rs · session.rs  # SessionManager, boucle de session tokio
        │   ├── event.rs                 # EngineEvent, InteractivePrompt, AdapterInfo
        │   ├── policy.rs                # risque + Mode Auto (+ tests)
        │   ├── adapters/                # mod.rs (trait CliAdapter) · claude.rs · antigravity.rs
        │   ├── transport/               # (prévu) pty.rs (portable-pty + vt100)
        │   └── parser/                  # (prévu) screen · rules · detector · menu · keys
        ├── system/                      # (prévu) fs · shell · net
        └── modules/
            ├── mod.rs                   # registre : `pub mod x;` + `register!(builder, x);`
            └── skills/                  # module.toml · mod.rs · commands.rs
                                         # · service.rs · types.rs
```

## 3. Séquence de démarrage

1. `main.rs` → `lib::run()` : init `tracing`, résolution des chemins (`core::paths`).
2. Plugins officiels : `single-instance`, `window-state`, `store`, `fs`, `dialog`, `opener`, `shell`, `notification`, `log`.
3. `engine::init` : charge `resources/adapters/*.toml` + adaptateurs Rust, **détecte les CLI installées** (`which`), lance `bridge_server` (port aléatoire 127.0.0.1).
4. `modules::register_all(builder)` : ajoute chaque plugin de module.
5. Frontend : `registry.ts` découvre les manifests, valide (zod), fusionne avec `modules.store` (activé/désactivé), construit routes, sidebar, launchpad, palette, slots et services.
6. `engine.list_adapters` → alimente l'AgentPicker ; les CLI absentes apparaissent grisées avec l'aide d'installation.

---

## 4. Communication Front ↔ Back (IPC)

| Mécanisme | Usage | Exemple |
|---|---|---|
| `invoke("engine_start_session", …)` | commande core | démarrer une session |
| `invoke("plugin:skills\|list")` | commande de module | lister les skills |
| `Channel<EngineEvent>` | flux ordonné d'une session | texte, outils, questions |
| `app.emit("skills.changed")` | fait global rare | rafraîchir les listes |

Contrat du moteur (types générés par `ts-rs`) :

```rust
#[derive(Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    SessionStarted   { session_id: SessionId, adapter: String, model: String, transport: TransportKind },
    MessageDelta     { message_id: String, text: String },
    MessageCompleted { message_id: String },
    ToolCall         { call_id: String, tool: String, input: serde_json::Value },
    ToolResult       { call_id: String, ok: bool, output: String },
    Prompt(InteractivePrompt),
    PromptResolved   { prompt_id: String, by: ResolvedBy, option_id: Option<String> },
    PromptInvalidated{ prompt_id: String },
    RawOutput        { chunk: String },          // PTY uniquement → xterm (lot de 16 ms)
    Usage            { input_tokens: u64, output_tokens: u64, cost_usd: Option<f64> },
    Error            { code: AppErrorCode, message: String, recoverable: bool },
    SessionEnded     { exit_code: Option<i32> },
}
```

Démarrage d'une session côté TS :
```ts
const channel = new Channel<EngineEvent>();
channel.onmessage = (e) => useSessionStore.getState().apply(sessionId, e);
const { sessionId } = await invokeCore("engine_start_session", {
  adapter: "claude", model: "claude-opus-5", cwd, autoMode: "off", onEvent: channel,
});
```

---

## 5. Système de modules (blocs Lego)

### 5.1 Deux moitiés, un identifiant
| | Frontend | Backend |
|---|---|---|
| Emplacement | `src/modules/<kebab-id>/` | `src-tauri/src/modules/<snake_id>/` (id du plugin en kebab-case) |
| Déclaration | `module.config.ts` | `module.toml` |
| Découverte | `import.meta.glob` (build Vite) | `build.rs` + ligne `register!` |
| Isolation | ESLint `no-restricted-imports` | visibilité Rust (`pub(crate)`) |
| Obligatoire ? | oui | non (modules purement UI possibles) |

Pourquoi des **plugins Tauri inline** : chaque module a son propre espace de commandes (`plugin:<id>|cmd`), son `setup`, son état géré et ses permissions, sans jamais toucher au `generate_handler!` central. `build.rs` déclare chaque plugin via `tauri_build::InlinedPlugin::new().commands(...)` pour que le système de capabilities de Tauri 2 autorise ses commandes.

### 5.2 `build.rs` (principe)
```rust
fn main() {
    let modules = discover_modules("src/modules");   // lit chaque module.toml
    assert_registered(&modules, "src/modules/mod.rs"); // échec explicite si oubli
    write_capability("capabilities/modules.generated.json", &modules); // "<id>:default"
    let mut attrs = tauri_build::Attributes::new();
    for m in modules {
        // noms/commandes en &'static str via Box::leak (build script uniquement)
        attrs = attrs.plugin(m.id, tauri_build::InlinedPlugin::new()
            .commands(m.commands)
            .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands));
    }
    println!("cargo:rerun-if-changed=src/modules");
    tauri_build::try_build(attrs).expect("tauri-build failed");
}
```

### 5.3 Points d'extension officiels

| Type | Nom | Fourni par | Usage |
|---|---|---|---|
| Slot | `chat.composer.actions` | chat | boutons à côté de l'envoi (micro, image, pièce jointe) |
| Slot | `chat.message.actions` | chat | actions sur un message (copier, lire à voix haute) |
| Slot | `chat.header.right` | chat | indicateurs de session |
| Slot | `launchpad.widgets` | home | widgets sur l'accueil |
| Slot | `statusbar.items` | shell | indicateurs globaux |
| Slot | `settings.sections` | settings | (auto : `manifest.settings`) |
| Service | `engine.session` | core | démarrer/envoyer/écouter une session |
| Service | `system.fs` / `system.shell` | core | actions système passant par la policy |
| Service | `notify.toast` | core | notifications UI |
| Événement | `skills.changed`, `settings.changed`, `modules.changed`, `engine.cli_detected` | core/modules | |

Ajouter un slot = l'ajouter dans `src/core/modules/slots.ts` **et** dans ce tableau.

### 5.4 Navigation évolutive
- **Sidebar** : groupes par `category` (ordre fixe : Core, IA, Système, Créatif, Automatisation), items triés par `order`. Une catégorie vide est masquée. Réglages épinglé en bas.
- **Launchpad** (accueil) : grille bento de blocs générés depuis `manifest.launchpad`. Nouvelle tuile = nouveau module, rien d'autre.
- **Palette `Ctrl+K`** : agrège `manifest.commands` + navigation vers chaque module + sessions récentes.

---

## 6. Moteur Multi-CLI

### 6.1 Trait d'adaptateur
```rust
#[async_trait]
pub trait CliAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn descriptor(&self) -> AdapterDescriptor;                  // nom, couleur, capacités
    async fn detect(&self) -> Option<Installation>;            // chemin + version
    async fn list_models(&self) -> Result<Vec<ModelInfo>, AppError>;
    fn transport(&self) -> TransportKind;                      // Structured | Pty
    fn spawn_spec(&self, ctx: &SessionContext) -> SpawnSpec;   // binaire, args, env, cwd
    fn encode_user_message(&self, text: &str) -> Vec<u8>;      // NDJSON ou texte + \r
    fn decode(&mut self, input: TransportOutput) -> Vec<EngineEvent>;
    fn encode_answer(&self, prompt: &InteractivePrompt, answer: &PromptAnswer) -> AnswerAction;
}
```

### 6.2 Adaptateurs du MVP

| CLI | Binaire | Transport principal | Permissions | Modèles | Switch de modèle |
|---|---|---|---|---|---|
| Claude Code | `claude` | Structured : `-p --input-format stream-json --output-format stream-json --verbose` | `--permission-prompt-tool stdio` → `control_request`/`control_response` (§7.2) | `--model` (opus/sonnet/haiku) | relance avec `--resume <session_id> --model <nouveau>` |
| Antigravity | `agy` | Structured : `-p --input-format stream-json --output-format stream-json` | pas d'outil de prompt exposé → **PTY interactif** (`agy -i`) quand la validation est requise, `--mode accept-edits` en Mode Auto smart | `agy models`, `--model` | relance avec `--conversation <id> --model <nouveau>` |
| Déclaratif (Codex…) | via TOML | PTY | règles de parsing | TOML | relance |

> Flags vérifiés sur `agy --help` (machine de dev, 2026-09-16). À **revalider à chaque mise à jour de CLI** ; la version testée est notée dans chaque adaptateur.

### 6.3 Cycle de vie d'une session
`Starting → Running ⇄ AwaitingInput → Stopping → Ended` (+ `Crashed` → redémarrage proposé avec reprise de conversation).
- Une session = une tâche tokio qui possède le transport et un `mpsc` de commandes (`Send`, `Answer`, `SetModel`, `SetAutoMode`, `Stop`).
- Changement de modèle/CLI à la volée : la session courante est arrêtée proprement et une nouvelle démarre en **reprenant l'identifiant de conversation** quand la CLI le permet ; sinon le frontend affiche un séparateur « Nouveau contexte ».
- Windows : binaire résolu par `which` (`claude.cmd`/`claude.exe`), `CREATE_NO_WINDOW`, arrêt de l'arbre de processus via Job Object.

---

## 7. Parsing Intelligent

**Objectif :** l'utilisateur ne voit jamais `[Y/n]`. Il voit une carte avec des boutons.

### 7.1 Stratégie hybride à 3 niveaux (du plus fiable au moins fiable)

| Niveau | Source | Fiabilité | Utilisé pour |
|---|---|---|---|
| **N1 – Protocole** | la CLI appelle notre outil MCP de permission | 100 % (structuré) | Claude Code : toute demande d'outil |
| **N2 – Flux structuré** | événements NDJSON (`stream-json`) | ~100 % | messages, outils, résultats, usage |
| **N3 – Écran PTY** | émulation `vt100` + règles + heuristiques | 85–98 % selon règles | CLI sans protocole, menus TUI, questions libres |

Règle : **on n'utilise N3 que si N1/N2 ne couvrent pas le cas.**

### 7.2 N1 — Protocole de permission Claude (vérifié le 2026-09-16, claude 2.1.271)

Claude est lancé avec `--permission-prompt-tool stdio`. Avant chaque outil soumis à permission,
il écrit sur stdout :

```json
{"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool",
 "tool_name":"Write","input":{…},"description":"hello.txt","tool_use_id":"toolu_…"}}
```

ARCHIMED classe la demande (`engine::policy`), puis :

```
policy::evaluate(tool, payload, auto_mode)
 ├─ Allow → réponse immédiate + chip « Auto-validé » dans la timeline
 ├─ Deny  → réponse immédiate + ErrorCard
 └─ Ask   → EngineEvent::Prompt(kind=Permission) → carte cliquable → answer_prompt
```

La réponse est écrite sur stdin de la CLI :

```json
{"type":"control_response","response":{"subtype":"success","request_id":"…",
 "response":{"behavior":"allow","updatedInput":{…}}}}
```

ou `{"behavior":"deny","message":"Refusé par l'utilisateur"}`. `updatedInput` permet à l'UI de
modifier l'entrée (ex : corriger une commande) avant d'autoriser.

> Aucun sidecar MCP n'est nécessaire : le protocole passe par le flux stdio déjà ouvert.
> Antigravity n'expose pas d'équivalent ; voir §6.2 et la limite connue de son adaptateur.

### 7.3 N2 — Décodage du flux structuré
Une ligne = un objet JSON. Le décodeur de l'adaptateur mappe :
`system/init` → `SessionStarted` · `stream_event` (deltas) → `MessageDelta` · `assistant` avec `tool_use` → `ToolCall` · `user` avec `tool_result` → `ToolResult` · `result` → `MessageCompleted` + `Usage`.
Lignes non-JSON ou types inconnus → loggés en `debug`, **jamais** de crash (tolérance aux évolutions de CLI). Chaque adaptateur a des tests sur des flux enregistrés (`tests/fixtures/streams/`).

### 7.4 N3 — Pipeline PTY

```
ConPTY ─► thread lecteur (bloquant, 8 Ko) ─► mpsc ─► tâche tokio de session
   ├─► RawOutput (lots de 16 ms) ─────────────────────► xterm (tiroir debug)
   └─► vt100::Parser.process(bytes)   // écran virtuel 200×50, gère les redessins TUI
          └─ détecteur de quiescence : aucune sortie depuis 120 ms
               ET (curseur hors début de ligne OU écran changé)
                 └─► snapshot des 15 dernières lignes non vides (texte brut, sans ANSI)
                      └─► Detector
                           1. règles spécifiques à la CLI (TOML)
                           2. règles génériques (TOML)
                           3. heuristique menu TUI (menu.rs)
                           4. heuristique « question ouverte » (ligne finit par ? ou :)
                      └─► meilleur candidat, score ≥ seuil ?
                           ├─ oui → policy::evaluate → Allow (auto, touches envoyées) | Ask → Prompt
                           └─ non → rien (si la CLI attend > 4 s sans candidat :
                                     Prompt kind=FreeText « La CLI semble attendre une réponse »)
```

**Pourquoi `vt100` et pas un simple strip ANSI :** les CLI modernes (Ink/React TUI, Bubble Tea) redessinent l'écran avec des déplacements de curseur. Supprimer les codes ANSI d'un flux produit du texte dupliqué et illisible ; lire l'**écran rendu** donne exactement ce qu'un humain voit.

**Déduplication / invalidation :** chaque prompt a un `fingerprint` (hash de la zone détectée). Même fingerprint → pas de nouvel événement. Si la zone disparaît de l'écran (l'utilisateur a répondu dans le terminal brut, ou la CLI a continué) → `PromptInvalidated`.

**Vérification de la réponse :** après envoi des touches, l'écran doit changer sous 2 s ; sinon la carte repasse en état « réponse non prise en compte » avec option d'ouvrir le terminal brut.

### 7.5 Format des règles (TOML)

```toml
# resources/prompt-rules/generic.toml
[[rule]]
id = "generic.yes_no"
kind = "confirm"
confidence = 0.92
# (?m) multi-ligne ; groupe nommé question ; Y majuscule = défaut
pattern = '''(?m)^(?P<question>.{3,200}?)\s*[\[\(](?P<opts>[yY]/[nN])[\]\)]\s*[:?]?\s*$'''
default_from = "uppercase"          # l'option en majuscule devient le bouton primaire
risk_hint = "inherit"               # inherit | low | medium | high
  [[rule.option]]
  id = "yes";  label = "Oui";  keys = "y\r"; variant = "primary"; shortcut = "Y"
  [[rule.option]]
  id = "no";   label = "Non";  keys = "n\r"; variant = "default"; shortcut = "N"

[[rule]]
id = "generic.press_enter"
kind = "confirm"
confidence = 0.85
pattern = '''(?mi)^.*press (enter|return) to (?P<question>continue|proceed).*$'''
  [[rule.option]]
  id = "continue"; label = "Continuer"; keys = "\r"; variant = "primary"
```

Menus TUI (`menu.rs`, sans règle) : détection d'un bloc de lignes consécutives alignées, dont une porte un marqueur de sélection (`❯`, `›`, `>`, `●`) et/ou sont numérotées (`1.`, `2)`). Ligne précédant le bloc = question. Réponse :
- options numérotées → envoi du chiffre (`"2"`), + `\r` si la règle l'exige ;
- sinon → `↓`×(cible − index courant) (`\x1b[B`) ou `↑` (`\x1b[A`), puis `\r`.

### 7.6 Le contrat `InteractivePrompt`

```rust
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InteractivePrompt {
    pub prompt_id: String,
    pub session_id: SessionId,
    pub kind: PromptKind,             // Confirm | Choice | Permission | FreeText | Secret
    pub title: String,                // « Modifier src/main.rs ? »
    pub detail: Option<PromptDetail>, // Diff { path, before, after } | Command { shell, line, cwd } | Text(String)
    pub options: Vec<PromptOption>,   // { id, label, variant: Primary|Default|Danger, shortcut }
    pub default_option: Option<String>,
    pub allow_free_text: bool,
    pub risk: RiskLevel,              // Low | Medium | High | Critical
    pub source: PromptSource,         // Protocol | Structured | Screen { rule_id, confidence }
    pub raw_excerpt: Option<String>,  // texte d'origine, affichable en « détails »
}
```

Côté frontend, `card-registry` choisit le composant : `Permission` + `Diff` → `DiffCard` avec boutons ; `Command` → `CommandCard` (commande éditable) ; `Choice` → liste de boutons ; `FreeText`/`Secret` → champ intégré à la carte. Raccourcis : `1…9` pour les options, `Entrée` = défaut, `Échap` = refuser. La carte est **verrouillée** dès le clic (anti double-réponse) et affiche qui a résolu (utilisateur / Mode Auto).

### 7.7 Réponse
`answer_prompt { sessionId, promptId, optionId?, text?, editedInput? }` → `Session` vérifie que le prompt est encore actif (sinon `PROMPT_EXPIRED`) → `adapter.encode_answer` → `AnswerAction::Bridge(json)` (N1) ou `AnswerAction::Keys(bytes)` (N3) ou `AnswerAction::Stdin(ndjson)` (N2).

---

## 8. Mode Auto et policy de sécurité

`policy::evaluate(action, ctx) -> Decision { verdict: Allow|Ask|Deny, risk, reason }`

| Risque | Exemples | `off` | `smart` | `full` |
|---|---|---|---|---|
| Low | lecture fichier, `ls`, recherche web | Ask | Allow | Allow |
| Medium | édition dans le dossier de travail, `pnpm install` | Ask | Allow | Allow |
| High | suppression, commande hors dossier de travail, téléchargement d'exécutable | Ask | Ask | Allow |
| Critical | `rm -rf`/`Remove-Item -Recurse` sur racine ou profil, `format`, `reg delete`, `bcdedit`, désactivation antivirus, lecture de fichiers d'identifiants | Ask | Ask | **Ask** |

- Classification dans `risk.rs` : outil + chemins (dans/hors `cwd`) + motifs de commande (liste versionnée et testée).
- Le Mode Auto se règle **par session** (toggle dans le composer) avec un défaut global.
- Chaque décision → `audit.jsonl` + chip « Auto-validé » dans la timeline (cliquable pour voir le détail).

---

## 9. Contrôle système

- **Via les CLI** : Claude/Antigravity utilisent leurs propres outils (Bash, Edit, WebFetch…) ; ARCHIMED les encadre par la policy (N1) ou le parsing (N3).
- **Via ARCHIMED directement** (`system/*`, exposé au frontend et aux modules) : `fs` (lecture, écriture, déplacement, corbeille, watcher), `shell` (PowerShell supervisé, sortie streamée), `net` (téléchargement avec progression, vérification de taille/type).
- Tauri : les capabilities de `system.json` donnent un scope large (`$HOME/**`, lecteurs locaux) ; la **restriction réelle est la policy**, pas le scope.

---

## 10. Gestionnaire de Skills

- **Bibliothèque** : `%APPDATA%\com.sdai.archimed\skills\<skill-id>\SKILL.md` (+ fichiers annexes). Index `skills.json` (état activé, source, version, CLI cibles).
- **Adoption** au premier lancement : les skills déjà présents dans `~/.claude/skills` sont indexés **sans être déplacés** (source = `external`).
- **Activer** = créer une jonction NTFS (pas besoin de droits admin) de la bibliothèque vers le dossier de skills de chaque CLI cible (`~/.claude/skills/<id>`, dossier défini dans l'adaptateur pour les autres). **Désactiver** = supprimer la jonction (la bibliothèque est conservée).
- **Importer** : dossier, `.zip`, URL Git (clone), ou **« Demander à l'IA »** : une session est lancée avec pour consigne de récupérer le skill dans `skills\_incoming\` ; ARCHIMED valide ensuite le frontmatter (`name`, `description`) avant installation.
- **Import en masse** : bouton « Ouvrir le dossier » (opener) ; un watcher `notify` détecte les ajouts et les propose à l'indexation (`skills.changed`).

---

## 11. Données et stockage

| Donnée | Emplacement |
|---|---|
| Réglages | `%APPDATA%\com.sdai.archimed\settings.json` (tauri-plugin-store) |
| Secrets | Gestionnaire d'identifiants Windows (`keyring`) |
| Sessions / historique | `%APPDATA%\com.sdai.archimed\sessions\<id>.jsonl` (événements rejouables) |
| Skills | `%APPDATA%\com.sdai.archimed\skills\` |
| Logs | `%APPDATA%\com.sdai.archimed\logs\` (`app.log` rotatif, `audit.jsonl`) |
| Données d'un module | `%APPDATA%\com.sdai.archimed\modules\<id>\` (via `core::paths::module_dir`) |

---

## 12. Pipeline de build

`build.ps1` : prérequis (Node, pnpm, Rust MSVC, Build Tools) → `pnpm install` → `pnpm check` + `pnpm test` + `cargo clippy -D warnings` → build d'un sidecar optionnel s'il existe → `pnpm tauri build` → copie de l'`.exe` portable et des installeurs dans `release/<version>/`.
