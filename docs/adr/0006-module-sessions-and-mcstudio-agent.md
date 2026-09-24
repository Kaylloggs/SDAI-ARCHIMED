# ADR 0006 — Sessions d'agent ouvertes aux modules ; agent de Mod Studio sur copie de travail

- **Date** : 2026-09-24
- **Statut** : accepté (volets core et Mod Studio livrés)

## Contexte

Mod Studio doit faire coder des mods par les CLI installées (Claude, Antigravity, Codex), sans
protocole propre à chacune, avec trois exigences : l'IA connaît la version exacte de Minecraft,
du loader et ses règles d'API ; rien n'arrive dans le vrai projet sans relecture ; une erreur
se corrige par une vraie compilation, pas par supposition. Le moteur, lui, ne connaissait que
deux origines de conversation (`chat`, `code`) et aucune consigne par session, et le Mode Auto
« Smart » validait une écriture de fichier où qu'elle soit.

## Décision

### Core (moteur)

1. **Origine ouverte** : `SessionOrigin` accepte l'identifiant de n'importe quel module. Un
   module n'affiche que ses conversations ; l'accueil rouvre une conversation dans son module
   (`openModule(origine, { conversationId })`).
2. **`SessionOptions`** (`engine_start_session`, champ `options`, conservé par la conversation) :
   `appendSystemPrompt` et `disallowedTools`. Claude reçoit `--append-system-prompt` et
   `--disallowedTools` ; une CLI sans option équivalente, ou lancée par un script `.cmd` (Claude
   installé par npm : Windows ne transmet pas d'argument multiligne), reçoit les consignes en tête du premier
   message d'une nouvelle conversation (de chaque message pour une CLI sans mémoire). Les
   adaptateurs PTY déclaratifs ne les reçoivent pas.
3. **Politique sensible au dossier de travail** : une modification de fichier hors du `cwd` de la
   session (chemin absolu ailleurs, `..`, `~`) passe en risque élevé : jamais validée d'office en
   « Smart ». Comparaison lexicale, insensible à la casse et aux séparateurs.

### Mod Studio (phase G)

4. **Copie de travail** : l'agent travaille dans `<données>/modules/mcstudio/work/<projet>/`, une
   copie du projet sans builds ni caches, avec la date de chaque fichier au moment de la copie.
   C'est le `cwd` de sa session : il y lit, écrit et compile librement (Mode Auto au choix).
5. **Relecture** : après chaque réponse, Mod Studio compare la copie au projet et liste les
   fichiers créés, modifiés, supprimés, avec leur diff (`core/lib/diff`). La personne coche ce
   qu'elle garde. Un fichier modifié des deux côtés depuis la copie est signalé en conflit.
6. **Application** : point de restauration des fichiers concernés (ADR phase F), copie vers le
   projet, suppressions vers la Corbeille, vérification (`validator`), audit. Rejeter remet la
   copie à l'état du projet.
7. **Consignes par profil** : nom, Mod ID, package, Minecraft, loader et versions, mappings,
   Java, règles d'API du dialecte, format de données de la version, marqueurs des registres,
   prudence sur les scripts Gradle, réponse en français.
8. **Correction bornée** : après un build en échec, « Corriger avec l'IA » prépare un message
   avec les erreurs expliquées (fichier, ligne, cause) ; la personne l'envoie. Trois tours de
   suite au plus, puis Mod Studio demande d'intervenir.

## Conséquences

- **Positif** : fonctionne avec toutes les CLI, sans intégration propre ; le projet réel n'est
  jamais modifié sans relecture, et chaque application s'annule.
- **Positif** : la politique « Smart » devient plus sûre pour tous les modules (Chat, Code).
- **Négatif** : la copie de travail double l'espace disque du code source (pas des builds) ;
  la première compilation dans la copie retélécharge ce que Gradle n'a pas en cache global.
- **Négatif** : une CLI sans prompt système voit les consignes comme un message ; elles
  comptent dans son contexte.
- **Sécurité** : l'agent peut exécuter des commandes dans sa copie (Gradle compris) selon le
  Mode Auto choisi ; les motifs critiques restent toujours soumis à confirmation.
