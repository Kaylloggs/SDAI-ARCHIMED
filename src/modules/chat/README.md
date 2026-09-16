# Module `chat`

Messagerie multi-CLI : sélection de l'agent et du modèle, envoi de messages, rendu de la timeline (messages, outils, cartes de question), Mode Auto, terminal brut.

- **Backend** : core `engine_*` (pas de plugin dédié : le moteur est du core).
- **Slots exposés** : `chat.composer.actions`, `chat.header.right`, `chat.message.actions`.
- **Services consommés** : `voice.transcribe` (optionnel).
- **Fichiers clés** : `components/Composer.tsx` (saisie + pickers), `components/Timeline.tsx` (rendu des items), `hooks/useChatSession.ts` (cycle de vie de session).
