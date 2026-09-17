# Module `planner`

Gestionnaire de tâches façon Trello : **plusieurs tableaux**, colonnes, cartes (échéance, étiquettes, notes, sous-tâches), glisser-déposer entre colonnes, progression.

## Cartes
- **Titre et notes en Markdown** : titre sur une ligne (`components/InlineMarkdown.tsx` — gras, italique, code, barré, liens), notes complètes (`components/MarkdownNotes.tsx`). Édition brute, aperçu mis en forme. Les exports (.ics, Google Agenda) reçoivent le texte sans balisage.
- **Glisser-déposer** via `@/core/dnd` : la carte quitte sa colonne et suit le pointeur (ressort souple, inclinaison selon la vitesse), la colonne survolée ouvre un emplacement d'accueil, l'arrivée est animée (`layout`). « Animations réduites » : suivi direct, sans inclinaison.

## Vues
- **Tableau** : colonnes et cartes. Renommer une colonne (double clic ou crayon), la supprimer avec ses cartes (corbeille, confirmation en deux temps). Les colonnes issues d'un `roadmap.md` se gèrent dans le fichier.
- **Calendrier** : mois du lundi au dimanche, échéances colorées (retard, aujourd'hui, bientôt). Glisser une carte sur un jour fixe son échéance, sur « Sans échéance » la retire ; « + » sur un jour crée une carte datée. Vue mémorisée par poste (`localStorage`, confort uniquement).

- **Backend** : plugin `planner` (`src-tauri/src/modules/planner/`).
- **Commandes** : `load_boards`, `save_boards`, `read_roadmap`, `set_roadmap_task`, `append_roadmap_tasks`, `find_roadmap`, `watch_roadmap`, `unwatch_roadmap`, `export_ics`.
- **Stockage** : `%APPDATA%\com.sdai.archimed\modules\planner\boards.json` (écriture atomique, sauvegarde différée de 400 ms).
- **Événement backend** : `planner:roadmap-changed` (payload : chemin du fichier).

## Tableaux liés à un `roadmap.md`
Format reconnu (souvent produit par une IA pendant un projet) :

```markdown
# Roadmap
## Phase 1 — Fondations          → colonne
- [x] Initialiser le dépôt        → carte terminée
- [ ] Écrire le parseur @2026-10-01   → carte avec échéance
  - [ ] Sous-tâche                → checklist de la carte
```

- **Le fichier fait foi.** Cocher une carte réécrit uniquement la case `[ ]`/`[x]` (fins de ligne conservées, action auditée).
- **Mise à jour automatique** : le dossier du fichier est surveillé (`notify`) ; quand l'IA coche une tâche ou en ajoute, le tableau se resynchronise.
- Notes et étiquettes ajoutées dans ARCHIMED sont conservées d'une synchronisation à l'autre (clé = titre normalisé).
- Cartes et colonnes créées à la main coexistent avec celles du fichier.

## Agenda
- **« Ajouter à Google Agenda »** (carte avec échéance, ou date détectée dans le chat) : ouvre la page de création de Google Agenda pré-remplie. Aucune connexion requise.
- **Export `.ics`** d'un tableau : importable dans Google Agenda, Outlook, Apple Calendar.
- **Synchronisation automatique avec l'API Google Calendar : non implémentée.** Elle exige un identifiant OAuth créé par l'utilisateur dans Google Cloud Console (écran de consentement + client « application de bureau »), stocké dans le trousseau Windows. Étape suivante prévue.

## Intégrations (sans dépendance directe entre modules)
- **Slot `chat.message.actions`** (`slots/MessageActions.tsx`) : sous un message de l'IA contenant des cases à cocher, des `TODO :` ou des dates, propose « Ajouter N tâches au Planner » (tableau du projet suggéré d'après le dossier de la conversation) et « Ajouter à l'agenda ». Rien ne s'affiche sinon. Sur un tableau lié, les tâches sont ajoutées au `roadmap.md` dans une section « À trier ».
- **Slot `code.editor.footer`** (`slots/RoadmapFooter.tsx`) : dans le module Code, si le projet contient un `roadmap.md`, affiche l'avancement et propose « Suivre dans le Planner » / « Ouvrir le tableau ».
- **Entrée** : `openModule("planner", { boardId })`.
