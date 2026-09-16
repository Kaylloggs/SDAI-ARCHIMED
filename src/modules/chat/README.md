# Module `chat`

Messagerie multi-CLI : sélection de l'agent et du modèle, envoi de messages, rendu de la timeline (messages, outils, cartes de question), Mode Auto, terminal brut.

- **Backend** : core `engine_*` (pas de plugin dédié : le moteur est du core).
- **Slots exposés** : `chat.composer.actions`, `chat.header.right`, `chat.message.actions`.
- **Services consommés** : `voice.transcribe` et `code.project` (tous deux optionnels).
- **Fichiers clés** : `components/SessionList.tsx` (conversations), `components/ProjectBanner.tsx` (proposition d'ouvrir le module Code), `components/RawTerminalDrawer.tsx`.
- **UI partagée** : `@/core/chat` (`Composer`, `ConversationView`) et `@/core/engine/useChat` — également utilisés par le module `code`.
