# ADR 0016 — Assistant vocal (module Voice)

- **Date** : 2026-09-27
- **Statut** : accepté

## Contexte

La personne veut piloter ARCHIMED à la voix : écouter, comprendre, répondre à voix haute, se
laisser interrompre, agir dans les modules, confier de longues tâches aux CLI installées (Claude
Code, Codex, Antigravity), sans dépendre d'un fournisseur, avec un mode entièrement local et une
pastille d'état à côté de la recherche. Contraintes : aucune capacité simulée, aucune permission
supplémentaire pour la voix, aucune authentification de CLI contournée, clonage de voix seulement
avec consentement.

## Décision

1. **Un module, une couche permanente.** `src/modules/voice/` + plugin `voice`. La couche vocale
   est montée dans le slot `app.background` (elle survit aux changements de module) ; la pastille
   vit dans un nouveau slot `titlebar.center`. Un seul orchestrateur (`VoiceOrchestrator`) :
   capture → reconnaissance → routeur local ou agent → file de parole → voix.
2. **Moteurs interchangeables.** Reconnaissance : Windows (WinRT existant), Whisper local
   (`whisper-server` de whisper.cpp, processus à part, priorité réglable), OpenAI, Groq,
   ElevenLabs, Voicebox, serveur compatible OpenAI. Voix : système (`speechSynthesis`), Piper
   local (processus persistant `--json-input`), OpenAI, ElevenLabs, Voicebox, serveur compatible.
   Chaque moteur déclare où il tourne ; l'interface l'affiche étape par étape (Local / En ligne).
   Le mode local remplace les moteurs en ligne sans toucher aux réglages enregistrés ; un secours
   en ligne n'est utilisé que si la personne l'autorise.
3. **Audio dans la page.** `getUserMedia` (annulation d'écho, réduction du bruit) + `AudioWorklet`
   et VAD par énergie ; la voix est jouée par `AudioContext` pour profiter de l'annulation d'écho
   et interrompre l'assistant quand la personne parle (garde relevée pour les voix système). Sous
   Windows, l'accès au micro de WebView2 est accordé aux seules origines de l'application.
4. **Intelligence.** Routeur local FR/EN pour les commandes (stop, pause, répète, ouvre…,
   « qu'est-ce que tu fais ? »). Le reste part vers une conversation du moteur des agents (origine
   `voice`, invisible dans le Chat, supprimée en fin de session) avec un prompt système vocal et un
   préambule de contexte, ou vers un modèle local Ollama qui délègue (`DELEGUER: …`) ce qu'il ne
   sait pas faire. La réponse est dite phrase par phrase pendant qu'elle s'écrit.
5. **Actions des modules et contexte.** Nouveau contrat core : chaque module peut déclarer
   `capabilities` et `actions` (`agent-actions.ts`, chargé à la demande : nom, description,
   paramètres typés, risque `read` / `write` / `destructive`). Les modules publient ce que la
   personne regarde (`useModuleContext` : projet, fichier, sélection, image, objet). Le core ne
   connaît aucun module : il découvre les actions par les manifestes.
6. **Serveur MCP d'ARCHIMED.** HTTP sur 127.0.0.1, port libre, jeton aléatoire, origines web
   refusées ; déclaré dans `<données>/mcp/voice.json`, que le moteur passe aux CLI. Outils :
   `speak`, `notify`, `get_voice_state`, `get_context`, `list_modules`, `open_module`,
   `run_action`, `start_task`, `task_status`. L'appel est exécuté par l'interface (qui connaît
   modules et contexte) ; une action `destructive` attend une confirmation (voix ou bouton). Les
   outils en lecture seule sont ajoutés à `READ_ONLY_TOOLS` ; les autres suivent la politique de
   permission habituelle.
7. **Modèles locaux.** Catalogue figé (Whisper, voix Piper, Qwen via Ollama, outils whisper.cpp
   et Piper) avec détection du matériel (processeur, mémoire, cartes graphiques et VRAM) et une
   convenance par modèle. Téléchargement en tâche de fond, pause et reprise (Range), empreintes
   SHA-256 (figées pour les binaires GitHub, publiées par Hugging Face pour les modèles),
   vérification, test réel, activation, suppression. Dossier `<données>/models/`.
8. **Voicebox** est utilisé comme serveur (profils, synthèse, reconnaissance), sans reprise de
   son code ; ARCHIMED ne crée pas de clone de voix et le rappelle dans les réglages.

9. **Installations en un clic** (ajout du 2026-09-27). Tout ce que la voix propose s'installe
   depuis ses réglages, par la voie officielle et vérifiable : `winget` (Ollama, Node.js), le
   script d'Anthropic (Claude Code), `npm` (Codex), la dernière release GitHub de Voicebox
   (installeur lancé seulement si son SHA-256 correspond à celui publié par GitHub), les modèles
   du catalogue (§7). Antigravity n'a pas d'installation scriptable connue : bouton vers sa page.
   La connexion aux agents se fait dans un terminal ouvert sur leur CLI : ARCHIMED ne voit ni ne
   stocke leurs identifiants. Les réglages sont regroupés en six pages.

10. **Révision du 2026-09-28.** Les CLI d'agents servent à toute l'application : leur
    installation et leur connexion quittent Voice pour le moteur (`engine_install_cli`,
    `engine_open_cli_terminal`, outils partagés dans `core/install.rs`) et les Réglages
    (« Assistants IA ») ; Voice n'installe plus qu'Ollama, Voicebox et les modèles locaux. Le mode
    « mot d'éveil » est retiré (ouverture au clic ou en maintenant ; un ancien réglage revient au
    clic). L'autonomie choisie s'applique tout de suite aux conversations ouvertes, et « Tout
    accepter » lève aussi la confirmation des actions `destructive` des modules ; les motifs
    critiques du moteur restent demandés.

## Conséquences

- La voix a exactement les droits d'un message écrit : même moteur, mêmes permissions, mêmes
  confirmations ; les questions de l'agent sont posées à voix haute. Avec « Tout accepter », la
  personne choisit de ne plus être interrogée, sauf pour les motifs critiques du moteur.
- Un module sans `agent-actions.ts` reste accessible (ouverture, contexte), sans actions.
- Le jeton MCP change à chaque démarrage ; la déclaration peut être retirée (réglage « Donner
  les outils aux agents »).
- macOS : pas de binaire `whisper-server` publié, Whisper local y demande whisper.cpp installé
  à part ; les voix système suivent la sortie audio par défaut.
- Un appel d'outil MCP expire après 180 s : les travaux longs (compilation) rendent la main tout
  de suite et annoncent leur résultat par `voice.speak`.
