# Module `voice`

Assistant vocal d'ARCHIMED : **écouter, comprendre, répondre à voix haute, se laisser interrompre, agir** dans les modules et confier les longues tâches aux agents. La couche vocale vit en arrière-plan (slot `app.background`) : elle continue quand on change de module.

```
Pastille (titlebar.center) ─┐
                            ├─ VoiceOrchestrator ── routeur local (commandes instantanées)
Raccourcis ─────────────────┘        │            └─ agent : CLI (Claude Code, Codex, Antigravity…) ou modèle local (Ollama)
                                     │                        └─ outils MCP d'ARCHIMED → actions des modules
                          STT (Windows, Whisper local, OpenAI, Groq, ElevenLabs, Voicebox, compatible)
                          TTS (système, Piper local, OpenAI, ElevenLabs, Voicebox, compatible)
```

## Interface
- **Pastille** (`components/VoicePill.tsx`) à côté de la recherche : micro (le **laiton veut dire « micro ouvert »**), vague (`VoiceWave`) pilotée par le niveau réel du micro ou de la voix, libellé d'état, bouton Arrêter pendant une réponse, point orange quand une confirmation attend. États : inactif, à l'écoute, vous parlez, transcription, réflexion, outil, réponse, pause, erreur.
- **Vague** : 5 barres, une seule boucle `requestAnimationFrame` active uniquement quand quelque chose bouge, transformations seules (aucune mise en page). Mouvement réduit (système ou réglage « Vague animée ») : forme fixe par état, le libellé nomme l'état.
- **Panneau** (clic sur la vague) : conversation en direct (transcription partielle, phrase en cours de lecture, outils utilisés), confirmation (Oui / Oui, toujours / Non, focus sur Non), tâches confiées (voir dans le Chat, arrêter), où passent les données (Local / En ligne par étape), contrôles.
- **Demandes de permission** : silencieuses par défaut (réglages révision 2, `SETTINGS_REVISION`, appliquée aussi aux réglages enregistrés avant) : son d'état, panneau ouvert sur la confirmation, barre des tâches signalée si la fenêtre est en arrière-plan (`announcePermission`, `confirm`) ; le réglage « Dire les demandes de permission » les lit à voix haute. Une question que le moteur valide lui-même (`prompt.auto`, Mode Auto) n'est ni lue ni annoncée.
- **Parole** : consignes de style oral (réponse d'abord, phrases courtes, sans formules toutes faites ni symboles ; recherche web directe pour la météo ou l'actualité, `lib/prompt.ts`) ; `speakable` dit les unités en toutes lettres selon la langue et change parenthèses et flèches en pauses.
- **Vue de conversation** (`components/VoiceStage.tsx`, `VoiceAura.tsx`, `VoiceLive.tsx`), inspirée de Gemini Live : plein écran sur la zone de contenu (bouton du panneau de la pastille, ou à chaque nouvelle session avec le réglage « Plein écran à chaque conversation »), et page Session du module : encadrée, ou sur toute la place du module quand la liste des sections est masquée (bouton en tête de la liste, préférence gardée). Lueur aux couleurs du thème qui suit la voix (laiton : micro ; information : assistant), phrase en cours en grand, boutons ronds, conversation écrite en panneau latéral, tâches en cours en haut.
- **Sous-titres** sous la pastille, panneau fermé (réglage Affichage).
- **Page du module** : Session en cours, Historique (relire, copier, reprendre, supprimer), puis six pages de réglages regroupés : **Général** (langue, ouverture du micro au clic ou en maintenant, conversation continue, annonces, demandes de permission, sons, raccourcis, pastille), **Micro et son**, **Moteurs** (reconnaissance, voix, voix personnelles, priorité des moteurs locaux), **Intelligence** (qui répond, agent et modèle, autonomie, serveur MCP), **Installations**, **Confidentialité** (données, protection, historique, permissions).
- **Installations en un clic** (`settings/InstallsSection.tsx`, `installer.rs`) : « Tout installer » (reconnaissance Whisper et voix Piper conseillées pour la machine et la langue, mises en service à la fin du téléchargement, même page quittée)  ; Ollama (winget) et son modèle conseillé ; Voicebox (dernière release GitHub, installeur lancé seulement si son SHA-256 correspond à celui publié) ; réglages de voix du système ; clés en ligne avec « Obtenir une clé ». Les mêmes boutons apparaissent là où l'option est choisie (Moteurs, Intelligence). Les agents (Claude Code, Codex, Antigravity) servent à toute l'application : ils s'installent et se connectent dans Réglages › Assistants IA (lien depuis Installations et Intelligence).

## Chaîne audio
- **Capture** (`audio/capture.ts`) : `getUserMedia` avec annulation d'écho et réduction du bruit, `AudioWorklet` (repli `ScriptProcessor`), trames de 20 ms, **VAD** par énergie (`lib/vad.ts`), 16 kHz mono → WAV base64 → Rust. Mode « maintenir » : découpe manuelle.
- **Windows** : reconnaissance WinRT existante (`engine_dictation_start`, événements `dictation:*`), hors ligne.
- **Whisper local** : `whisper-server` (whisper.cpp) lancé à la demande sur un port libre, priorité du processus réglable (`local.rs`).
- **Voix** : file par priorité (`lib/speech-queue.ts` : `critical` coupe la parole, `high` passe devant, `low` attend un moment calme), découpe en phrases pendant la réponse (`lib/chunker.ts`) et préchargement de la suivante, lecture par `AudioContext` (annulation d'écho du micro, sortie choisie par `setSinkId`). Voix système : `speechSynthesis`.
- **Interruption** : si la personne parle pendant une réponse, l'assistant se tait (garde anti-écho relevée pour les voix système, non filtrées par l'annulation d'écho).
- **Secours** : moteur de secours pour la reconnaissance et la voix ; un secours en ligne n'est utilisé que si Confidentialité › Secours en ligne l'autorise.

## Intelligence
- **Routeur local** (`lib/router.ts`, FR/EN) : stop, attends, continue, annule, répète, plus lentement/vite, plus fort/moins fort, ouvre <module>, utilise <agent>, modèle local, mode local, « qu'est-ce que tu fais ? », heure, fin de session. Instantané, sans modèle.
- **Agent CLI** : une conversation du moteur par session (origine `voice`, invisible dans le Chat), prompt système vocal (`lib/prompt.ts`), préambule de contexte à chaque phrase (module affiché, projet, fichier, sélection). La réponse est dite phrase par phrase pendant qu'elle s'écrit. **Mêmes permissions qu'au clavier** : les questions de l'agent sont posées à voix haute.
- **Modèle local** (Ollama `/api/chat` en flux) : répond aux questions simples ; pour une action il répond `DELEGUER: <consigne>` et la voix transmet à l'agent.
- **Tâches longues** : `start_task` crée une conversation du module Chat suivie ici ; annonces de progression (réglage), fin annoncée (`engine.turn.completed`), permission en attente signalée.
- **Mémoire** : la conversation de l'agent est supprimée à la fin de la session ; l'historique vocal reste (fichiers `sessions/<id>.json`), séparé de la mémoire des autres modules.

## Serveur MCP d'ARCHIMED
Serveur HTTP local (`mcp.rs`, 127.0.0.1, port libre, jeton de 64 caractères, origines web refusées). Déclaré dans `<données>/mcp/voice.json` : le moteur le passe aux CLI (`--mcp-config`). Désactivable (Serveur MCP › Donner les outils aux agents : la déclaration est supprimée).

| Outil | Rôle |
|---|---|
| `speak`, `notify` | Dire une phrase (priorité) ; `notify` attend un moment calme |
| `get_voice_state`, `get_context` | État de la voix ; module affiché, projet, fichier, sélection |
| `list_modules`, `open_module` | Modules actifs, leurs capacités et actions ; afficher un module |
| `run_action` | Action d'un module (`agent-actions.ts`) ; `destructive` → confirmation (voix ou boutons), sauf avec l'autonomie « Tout accepter » |
| `start_task`, `task_status` | Confier un travail à un agent en arrière-plan ; suivre |

Les outils en lecture seule sont dans `READ_ONLY_TOOLS` (`engine/policy.rs`) ; les autres passent par la politique de permission habituelle. L'autonomie choisie (Intelligence › Autonomie) s'applique tout de suite à la conversation vocale et aux tâches en cours (`applyAutonomy`) ; même avec « Tout accepter », une commande critique pour le système (formatage, clés privées) reste demandée par le moteur.

Le prompt de l'agent vocal lui demande de passer par les actions d'un module quand la demande lui correspond (un mod Minecraft : `mcstudio.create_project`, `add_item`, `add_block`, `add_recipe`, `build_project`) avant d'écrire du code à la main.

## Modèles locaux
Catalogue (`catalog.rs`) : Whisper tiny/base/small/large-v3-turbo (Hugging Face `ggerganov/whisper.cpp`), voix Piper FR/EN (`rhasspy/piper-voices`), Qwen 2.5 1,5B/3B/7B (Ollama), outils `whisper-server` et `piper` (GitHub, empreintes SHA-256 figées). Matériel détecté (processeur, mémoire, cartes graphiques et VRAM, système) → Recommandé / Optionnel / Déconseillé / Indisponible. Télécharger, pause, reprise (Range), vérification d'intégrité (SHA-256 LFS publiée par Hugging Face), test réel, activation, suppression. Dossier : `<données>/models/{stt,tts,llm,runtime}`.

## Backend
- **Plugin** `voice` (`src-tauri/src/modules/voice/`), commandes préfixées `voice_` (hardware_info, list_models, download_model, pause_model, delete_model, verify_model, prepare_stt, transcribe, synthesize, list_voices, providers, set_provider_key, clear_provider_key, ollama_status, voicebox_status, local_chat, cancel_local_chat, mcp_info, mcp_respond, bridge_ready, stop_engines, get_settings, save_settings, list_sessions, get_session, save_session, delete_session, tools, install_tool, launch_tool, open_system_speech). Installation et connexion des CLI d'agents : moteur (`engine_install_cli`, `engine_open_cli_terminal`).
- **Clés** : coffre du système (`voice-openai`, `voice-groq`, `voice-elevenlabs`, `voice-custom`), jamais dans un fichier.
- **Événements** : `voice:model` (téléchargements), `voice:install` (installation d'un outil), `voice:mcp-call` (outil demandé par un agent).
- **Micro sous Windows** : l'autorisation WebView2 est accordée aux seules origines de l'application.

## Intégrations
- **Service `voice.speak`** : `speak(text, priority, source)` depuis n'importe quel module (ou `bus.emit("voice.speak", …)`).
- **Événements du bus** : `voice.started/stopped/transcript/response/speaking/interrupted`, `voice.task.started/completed/failed`.
- **Actions** (`agent-actions.ts`) : `open_settings`, `enable_local_mode`.

## Limites connues
- Voicebox : utilisé comme serveur (reconnaissance, profils de voix, synthèse) ; ARCHIMED ne crée pas de clone de voix. Ne clonez que votre voix ou celle d'une personne consentante.
- macOS : pas de binaire `whisper-server` publié ; Whisper local y demande `brew install whisper-cpp`.
- Les voix système suivent la sortie audio par défaut de l'ordinateur.
