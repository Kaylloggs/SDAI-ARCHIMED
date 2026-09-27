# ADR 0015 — Chat au niveau de Claude Code

- **Date** : 2026-09-27
- **Statut** : accepté

## Contexte

La personne veut que le module Chat soit aussi complet que Claude Code sur le web (hors mode
cloud) : réponse qui s'écrit en direct, réflexion visible, mode plan, questions à choix, liste de
tâches, commandes `/`, mentions de fichiers `@`, messages en file, jauge de contexte, suivi des
modifications git, export de la conversation.

## Décision

1. **Moteur (Claude)** : `--include-partial-messages` (événements `stream_event` :
   `text_delta`, `thinking_delta`) → `MessageDelta` / `ThinkingDelta` ; sous-agents
   (`parent_tool_use_id`) non diffusés mot à mot. `system/init` → `SessionInfo`
   (`slash_commands`, mode) ; `result.modelUsage.<modèle>.contextWindow` et l'usage du dernier
   appel → `ContextUsage`. Mode plan : `--permission-mode plan` (`SessionOptions.plan_mode`).
   `ExitPlanMode` et `AskUserQuestion` arrivent par `can_use_tool` et deviennent des cartes
   dédiées (`PromptDetail::Plan`, `PromptDetail::Questions`) que le Mode Auto ne tranche jamais ;
   les réponses repartent en `updatedInput` (`{questions, answers}`). Un retour sur le plan est
   un refus avec message (l'agent reste en mode plan).
2. **Dossier de travail** (`core/workspace.rs`, lecture seule) : `git status --porcelain=v1
   --branch -z` + `git diff HEAD --numstat` (branche, avance/retard, fichiers et lignes),
   `git show HEAD:<fichier>` pour le diff d'un fichier (1 Mo au plus, chemins relatifs sans `..`),
   liste des fichiers du projet pour `@` (dépendances et builds exclus, 20 000 au plus, gardée
   20 s). Aucune commande qui écrit : commit et pull request sont demandés à l'agent, qui passe
   par les permissions habituelles.
3. **Interface** (core, partagée avec le module Code) : `ThinkingBlock`, `TodoPanel` (dernier
   `TodoWrite`), `QuestionsForm`, plan rendu en Markdown, cartes d'outils par type (diff, terminal,
   lecture, recherche, web, sous-agent), `SuggestionMenu` pour `/` (commandes d'ARCHIMED + celles
   annoncées par la CLI) et `@` (le fichier est aussi joint), file d'attente
   (`useMessageQueue` : envoi à la fin du tour, rendue à la zone de saisie si on arrête l'agent),
   Maj+Tab pour le mode plan, ↑ pour reprendre le dernier message.
4. **Module Chat** : liste des conversations (recherche, groupes par date, renommage, état),
   jauge de contexte (`/compact` proposé au-delà de 60 %), panneau Modifications (branche, fichiers,
   diffs ; « Relire », « Commit », « Pull request » envoyés à l'agent), copie en Markdown,
   barre des tâches qui clignote quand un tour se termine ou qu'une question attend et
   qu'ARCHIMED est en arrière-plan (`core:window:allow-request-user-attention`), panneaux
   redimensionnables.

## Conséquences

- Les CLI sans ces signaux (Antigravity, Codex) gardent le fonctionnement actuel ; le mode plan
  n'est proposé qu'avec Claude Code.
- `slash_commands`, `permissionMode` et `contextWindow` dépendent du format de Claude Code :
  s'ils disparaissent, les menus et la jauge se masquent simplement (décodage tolérant, §7.3).
- Git doit être installé pour le panneau Modifications ; sinon il se masque.
