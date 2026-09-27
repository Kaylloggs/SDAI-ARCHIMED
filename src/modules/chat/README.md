# Module `chat`

Messagerie multi-CLI au niveau de Claude Code (ADR 0015) : agent et modèle, réponse en direct et réflexion, mode plan, questions à choix, liste de tâches, commandes `/`, mentions `@`, file d'attente, jauge de contexte, panneau Modifications (git), copie Markdown, Mode Auto, terminal brut.

- **Backend** : core `engine_*` et `workspace_*` (pas de plugin dédié : moteur et dossier de travail sont du core).
- **Slots exposés** : `chat.composer.actions`, `chat.header.right`, `chat.message.actions`.
- **Services consommés** : `voice.transcribe` et `code.project` (tous deux optionnels).
- **Fichiers clés** : `components/SessionList.tsx` (conversations : recherche, groupes par date, renommage, état), `components/HeaderTools.tsx` (jauge de contexte, branche git, copie), `components/ChangesPanel.tsx` (modifications git et diffs), `components/ProjectBanner.tsx` (proposition d'ouvrir le module Code), `components/RawTerminalDrawer.tsx`, `lib/useGitStatus.ts`, `lib/sessions.ts`, `lib/changes.ts`.
- **Panneaux redimensionnables** : liste (`chat.sessions`), aperçu (`chat.preview`), modifications (`chat.changes`), terminal brut (`chat.raw`).
- **UI partagée** : `@/core/chat` (`Composer`, `ConversationView`, `TodoPanel`) et `@/core/engine/useChat`, `useMessageQueue`, `useAttention` — également utilisés par le module `code`.
