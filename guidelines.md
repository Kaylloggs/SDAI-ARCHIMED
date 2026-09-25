# SDAI ARCHIMED — Guidelines (la Bible du projet)

> **Ce fichier fait loi.** Toute IA ou tout humain qui modifie ce dépôt DOIT l'avoir lu en entier.
> En cas de conflit entre ce fichier et une habitude, ce fichier gagne.
> En cas de conflit entre ce fichier et `architecture.md` / `design.md`, signaler l'incohérence et corriger la doc dans le même changement.

---

## 0. TL;DR pour agents IA (à lire en 60 secondes)

**Ordre de lecture obligatoire avant toute modification :**
1. `guidelines.md` (ce fichier) — règles et procédures.
2. `architecture.md` — comment le Front parle au Back, moteur CLI, parsing, système de modules.
3. `design.md` — si tu touches à la moindre pixel d'UI.
4. Le `README.md` du module concerné (`src/modules/<id>/README.md`).

**Les 10 règles d'or :**
1. **100 % modulaire.** Une fonctionnalité = un dossier dans `src/modules/<id>/` (+ optionnellement `src-tauri/src/modules/<id>/`). Rien d'autre.
2. **Le core n'importe JAMAIS un module.** Les modules sont découverts automatiquement.
3. **Un module n'importe JAMAIS un autre module.** Il passe par les *services*, *slots* et le *bus d'événements* du core.
4. **Supprimer un dossier de module ne doit rien casser** : l'app compile, démarre, et le module disparaît simplement de l'UI.
   Et **tout module existe dans la doc** : `README.md` (tableau des modules) + `architecture.md` (arborescence) + son propre `README.md`.
5. **Tout appel Rust passe par la couche `api.ts` du module** (jamais d'`invoke()` dispersé dans les composants).
6. **Types partagés Rust ↔ TS générés** (`ts-rs`), jamais recopiés à la main.
7. **Aucune valeur de design en dur** : couleurs, espacements, rayons, durées = tokens de `design.md`.
8. **Aucune action système destructive sans passer par `engine::policy`** (même en Mode Auto).
9. **Pas de `unwrap()`/`expect()` en Rust hors tests et `build.rs`. Pas de `any` en TS.**
10. **Tu modifies le comportement → tu mets à jour la doc dans le même commit.**

---

## 1. Contexte du projet

**SDAI ARCHIMED** est un assistant personnel de bureau (Windows, `.exe`) qui :
- **encapsule des CLI d'IA** (Claude Code CLI, Antigravity CLI `agy`, puis Codex, etc.) dans une interface de messagerie moderne ;
- **transforme les sorties terminal en composants interactifs** (boutons, formulaires, cartes de diff) grâce au *Parsing Intelligent* ;
- **contrôle le système** (fichiers, scripts, réseau) comme le fait Claude Code ;
- **gère des Skills** (import, activation, synchronisation vers les CLI) ;
- **s'étend à l'infini par blocs** (Voix, Génération d'images, Workflows agentiques…).

Utilisateur cible : un power-user unique sur sa machine. Priorités, dans l'ordre :
**Fiabilité > Modularité > Clarté du code > Beauté de l'UI > Performance > Nombre de fonctionnalités.**

---

## 2. Stack technique (versions de référence)

| Couche | Choix | Remarque |
|---|---|---|
| Shell natif | **Tauri 2.x** | `.exe` + installeur NSIS/MSI |
| Backend | **Rust stable (édition 2021)**, `tokio` | processus, PTY, I/O, sécurité |
| PTY Windows | `portable-pty` (ConPTY) | CLI interactives |
| Émulation écran | `vt100` | lecture de l'écran « rendu » d'une TUI |
| Types partagés | `ts-rs` | génère `src/core/ipc/bindings/*.ts` |
| Erreurs Rust | `thiserror` | une `AppError` sérialisable |
| Frontend | **React 19 + TypeScript strict + Vite** | |
| Style | **Tailwind CSS v4** + **shadcn/ui** (Radix) | tokens dans `design-system/tokens.css` |
| État | `zustand` | un store par domaine |
| Animation | `motion` (ex framer-motion) | presets dans `design-system/motion.ts` |
| Terminal brut | `@xterm/xterm` | vue « debug », cachée par défaut |
| Icônes | `lucide-react` | |
| Palette de commandes | `cmdk` | `Ctrl+K` |
| Validation | `zod` | manifests, settings, entrées |
| Tests | `vitest` + Testing Library, `cargo test` | |
| Gestionnaire de paquets | **pnpm** (jamais npm/yarn) | |

Ajouter une dépendance = la justifier dans la PR/commit (taille, maintenance, alternative core). Pas de doublon de rôle (ex : pas de 2e lib d'état).

---

## 3. Où mettre quoi

```
src/core/            → infrastructure frontend PARTAGÉE (shell, registre, IPC, cartes, bus). Jamais de logique métier d'un module.
src/design-system/   → tokens, CSS global, primitives UI, composants shadcn. Aucune logique métier.
src/modules/<id>/    → TOUT ce qui concerne une fonctionnalité côté UI.
src-tauri/src/core/  → erreurs, état global, chemins, config, logs.
src-tauri/src/engine/→ moteur multi-CLI : sessions, transports, adaptateurs, parsing, policy.
src-tauri/src/system/→ primitives système (fs, shell, net) utilisées par le moteur et les modules.
src-tauri/src/modules/<id>/ → backend d'un module (= plugin Tauri inline).
src-tauri/resources/adapters/      → exemple d'adaptateur TOML (les vrais : %APPDATA%\com.sdai.archimeddapters\).
src-tauri/resources/prompt-rules/  → règles TOML de détection de questions.
scripts/             → outillage (scaffolding, vérifications).
docs/adr/            → décisions d'architecture (ADR).
```

**Question à se poser avant d'écrire du code : « Si je supprime ce module demain, ce code doit-il disparaître avec ? »**
Oui → il va dans le module. Non, et au moins 2 modules en ont besoin → il va dans le core.

---

## 4. Créer un nouveau module (procédure officielle)

### 4.1 Scaffolding

```bash
pnpm new:module image-gen --category creative --backend
```

Le script `scripts/new-module.mjs` copie `src/modules/_template/`, renomme les identifiants, et si `--backend` est passé, crée `src-tauri/src/modules/image_gen/`. Aucun registre à tenir à jour : `build.rs` découvre les dossiers qui contiennent un `module.toml`.
**Ne crée jamais un module à la main** sauf si le script est cassé (et répare-le alors).

### 4.2 Anatomie d'un module frontend

```
src/modules/image-gen/
├── module.config.ts     ← OBLIGATOIRE : manifest (seul fichier lu par le core)
├── index.tsx            ← OBLIGATOIRE : page principale (export default, chargée en lazy)
├── README.md            ← OBLIGATOIRE : rôle, services fournis/consommés, commandes Rust
├── tutorial.ts          ← OBLIGATOIRE (sauf module requis) : tutoriel d'utilisation, voir §4.3
├── api.ts               ← appels backend typés (seul endroit avec invoke)
├── store.ts             ← store zustand du module (préfixé par l'id)
├── types.ts
├── components/          ← composants propres au module (PascalCase.tsx)
├── hooks/               ← useXxx.ts
├── cards/               ← renderers de cartes de timeline fournis au chat (optionnel)
├── settings/            ← panneau de réglages (optionnel)
├── i18n/fr.json, en.json
└── __tests__/
```

### 4.3 Le manifest `module.config.ts`

```ts
import { lazy } from "react";
import { ImageIcon } from "lucide-react";
import { defineModule } from "@/core/modules";

export default defineModule({
  id: "image-gen",                    // kebab-case, unique, immuable une fois publié
  name: "Images",                     // libellé court (≤ 14 caractères)
  description: "Génère et édite des images à partir d'un prompt.",
  version: "0.1.0",                   // semver du module
  icon: ImageIcon,
  category: "creative",               // core | ai | productivity | system | creative | automation | settings
  order: 40,                          // tri dans sa catégorie
  enabledByDefault: true,

  page: lazy(() => import("./index")),// route auto : /m/image-gen
  launchpad: { size: "md", accent: false }, // tuile sur l'écran d'accueil (sm | md | lg), ou false

  backend: { plugin: "image-gen" },   // id du plugin Tauri (kebab-case), ou omis si pas de backend

  // ── Points d'extension (tous optionnels) ──────────────────────────────
  provides: {                         // services exposés aux autres modules
    "image.generate": () => import("./services/generate"),
  },
  consumes: ["engine.session"],       // services utilisés ; absence = dégradation gracieuse
  slots: {                            // contributions UI dans les zones d'autres écrans
    "chat.composer.actions": lazy(() => import("./components/ComposerImageButton")),
  },
  cards: {                            // renderers de cartes pour la timeline du chat
    "tool:generate_image": lazy(() => import("./cards/ImageResultCard")),
  },
  commands: [                         // entrées de la palette Ctrl+K
    { id: "image-gen.new", title: "Nouvelle image", shortcut: "Ctrl+Shift+I", run: "navigate" },
  ],
  settings: lazy(() => import("./settings/ImageGenSettings")),
  tutorial,                           // import tutorial from "./tutorial" (obligatoire, voir ci-dessous)
});
```

**Tutoriel** (`tutorial.ts`, affiché par le module Tutoriel, architecture.md §5.5) :
```ts
import { MapPin, Sparkles } from "lucide-react";
import { defineTutorial } from "@/core/modules";

export default defineTutorial({
  summary: "Générer une image à partir d'une phrase.",  // à quoi sert le module
  steps: [                                               // 3 à 7 étapes, dans l'ordre du geste
    { icon: Sparkles, title: "Décrire l'image", text: "Écrivez ce que vous voulez voir.", area: "bottom" },
    { icon: MapPin, title: "Choisir le format", text: "Carré, portrait ou paysage.", area: "right", keys: ["Ctrl", "R"] },
  ],
  tips: ["Une astuce, facultative."],
});
```
Titre qui commence par un verbe, une ou deux phrases avec les mots affichés à l'écran, `area`
= où regarder dans la fenêtre (`rail`, `top`, `left`, `center`, `right`, `bottom`). Pas de tiret
cadratin. **Tu changes l'interface d'un module → tu mets son tutoriel à jour dans le même commit.**

Le manifest est validé par `zod` au démarrage (`src/core/modules/manifest.schema.ts`). **Un manifest invalide = module ignoré + erreur loggée + badge dans Réglages > Modules. Jamais un crash du shell.**

### 4.4 Découverte automatique (ne rien enregistrer à la main côté front)

`src/core/modules/registry.ts` utilise :

```ts
const found = import.meta.glob<{ default: ModuleManifest }>(
  ["../../modules/*/module.config.ts", "!../../modules/_*/**"],
  { eager: true },
);
```

Tout dossier dont le nom commence par `_` est ignoré (`_template`, brouillons).
La navigation, les routes, le launchpad, la palette et les slots se construisent depuis ce registre.

### 4.5 Anatomie d'un module backend (plugin Tauri inline)

```
src-tauri/src/modules/image_gen/
├── module.toml     ← OBLIGATOIRE : id + liste des commandes (lu par build.rs)
├── mod.rs          ← expose `pub fn plugin<R: Runtime>() -> TauriPlugin<R>`
├── commands.rs     ← #[tauri::command] uniquement, fines, délèguent au service
├── service.rs      ← logique métier testable sans Tauri
└── types.rs        ← structs #[derive(Serialize, Deserialize, TS)]
```

`module.toml` :
```toml
id = "image_gen"
commands = ["generate", "list_history", "delete_item"]
# Facultatif : comptes du Gestionnaire d'identifiants du module (préfixe `<id>-` obligatoire),
# effacés si la personne supprime le module (Réglages → Modules).
credentials = ["image_gen-api"]
```

**Suppression par la personne** (Réglages → Modules → Supprimer, `core/modules.rs`) : le module
disparaît de l'interface et le core efface ses traces, sans connaître le module. Pour que ce soit
complet, un module range **tout** ce qu'il écrit dans `Paths::module_dir(<id>)` (sauf les
fichiers que la personne choisit elle-même, projets ou exports), sa déclaration MCP dans
`mcp/<id>.json`, ses clés dans le Gestionnaire d'identifiants sous des comptes déclarés dans
`credentials`, et ses réglages du navigateur sous `archimed.<id>.…` ou `<id>.…`.

`mod.rs` :
```rust
use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};

mod commands;
mod service;
pub mod types;

pub const ID: &str = "image-gen";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::generate,
            commands::list_history,
            commands::delete_item,
        ])
        .setup(|app, _api| {
            app.manage(service::ImageGenService::new(app)?);
            Ok(())
        })
        .build()
}
```

Enregistrement : **rien à écrire**. `src-tauri/src/modules/mod.rs` inclut un registre généré par `build.rs` à partir des dossiers présents :
```rust
include!(concat!(env!("OUT_DIR"), "/modules.rs"));
```
Créer le dossier suffit ; le supprimer suffit à retirer le module (règle d'or n°4).

`build.rs` lit chaque `module.toml`, déclare le plugin inline à `tauri-build` (permissions `AllowAllCommands`), génère le registre `OUT_DIR/modules.rs` et régénère `capabilities/modules.generated.json` (fichier non versionné, ne jamais l'éditer à la main).

Conséquence utile : un module **personnel** (dossiers ignorés par `.git/info/exclude`) fonctionne sans laisser la moindre trace dans les fichiers publiés. `scripts/check-modules.mjs` n'exige de documentation que pour les modules suivis par git.

Appel côté frontend, **uniquement dans `api.ts`** :
```ts
import { invokeModule } from "@/core/ipc";
import type { ImageJob } from "@/core/ipc/bindings/ImageJob";

export const imageGenApi = {
  generate: (prompt: string) => invokeModule<ImageJob>("image-gen", "generate", { prompt }),
};
// → invoke("plugin:image-gen|generate", { prompt })
```

### 4.6 Communication entre modules

| Besoin | Mécanisme | Exemple |
|---|---|---|
| Appeler une capacité d'un autre module | **Service** (`provides` / `useService`) | Le chat appelle `voice.transcribe` si le module voix existe |
| Afficher de l'UI dans l'écran d'un autre module | **Slot** (`slots` / `<Slot name>`) | Bouton micro dans le composer du chat |
| Réagir à un fait | **Bus d'événements** (`bus.emit` / `useBusEvent`) | `skills.changed` → le chat rafraîchit la liste |
| Afficher un résultat riche dans le chat | **Card renderer** (`cards`) | Carte image pour l'outil `generate_image` |

Règle : **toujours coder le cas où le service/slot est absent.** `useService("voice.transcribe")` retourne `undefined` si le module est désactivé → le bouton ne s'affiche pas.

Noms de slots, services et événements : `domaine.sujet.action` en minuscules. Les slots disponibles sont listés dans `src/core/modules/slots.ts` (source de vérité) et dans `architecture.md`.

### 4.7 Checklist « module terminé »

- [ ] `pnpm check` et `pnpm test` passent ; `cargo clippy -- -D warnings` et `cargo test` passent.
- [ ] Le module fonctionne **seul** et l'app fonctionne **sans lui** (tester en renommant le dossier en `_image-gen`).
- [ ] `README.md` du module rempli (template fourni).
- [ ] `tutorial.ts` écrit et relu dans le module Tutoriel (vérifié par `pnpm check` et `pnpm test`).
- [ ] États vide / chargement / erreur conçus (voir `design.md` §9).
- [ ] Aucun token de design en dur, aucune chaîne UI en dur hors `i18n/`.
- [ ] Types Rust exportés via `ts-rs` et bindings régénérés (`pnpm gen:bindings`).
- [ ] Ligne ajoutée dans `CHANGELOG.md`.
- [ ] **Module listé dans la documentation** : tableau des modules du `README.md` (sauf module requis) ET arborescence d'`architecture.md` §2 (vérifié par `pnpm check`).

---

## 5. Ajouter une CLI d'IA (adaptateur)

**Cas 1 — CLI interactive quelconque : zéro Rust.**
Déposer un fichier `<id>.toml` dans `%APPDATA%\com.sdai.archimed\adapters\` (bouton **Réglages › Moteur › Ajouter une CLI…**). Un exemple commenté y est créé au premier lancement (`exemple.toml.txt`, source : `src-tauri/resources/adapters/exemple.toml`).
```toml
id = "ma-cli"                          # kebab-case, unique (claude, antigravity, codex réservés)
name = "Ma CLI"
binary = ["ma-cli", "ma-cli.cmd"]      # cherchés dans le PATH
args = ["--model", "{model}"]          # sans modèle, « --model » est retiré
resume_args = ["--resume", "{resume}"] # ajoutés pour reprendre une conversation
models = [{ id = "rapide", label = "Rapide" }]
default_model = "rapide"
hint = "Installez ma-cli avec …"

[[rule]]                               # questions propres à la CLI (optionnel)
id = "ma-cli.deploy"
kind = "confirm"
confidence = 0.95
pattern = '''^(?P<question>Déployer en production) \? \(oui/non\)\s*$'''
  [[rule.option]]
  id = "yes"
  label = "Déployer"
  keys = "oui\r"
  variant = "danger"
```
La CLI tourne dans un vrai terminal (transport PTY) ; ses questions sont lues à l'écran et deviennent des cartes. Un fichier invalide est ignoré (avertissement dans les logs), jamais bloquant.

**Cas 2 — CLI avec sortie structurée (stream-json) : un fichier Rust.**
Implémenter le trait `CliAdapter` dans `src-tauri/src/engine/adapters/<id>.rs` (voir `architecture.md` §6) et l'ajouter à `build_all()` dans `adapters/mod.rs`. Adaptateurs de référence : `claude.rs`, `antigravity.rs`. Émettre `EngineEvent::CliSession` dès que la CLI communique son identifiant de conversation, et gérer `resume` dans `spawn_args` : c'est ce qui permet de reprendre le contexte après un redémarrage.

Toujours : vérifier les flags réels avec `<cli> --help` et **consigner la version testée** en tête du fichier (`// Testé avec agy x.y.z le AAAA-MM-JJ`).

---

## 6. Ajouter une règle de Parsing Intelligent

- **Règle générique** (utile à toutes les CLI) : `src-tauri/resources/prompt-rules/generic.toml` (embarqué dans l'exécutable).
- **Règle propre à une CLI** : dans son adaptateur TOML (`[[rule]]`), testée avant les génériques.

Chaque règle générique doit avoir **un test de fixture** dans `src-tauri/src/engine/parser/detector.rs` (module `tests`) : un écran texte, la règle attendue, le titre, l'option par défaut et les touches envoyées. Une règle sans fixture est refusée. Format : `architecture.md` §7.5.

---

## 7. Contrat IPC Front ↔ Back

- **Commandes** (`invoke`) : requête/réponse, courtes (< 100 ms idéalement). Tout ce qui est long → retourne un `job_id` puis stream via Channel.
- **Channels** (`tauri::ipc::Channel<T>`) : flux ordonné et haut débit d'une session (sortie CLI, progression de téléchargement). **À privilégier** pour le moteur.
- **Événements globaux** (`app.emit`) : faits rares et globaux uniquement (`skills.changed`, `settings.changed`, `engine.cli_detected`).
- **Erreurs** : toutes les commandes retournent `Result<T, AppError>`. Côté TS, `AppError` = `{ code: AppErrorCode; message: string; details?: unknown }`. Les `code` sont un enum fermé (`NOT_FOUND`, `PERMISSION_DENIED`, `CLI_NOT_INSTALLED`, `PROCESS_CRASHED`, `POLICY_BLOCKED`, `INVALID_INPUT`, `IO`, `NETWORK`, `INTERNAL`).
- **Sérialisation** : `#[serde(rename_all = "camelCase")]` sur toutes les structs exposées ; enums taggés `#[serde(tag = "type", rename_all = "camelCase")]`.

---

## 8. Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Id de module (front) | kebab-case | `image-gen` |
| Id de plugin Tauri (`module.toml`) | kebab-case (= id front) | `image-gen` |
| Dossier backend Rust | snake_case | `image_gen` |
| Dossiers, fichiers TS utilitaires | kebab-case | `card-registry.ts`, `module.config.ts` |
| Hooks | camelCase préfixé `use` | `useSession.ts` |
| Composants React | PascalCase, 1 composant exporté par fichier | `PromptCard.tsx` |
| Stores zustand | `use<Domaine>Store` dans `store.ts` | `useSkillsStore` |
| Fichiers Rust | snake_case | `auto_mode.rs` |
| Types / structs / enums | PascalCase | `InteractivePrompt` |
| Commandes Tauri | snake_case, verbe d'abord | `list_skills`, `answer_prompt` |
| Événements / services / slots | `domaine.sujet[.action]` | `engine.prompt.resolved` |
| Constantes | SCREAMING_SNAKE_CASE | `MAX_SESSIONS` |
| Variables CSS (tokens) | `--kebab-case` | `--surface-2` |
| Id de règle de parsing | `<cli>.<nom>` | `generic.yes_no` |
| Branches git | `type/sujet-court` | `feat/voice-module` |

Langue : **code, identifiants, commits en anglais** ; **documentation et textes UI en français** (clés i18n en anglais).

---

## 9. Règles TypeScript / React

- `strict: true`, `noUncheckedIndexedAccess: true`. Interdit : `any`, `@ts-ignore` (utiliser `@ts-expect-error` + justification).
- Alias d'import `@/` = `src/`. Un module importe uniquement depuis `@/core/*`, `@/design-system/*` et ses propres fichiers relatifs. **`pnpm check` (scripts/check-modules.mjs) échoue sur tout import croisé** ; une règle ESLint équivalente arrivera en Phase 2.
- Composants fonctionnels uniquement. Props typées avec `type XxxProps = {...}`.
- Pas de logique dans le JSX au-delà d'un ternaire simple ; extraire en hooks.
- Les stores zustand exposent des sélecteurs ; les composants s'abonnent à des tranches minimales (`useStore(s => s.x)`).
- Toute page de module est `lazy` et entourée par l'`ErrorBoundary` du shell (fourni automatiquement).
- Accessibilité : chaque élément interactif est atteignable au clavier, a un label, et un focus visible.
- Pas de `useEffect` pour dériver de l'état ; pas de fetch dans `useEffect` sans annulation.

## 10. Règles Rust

- `cargo fmt` + `cargo clippy -- -D warnings` obligatoires.
- Pas de `unwrap`/`expect`/`panic!` hors tests et `build.rs`. Propager avec `?` vers `AppError`.
- **Jamais d'I/O bloquante sur un thread async.** Lecture PTY → thread dédié (`std::thread`) + `tokio::sync::mpsc`. Fichiers lourds → `tokio::fs` ou `spawn_blocking`.
- Commandes Tauri fines : validation des entrées → appel `service` → mapping du résultat. La logique vit dans `service.rs`, testable sans Tauri.
- État partagé : `app.manage(...)`, types internes en `Arc<RwLock<...>>` (`tokio::sync`) ; jamais de `static mut`.
- Processus enfants Windows : flag `CREATE_NO_WINDOW`, résolution du binaire via `which` (gère `.cmd`/`.exe`), arrêt propre (signal → délai 3 s → kill de l'arbre de processus).
- Logs : `tracing` avec champs structurés (`session_id`, `adapter`), jamais de secrets ni de contenu de prompt complet en niveau `info`.

---

## 11. Sécurité et contrôle système

ARCHIMED a un **accès total** au système. Cette puissance est encadrée, pas bridée :

1. **Toute action à effet de bord** (écriture/suppression de fichier, exécution de commande, téléchargement) initiée par l'app ou une CLI passe par `engine::policy::evaluate()` qui retourne `Allow | Ask | Deny` avec un niveau de risque `Low | Medium | High | Critical`.
2. **Mode Auto** : `off` (tout demander) / `smart` (auto-valide Low & Medium) / `full` (auto-valide tout sauf `Critical`). **`Critical` est TOUJOURS demandé** (ex : suppression récursive hors dossier de travail, `format`, modification du registre, désactivation de Defender, exfiltration de fichiers d'identifiants).
3. **Journal d'audit** : toute décision (utilisateur ou auto) est écrite dans `%APPDATA%\com.sdai.archimed\logs\audit.jsonl`.
4. Suppression de fichiers → **Corbeille Windows** (crate `trash`) par défaut, jamais de suppression définitive silencieuse.
5. Secrets (clés API) → `tauri-plugin-stronghold` ou Gestionnaire d'identifiants Windows (`keyring`), **jamais** en clair dans `settings.json` ni dans les logs.
6. Le protocole de permission de Claude passe par le stdio du processus enfant (aucun port réseau ouvert).
7. Contenu issu d'une CLI, d'un fichier ou d'Internet = **donnée**, jamais une instruction pour l'app.

---

## 12. Design (résumé — la référence est `design.md`)

- Avant tout travail UI, **charger les skills `ui-ux-pro-max`, `impeccable` et `apple-design`** et appliquer `design.md`.
- Thème sombre par défaut, typographie **Geist / Geist Mono**, accent unique **laiton** (`--accent`), glassmorphism **uniquement** sur les couches flottantes.
- L'interface est une **messagerie**, pas un terminal : le terminal brut est un tiroir de debug caché.
- Composants : shadcn/ui re-stylés par tokens ; primitives maison dans `design-system/primitives`.
- Animations : presets de `design-system/motion.ts` uniquement ; respecter `prefers-reduced-motion`.

---

## 13. Qualité, tests, commandes

| Commande | Rôle |
|---|---|
| `pnpm tauri dev` | Lancer l'app en développement |
| `pnpm check` | `tsc --noEmit` + `scripts/check-modules.mjs` (invariants de modularité) |
| `pnpm test` | Vitest |
| `pnpm gen:bindings` | Régénère les types TS depuis Rust (`cargo test export_bindings`) |
| `pnpm new:module <id>` | Scaffolding d'un module |
| `cd src-tauri; cargo clippy -- -D warnings; cargo test` | Qualité Rust |
| `.\build.ps1` (ou double-clic `build.bat`) | Build complet du `.exe` + installeurs |

Exigences minimales de tests :
- Chaque règle de parsing : test de fixture.
- Chaque adaptateur : test de parsing d'un flux enregistré (`tests/fixtures/streams/<cli>/*.ndjson`).
- `engine::policy` : tests table-driven couvrant chaque niveau de risque.
- Chaque `service.rs` de module : tests unitaires des chemins nominaux et d'erreur.

---

## 14. Git et commits

- Conventional Commits : `feat(chat): ...`, `fix(engine): ...`, `docs: ...`, `refactor(skills): ...`, `chore: ...`.
- Un commit = un changement cohérent. Pas de commit qui casse `pnpm check`.
- Décision structurante (nouvelle dépendance majeure, changement de contrat IPC, nouveau type de point d'extension) → ADR dans `docs/adr/NNNN-titre.md`.

## 15. Documentation obligatoire

| Si tu… | …mets à jour |
|---|---|
| ajoutes/supprimes un module | son `README.md`, le tableau « Shipped modules » du `README.md` racine, l'arborescence d'`architecture.md` §2, `CHANGELOG.md` — **obligatoire, `pnpm check` échoue sinon** |
| ajoutes un slot, service core, événement global | `src/core/modules/slots.ts` + `architecture.md` §5 |
| modifies le contrat `EngineEvent` / `InteractivePrompt` | `architecture.md` §7 + bindings |
| ajoutes une CLI | `architecture.md` §6 (tableau des adaptateurs) + `README.md` (prérequis) |
| changes un token ou un pattern visuel | `design.md` |
| changes une règle de ce fichier | `guidelines.md` + ADR si structurant |

## 16. Definition of Done

Une tâche est terminée quand : le code compile, les vérifications passent, le comportement a été **vu fonctionner dans l'app** (`pnpm tauri dev`), les états d'erreur sont gérés, la doc est à jour, et le module reste supprimable sans effet de bord.

## 17. Interdits absolus

- Importer un module depuis le core ou depuis un autre module.
- Éditer les fichiers générés : `src/core/ipc/bindings/**`, `capabilities/modules.generated.json`, `src-tauri/binaries/**`, `src/design-system/components/ui/**` (sauf re-génération shadcn documentée).
- Lancer une CLI avec `--dangerously-skip-permissions` / `bypassPermissions` : le Mode Auto passe **toujours** par la policy ARCHIMED.
- Ajouter une police, une couleur ou une lib d'animation hors `design.md`.
- Utiliser le drag & drop HTML5 (`draggable`, `onDragStart`, `dataTransfer`) pour un glisser interne : sous Windows, `dragDropEnabled` le bloque. Passer par `@/core/dnd` (`useDragSource`, `DropZone`).
- Utiliser un `<select>` natif ou `window.confirm/alert/prompt` : passer par `Select` et les cartes/boutons de confirmation du design system.
- Charger des ressources depuis un CDN à l'exécution (l'app doit fonctionner hors ligne pour son UI).
- Supprimer définitivement des fichiers utilisateur sans confirmation `Critical`.
- Committer des secrets, des logs, ou `src-tauri/target/`.
