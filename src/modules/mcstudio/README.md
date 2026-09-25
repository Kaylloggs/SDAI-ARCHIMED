# Module `mcstudio` — Minecraft Mod Studio

Crée, compile et exporte de **vrais** mods Minecraft (Fabric, Forge, NeoForge). Chaque projet est
un dossier Gradle autonome : il se compile aussi sans ARCHIMED (`gradlew build`).

- **Backend** : plugin `mcstudio` (`src-tauri/src/modules/mcstudio/`).
- **Services / slots / événements** : aucun pour l'instant. Le flux de compilation passe par un
  `Channel<BuildEvent>` propre à chaque build.
- **Dépendances ajoutées** : `reqwest` (HTTPS), `png` (textures), `trash` (Corbeille, exigée par
  guidelines §11), `zip`, `tar`, `flate2`, `sha2` (installation vérifiée des JDK), `image`,
  `base64` (images reçues d'OpenRouter et de Gemini), `keyring` (clés API dans le Gestionnaire
  d'identifiants).

## État des phases

| Phase | Contenu | État |
|---|---|---|
| A | Squelette, types ts-rs, registre des projets | ✓ |
| B | Profils de version, métadonnées officielles, templates, JDK, création | ✓ |
| C | Build Gradle réel, diagnostics, jar dans `dist/`, test e2e | ✓ (Fabric 1.21.1 compilé sur Windows) |
| B+ | 1.14 → 1.21.x, choix des versions du loader, installation des JDK | ✓ (profils hors `fabric-1.21` à valider par l'e2e) |
| T | Textures par IA (OpenRouter ou Google Gemini, clé de la personne), import d'image, conversion pixel-art, ajout d'objets et de blocs | ✓ (testé contre de faux OpenRouter et Gemini locaux) |
| D | Explorateur et éditeur (`CodeEditor`/`FileTree` déplacés dans `core/editor`) | ✓ |
| E | Validateur (JSON/TOML ligne/colonne, références, format de la version) et panneau Problèmes | ✓ |
| F | Points de restauration (annulables), vrai diff dans `core/lib/diff` | ✓ |
| G | Assistant IA via les CLI installées : copie de travail, relecture fichier par fichier, application avec point de restauration, correction bornée | ✓ (à essayer avec vos CLI) |
| J | Test en jeu (`runClient`), plantages expliqués | ✓ (à essayer sur Windows) |
| 3D | Atelier 3D : modèles de blocs, d'objets, d'entités (code Java généré) et armures, peinture sur le modèle | ✓ |
| K | Serveur de test (`runServer`), CLUF de Minecraft accepté par la personne | ✓ (à essayer sur Windows) |
| L | Import d'un projet Fabric, Forge ou NeoForge existant | ✓ |
| M | Portage vers une autre version de Minecraft, export des sources en ZIP | ✓ (code Java adapté par l'assistant IA) |

Rien n'est simulé : un bouton qui n'a pas encore de moteur n'est pas affiché.

## Versions prises en charge

Un **profil** par époque d'API (`src-tauri/src/modules/mcstudio/profiles/defaults/*.toml`) : Java,
Gradle, plugin, mappings, template, dialecte de code et format de données. **1.14 → 1.21.11 puis
26.1 et suivantes** pour Fabric, **1.14.4 → 1.21.5** pour Forge, **1.20.4 → 1.21.11 puis 26.1 et
suivantes** pour NeoForge.

| Loader | Profil | Minecraft | JDK (build) | Bytecode | Gradle · plugin | Particularités |
|---|---|---|---|---|---|---|
| Fabric | `fabric-1.14` | 1.14 – 1.16.5 | 17+ | 8 | 8.14.3 · Loom 1.10 | `Registry.ITEM`, onglet dans les réglages |
| Fabric | `fabric-1.17` | 1.17 – 1.17.1 | 17+ | 16 | idem | idem |
| Fabric | `fabric-1.18` | 1.18 – 1.19.2 | 17+ | 17 | idem | idem |
| Fabric | `fabric-1.19.3` | 1.19.3 – 1.19.4 | 17+ | 17 | idem | `Registries`, onglets par événement |
| Fabric | `fabric-1.20` | 1.20 – 1.20.4 | 17+ | 17 | idem | `Settings.create()` |
| Fabric | `fabric-1.20.5` | 1.20.5 – 1.20.6 | 21+ | 21 | idem | recettes `{"id": …}` |
| Fabric | `fabric-1.21` ✓ | 1.21 – 1.21.1 | 21+ | 21 | idem | `Identifier.of`, dossiers au singulier |
| Fabric | `fabric-1.21.2` | 1.21.2 – 1.21.3 | 21+ | 21 | idem | clés de registre, ingrédients en texte |
| Fabric | `fabric-1.21.4` | 1.21.4 – 1.21.11 | 21+ | 21 | idem | + `assets/<modid>/items/` |
| Fabric | `fabric-26` | 26.1 – 26.x | 25+ | 25 | 9.5.1 · Loom 1.17 (`net.fabricmc.fabric-loom`) | jeu non obfusqué : noms Mojang, plus de Yarn, `implementation` |
| Forge | `forge-1.14` | 1.14.4 – 1.16.5 | **8** | 8 | 7.6.4 · FG 5.1 | noms MCP, `Material`, onglet dans les propriétés |
| Forge | `forge-1.17` | 1.17.1 | **17** | 16 | 7.6.4 · FG 5.1 | noms Mojang, `fmllegacy.RegistryObject` |
| Forge | `forge-1.18` | 1.18 – 1.19.2 | **17** | 17 | 7.6.4 · FG 5.1 | noms Mojang |
| Forge | `forge-1.19.3` | 1.19.3 – 1.19.4 | **17** | 17 | 7.6.4 · FG 5.1 | `CreativeModeTabEvent` |
| Forge | `forge-1.20` | 1.20.1 – 1.20.4 | **17** | 17 | 8.8 · FG 6 | `BuildCreativeModeTabContentsEvent` |
| Forge | `forge-1.20.6` | 1.20.6 | 21+ | 21 | 8.8 · FG 6 | recettes `{"id": …}` |
| Forge | `forge-1.21` | 1.21 – 1.21.1 | 21+ | 21 | 8.8 · FG 6 | dossiers au singulier |
| Forge | `forge-1.21.3` | 1.21.3 | 21+ | 21 | 8.8 · FG 6 | `setId`, contexte injecté |
| Forge | `forge-1.21.4` | 1.21.4 – 1.21.5 | 21+ | 21 | 8.8 · FG 6 | + `assets/<modid>/items/` |
| NeoForge | `neoforge-1.20.4` | 1.20.4 | 17+ | 17 | 8.14.3 · MDG 2.0 | `mods.toml` |
| NeoForge | `neoforge-1.20.6` | 1.20.5 – 1.20.6 | 21+ | 21 | idem | `neoforge.mods.toml` |
| NeoForge | `neoforge-1.21` | 1.21 – 1.21.1 | 21+ | 21 | idem | |
| NeoForge | `neoforge-1.21.2` | 1.21.2 – 1.21.3 | 21+ | 21 | idem | `setId` |
| NeoForge | `neoforge-1.21.4` | 1.21.4 – 1.21.11 | 21+ | 21 | idem | + `assets/<modid>/items/` |
| NeoForge | `neoforge-26` | 26.1 – 26.x | 25+ | 25 | 9.2.1 · MDG 2.0.147 | version `26.1.0.x` = Minecraft 26.1, sans Parchment |

**JDK en gras** : version exacte (les JVM plus récentes cassent Forge). ✓ = validé par une vraie
compilation ; les autres sont marqués « Non vérifié » dans l'assistant jusqu'à leur premier build
réussi (`verified = true` dans le profil). `profiles_cover_every_release_once` garantit qu'aucune
version n'est couverte deux fois et que Fabric les couvre toutes.

**26.1 et suivantes** (numérotation par année, 2026) : relevé sur les dépôts officiels
(`FabricMC/fabric-example-mod` 26.3, `fabric-docs` 26.1.2 et 26.2, `NeoForgeMDKs/MDK-26.1` et
`MDK-26.3-ModDevGradle`). Minecraft est livré sans obfuscation : Fabric abandonne Yarn (dialecte
`fabric-mojang-26` : `Item.Properties`, `ResourceKey`, `BuiltInRegistries`,
`Identifier.fromNamespaceAndPath`, `CreativeModeTabEvents`), NeoForge garde son API 1.21.2+. Les
profils couvrent toute l'année 26 ; non vérifiés tant qu'un vrai build n'a pas réussi. Le portage
d'un mod Fabric 1.21.x vers 26.x retire Yarn du build et liste les renommages pour l'assistant.

**Pas encore pris en charge**, avec la raison affichée dans l'assistant : avant 1.14 (ForgeGradle 1
à 3, Gradle 2 à 4, formats de données différents), Forge 1.21.6+ (EventBus 7), les premières
versions de NeoForge (1.20.2 – 1.20.3), Forge 26.x (EventBus 7 aussi) et les snapshots.

- **Choix des versions** : l'assistant (étape Loader) et le tableau de bord (« Changer les
  versions ») listent toutes les versions publiées du loader, de Fabric API (Modrinth, repli sur
  Maven) et de Yarn (jusqu'à 1.21.x), la recommandée par défaut. Changer de version réécrit `gradle.properties`,
  `fabric.mod.json` et `project.json` ; changer de Minecraft est un portage, pas encore géré.
- **Hors ligne** : chaque réponse de métadonnées est gardée dans `cache/meta/`.
- **Corriger un profil sans recompiler** : déposer un `.toml` de même `id` dans
  `%APPDATA%\com.sdai.archimed\modules\mcstudio\profiles\`.
- **Ajouter une époque** : un `Dialect` (snippets Java de `content.rs`), un template dans
  `templates/files/`, un profil ; `every_profile_creates_a_complete_project` le vérifie.

## Java manquant : installation depuis l'app

Le panneau **Environnement** (liste des projets), l'étape Java de l'assistant, le tableau de bord
et la console de build proposent d'installer le JDK qui manque :

1. l'offre est lue sur l'API d'Adoptium (Eclipse Temurin) et **affichée avant tout
   téléchargement** : source, version, fichier, taille, dossier ;
2. après confirmation, le backend relit l'offre auprès de la source (une adresse reçue par IPC
   n'est jamais téléchargée telle quelle), puis l'archive est téléchargée (progression,
   annulable), son **SHA-256** comparé
   à celui publié par Adoptium, puis décompressée (chemins sortants refusés) dans
   `%APPDATA%\com.sdai.archimed\modules\mcstudio\jdks\` ;
3. aucune élévation, aucune variable d'environnement modifiée ; la détection inclut ce dossier.
   Chaque installation est inscrite au journal d'audit (`mcstudio.jdk_install`).

Source remplaçable (HTTPS uniquement) : `{"adoptiumApi": "https://…"}` dans
`%APPDATA%\com.sdai.archimed\modules\mcstudio\env.json`. Gradle, Minecraft et les loaders
n'ont rien à installer : le wrapper et les plugins les téléchargent à la première compilation.
Décision détaillée : [ADR 0004](../../../docs/adr/0004-mcstudio-jdk-downloads.md).

## Assistant IA (vos CLI)

Onglet **Assistant IA** : une conversation avec une CLI installée sur la machine (Claude Code,
Antigravity, Codex… celles que détecte le moteur d'ARCHIMED), avec le même composeur que le Chat
(agent, modèle, Mode Auto, pièces jointes, dictée). ADR 0006.

1. **Copie de travail** : l'IA travaille dans `%APPDATA%\com.sdai.archimed\modules\mcstudio\work\<projet>\`,
   une copie du projet sans builds ni caches, qui est le dossier de travail de sa conversation.
   Elle peut y lire, écrire et compiler (`gradlew build`) ; le Mode Auto « Smart » la laisse
   écrire dans sa copie et demande pour le reste (écriture ailleurs comprise). Avant chaque
   message, les fichiers modifiés entre-temps dans le projet (éditeur, textures) rejoignent la
   copie, sans toucher à ceux que l'IA a changés.
2. **Consignes** : chaque nouvelle conversation reçoit les consignes du projet (prompt système
   pour Claude, tête du premier message sinon) : Mod ID, package, Minecraft, loader et versions
   exactes, mappings, Java, **exemples de code exacts de la version** (produits par les mêmes
   générateurs que les boutons « Nouvel objet / bloc »), dossiers et format des recettes de la
   version, marqueurs des registres, prudence sur les scripts Gradle, réponse en français.
3. **Relecture** : après chaque réponse, le panneau **Modifications proposées** liste les
   fichiers créés, modifiés et supprimés, avec leur diff (numéroté, par blocs). Tout est coché
   sauf les **conflits** (fichier aussi modifié dans le projet depuis la copie). Appliquer crée un
   point de restauration puis copie les fichiers ; les suppressions vont à la Corbeille ; le
   projet est revérifié. Rejeter remet la copie à l'état du projet ; « Nouvelle copie » repart de
   zéro.
4. **Correction bornée** : après un build en échec, « Corriger avec l'IA (1/3) » prépare dans le
   composeur un message avec les erreurs expliquées (fichier, ligne, cause, piste), à relire
   puis envoyer. Trois fois d'affilée au plus ; un build réussi remet le compteur à zéro.

Les conversations de Mod Studio n'apparaissent pas dans le Chat ; l'accueil les rouvre ici.

## Fichiers : explorateur et éditeur

Onglet **Fichiers** : l'arborescence du projet (dossiers de build, `.gradle`, `.mcstudio` en
retrait) et un éditeur à onglets (CodeMirror partagé, `@/core/editor` : Java, JSON, TOML,
Gradle/Groovy, `.properties`…). Clic droit : nouveau fichier ou dossier, renommer, mettre à la
Corbeille. Une image s'affiche pixel pour pixel.

- **Brouillons** gardés par projet quand on change d'onglet ; point sur l'onglet « Fichiers »
  tant que quelque chose n'est pas enregistré ; fermer un onglet modifié demande quoi faire.
- **Conflits** : l'enregistrement envoie la date lue à l'ouverture ; si le fichier a changé sur
  le disque entre-temps (génération, IA, autre éditeur), rien n'est écrasé : « Recharger » ou
  « Écraser », au choix.
- **Confinement** : chemins relatifs au projet, `..`, chemins absolus, `C:` et liens symboliques
  sortants refusés côté Rust ; `.mcstudio/` et `.git/` se lisent mais ne s'écrivent pas d'ici.
  Écritures, créations, renommages et mises à la Corbeille sont audités (`mcstudio.file_*`).
- **Scripts de build** (`build.gradle`, `settings.gradle`, `gradle.properties`, `gradlew*`,
  `gradle/`) : bandeau d'avertissement, Gradle les exécute à chaque compilation.

## Vérification sans compiler

`validator.rs` lit le projet et signale ce que Gradle laisse passer mais que le jeu refuse ou
ignore au chargement ; résultat dans le panneau **Problèmes** (onglet Fichiers, un clic ouvre le
fichier à la ligne, lignes surlignées dans l'éditeur) et sur le tableau de bord.

- JSON et TOML illisibles : ligne, colonne, explication (virgule en trop, accolade non fermée…) ;
- PNG illisibles, textures qui ne sont pas des carrés de 16, 32, 64… px (sauf animées) ;
- dossiers de données de la mauvaise époque (`recipes/` en 1.21+, `recipe/` avant) ;
- recettes au format d'une autre version (ingrédients en objet ou en texte, résultats
  `{"item"}` / `{"id"}`, résultat de cuisson) ;
- références du mod : textures des modèles, modèles parents, modèles des états de bloc et des
  définitions d'objet, définition `items/` manquante en 1.21.4+, nom affiché manquant.

Les 23 profils génèrent des projets qui passent cette vérification sans aucun problème (test).

## Points de restauration

Tableau de bord → **Points de restauration** : copie de tous les fichiers du projet (hors
builds, caches, `.git`), à la main ; Mod Studio en prend un automatiquement avant d'appliquer
des modifications proposées par une IA (seulement les fichiers touchés). **Restaurer** remet
ces fichiers dans leur état d'alors ; ceux qui n'existaient pas partent à la Corbeille. L'état
courant est d'abord sauvegardé : une restauration s'annule en restaurant ce nouveau point.
Supprimer un point le met à la Corbeille. Stockage : `<projet>/.mcstudio/snapshots/<id>/`
(`manifest.json` + copies), restaurations auditées.

## Textures : IA (OpenRouter ou Google Gemini) ou image importée

Onglet **Textures** d'un projet : l'icône, les objets, les blocs (et leurs faces), les éléments
d'interface, puis **toutes les autres textures du mod**, classées par famille : superpositions
(lunettes, casque, longue-vue…), entités, armures, particules, effets, tableaux, autres. Une
texture y figure dès qu'elle est présente sous `textures/` (sous-dossiers compris) ou citée par
le mod, même si le fichier n'existe pas encore (« Texture manquante », avec le fichier qui la
cite) : code Java/Kotlin (`id("textures/misc/x.png")`, `Identifier.of(MOD_ID, "textures/…")`,
`"<modid>:textures/…"`), modèles, particules (`particles/*.json`), équipements 1.21.2+
(`equipment/*.json`), tableaux (`painting_variant/`) et tout JSON qui nomme un PNG du mod
(`texture_refs.rs`). Une texture du jeu (`minecraft:`, `Identifier.ofVanilla(…)`) n'est jamais
prise pour une texture du mod. Une texture libre garde la taille de son fichier (512 px de côté
au plus), sinon celle de sa famille dans le jeu (superposition 256 × 256, entité 64 × 64, armure
64 × 32, particule 8 × 8, effet 18 × 18), et le texte envoyé au modèle suit sa famille. « + » ajoute un objet ou un bloc (code, modèles,
traductions, loot table, outil de minage) avec une texture provisoire, ou un élément d'interface
(écran de conteneur avec ou sans inventaire du joueur, bouton, case, flèche de progression, toile
libre) dessiné sans IA aux couleurs des écrans du jeu, dans `textures/gui/`.

1. **Source** : une description envoyée à un modèle d'image d'OpenRouter ou de Google Gemini
   (« Service d'image »), un PNG/JPEG/WebP, ou la texture actuelle (« Retoucher l'actuelle »).
   Le texte envoyé est construit pour la cible (objet isolé sur fond uni ; face de bloc vue de
   face, pleine case, sans cadre, raccordable ; côté d'un bloc à dessus distinct raccordable en
   largeur ; extrémité de bûche en coupe ; écran d'interface au format demandé), avec un **style**
   (jeu de base, détaillé, simple), des **consignes en plus** et, si le modèle lit les images, une
   **texture de référence** du projet (agrandie pixel par pixel à 512 px) pour garder la palette
   d'un bloc d'une face à l'autre ou demander une variante. Le texte final est visible et
   **modifiable mot pour mot** avant l'envoi (il part alors tel quel).
2. **Clé** : saisie dans l'app, vérifiée par OpenRouter (`/key`) puis rangée dans le Gestionnaire
   d'identifiants de Windows (`mcstudio-openrouter.com.sdai.archimed`). Elle ne revient jamais vers
   l'interface et n'est envoyée qu'à OpenRouter.
3. **Modèles** : lus en direct (`/models`, sortie « image »), gratuits en tête, gardés en cache.
   Un modèle payant est grisé tant que « Autoriser les modèles payants » n'est pas activé, et le
   backend le refuse de même. Les modèles gratuits vont et viennent chez OpenRouter et ont des
   quotas (erreur 429 expliquée).
   **Google Gemini** (ADR 0007) : clé Google AI Studio (aistudio.google.com/apikey), vérifiée par
   `GET /models` puis rangée à part (`mcstudio-gemini.com.sdai.archimed`), envoyée seulement en
   en-tête `x-goog-api-key`. Modèles « Nano Banana » lus en direct ; tous facturés par Google sur
   le projet de la clé, donc soumis à « Accepter la facturation Google ». L'abonnement Gemini
   (Google AI Pro) ne couvre pas l'API ; ses crédits Google Cloud mensuels, si.
4. **Conversion** (`pixelart.rs`, déterministe), sans réglage à choisir : la taille est celle de
   la texture en place (16, 32 ou 64 px ; 16 pour une nouvelle), la palette suit la taille, le
   raccord suit la face. Réduction en gardant par zone une couleur franche (la plus rare de
   l'image quand elle couvre au moins 12 % de la zone : les éclats d'un minerai ou un contour
   survivent), palette limitée par coupe médiane. Une icône est agrandie à 64 px sans lissage ;
   un élément d'interface garde la taille de son fichier (toile 256 × 256 si besoin).
   **Retirer le fond** (seul interrupteur, actif par défaut pour un objet) : le texte envoyé
   demande un fond uni magenta pur (vert si l'objet est rose ou violet), puis le fond est retiré
   par remplissage depuis les bords, à partir des couleurs dominantes du bord (fond uni, en
   dégradé ou en damier « faux transparent »). La couleur-clé est retirée avec une tolérance
   large, y compris les zones enfermées (entre le bras et le corps), le liseré de bord et les
   poussières isolées ; l'objet est ensuite cadré. Changer ce réglage reconvertit la même image,
   sans réseau (après confirmation si elle a été retouchée).
   **Raccord** (faces de bloc) : le cadre uni que les modèles ajoutent souvent est retiré, puis
   les bords sont fondus avec la copie décalée d'une demi-case de l'image (en largeur seulement,
   ou dans les deux sens) : répétée, la texture ne montre plus de coupure. La qualité du raccord
   (0 à 100 %) est mesurée sur la texture finale et affichée.
5. **Faces des blocs** : « Faces du bloc » choisit la répartition du modèle (`cube_all`,
   `cube_column`, `cube_bottom_top`, `cube` à six faces). Le modèle est réécrit après un point de
   restauration (autres réglages du modèle gardés), les faces manquantes partent de la texture
   actuelle ; chaque face a son onglet et sa texture (`<bloc>_<face>.png`, ou celle que le modèle
   référence déjà). Un modèle écrit à la main n'est remplacé par un cube qu'après confirmation.
6. **Cadrage** : bouton « Cadrer » (C) de la retouche, à côté de « Grille ». Sur l'image reçue, glisser pour choisir la
   zone qui devient la texture (aux proportions de la texture ; flèches pour la déplacer, Maj +
   flèches pour la redimensionner), « Toute l'image » pour revenir, « Terminé » pour retoucher. La zone (`PixelOptions.crop`, pixels de l'image d'origine) est
   appliquée avant toute la conversion.
   **Propositions** : chaque image générée, importée ou retouchée reste dans l'historique de sa
   texture (`texture_history`, 20 par texture, 150 en tout), même fermée : bande des versions sous
   le canevas, on la rouvre avec ses réglages, ou on la retire (`delete_draft`).
7. **Retouche au pixel** : crayon, gomme (pinceau de 1 à 16 px, touches [ et ]), remplissage, pipette, miroir, grille, décalage d'une
   demi-case (les bords opposés se retrouvent au milieu pour corriger un raccord), annuler /
   rétablir, zoom, palette de la texture, couleur hexadécimale ; au clavier : flèches + Espace,
   B/E/G/I/M, Ctrl+Z / Ctrl+Y. Les retouches s'enregistrent dans la proposition au fil de l'eau ;
   aperçus en direct : texture répétée 3 × 3 et bloc en 3D (vue d'inventaire).
8. **Application** : rien n'est écrit dans le projet avant « Appliquer au projet ». L'ancienne
   texture est copiée dans `.mcstudio/history/textures/<date>-<cible>.png`, la nouvelle écrite de
   façon atomique ; l'action est inscrite au journal d'audit (`mcstudio.texture_apply`), comme
   chaque génération (`mcstudio.texture_generate`) et chaque changement de clé.
9. **Textures non utilisées et suppression** : un PNG d'objet ou de bloc qu'aucun modèle ne
   référence et qui n'est pas un bloc (souvent une face laissée par un changement de répartition :
   `<bloc>_top.png`, `<bloc>_north.png`…) est rangé sous « Non utilisées », pas parmi les blocs.
   « Tout supprimer » (après confirmation) ou la corbeille d'une ligne ou de l'en-tête de l'atelier
   les met à la **Corbeille** (`delete_textures`, restaurables) ; seuls des `.png` sous
   `assets/<modid>/textures/` ou l'icône du mod sont acceptés.

**Disposition** : liste des textures à gauche ; l'atelier au centre avec l'en-tête (texture,
corbeille, Fermer, Appliquer au projet), les faces du bloc, la barre d'outils de retouche (dont
Grille et Cadrer), le canevas ajusté à la fenêtre (320 px au plus), à droite les aperçus (en jeu en 3D, répétée, taille réelle, qualité du raccord), la
bande des versions, puis la barre de création en bas, comme le chat : description (Entrée
génère), service et modèle, style et texte envoyé, Retirer le fond, import d'une image, Générer.

Brouillons : `%APPDATA%\com.sdai.archimed\modules\mcstudio\cache\textures\` (20 par texture, 150 en tout).
Sources remplaçables (HTTPS uniquement) : `{"openrouterApi": "https://…", "geminiApi": "https://…"}`
dans `env.json`. Décisions : [ADR 0005](../../../docs/adr/0005-mcstudio-openrouter-textures.md)
(OpenRouter, conversion), [ADR 0007](../../../docs/adr/0007-mcstudio-gemini-textures.md) (Gemini),
[ADR 0008](../../../docs/adr/0008-mcstudio-texture-workshop.md) (faces, raccord, retouche, interface).

## Modèles 3D (atelier, ADR 0009)

Onglet **Modèles 3D** : les modèles de blocs et d'objets du mod (`models/block`, `models/item`),
ses entités (`.mcstudio/models/`) et ses armures (couches trouvées dans `textures/`). Vue 3D
(three.js) : glisser pour tourner, molette pour zoomer, clic droit pour déplacer la vue ; un clic
choisit un cube, ses flèches le déplacent au pixel. Barre d'outils : sélection, crayon, gomme,
remplissage, pipette, couleur, pinceau de 1 à 16 px, annuler / rétablir (Ctrl+Z / Ctrl+Y, un
seul historique pour le modèle et les textures). Suppr, Ctrl+D (dupliquer), Ctrl+S.

- **Blocs et objets** : cubes (position, taille, rotation ±22,5° / 45° autour d'un centre,
  ombrage), faces (visible, variable de texture, UV automatiques ou saisis, rotation), variables
  de texture et création d'une texture. La forme d'un parent du jeu (cube, colonne, dalle, croix,
  tapis) s'affiche et se convertit en cubes (« Modifier la forme »). Un objet à plat
  (`item/generated`) se montre en relief et se peint directement. « + » crée un modèle (cube,
  dalle ou vide, parent `block/block`) : même nom qu'un bloc ou un objet du mod pour lui donner
  cette forme.
- **Entités** : gabarits (humanoïde 64 × 64, quadrupède 64 × 32, vide), os (nom, parent, pivot,
  rotation) et cubes (position, taille, UV en boîte, gonflement, miroir) comme dans le jeu ;
  « Répartir » range les zones de texture sans chevauchement, « Patron » colore chaque face pour
  peindre ensuite. L'enregistrement écrit la source, la texture `textures/entity/<nom>.png` et
  la classe `client/model/<Nom>ModelData.java` (Yarn ou Mojmap selon le profil, 1.17+), visible
  avec « Code Java ».
- **Armures** : couches 1 (casque, plastron, bottes) et 2 (jambières) sur le modèle d'armure du
  jeu, autour d'un mannequin ; couche manquante créée en 64 × 32.

**Comme Blockbench** :
- **Formes** (barre d'outils) : cube, cylindre, sphère, cône, pleins ou creux (épaisseur de
  paroi), précision 2, 1 ou 0,5 px. Le jeu ne connaît que des cubes : la forme est faite de
  cubes regroupés au plus grand (un cylindre de 8 px = 5 cubes). Aperçu translucide avant de
  créer, la poignée place la forme. Blocs et objets : la forme entre dans un groupe ; entités :
  dans un nouvel os, sous l'os choisi.
- **Texture d'une forme ou des cubes choisis** : la même que le cube de départ, une texture du
  mod réutilisée (ou du jeu, `minecraft:block/stone`), une nouvelle texture unie de la couleur du
  pinceau (16, 32 ou 64 px), ou une nouvelle texture **générée par l'IA ou importée** : l'atelier
  de texture s'ouvre en surcouche et rend son brouillon sans rien écrire (la texture est
  enregistrée avec le modèle). Entités : une zone de texture propre, remplie.
- **Creuser** (pioche) : une boîte rouge, déplaçable à la poignée, est retirée des cubes choisis
  (ou de tout le modèle) ; les cubes traversés sont recoupés en morceaux qui gardent leur texture
  au même endroit (entités : les morceaux reçoivent de nouvelles zones peintes d'après la peau).
  Un cube tourné n'est pas recoupé.
- **Groupes** (clé `groups` du JSON, format Blockbench, ignorée par le jeu), sélection multiple
  (Maj ou Ctrl + clic), Ctrl+G grouper, Ctrl+A tout choisir, Échap.
- **Poignée** : déplacer (V) ou redimensionner (S, le coin opposé suit la souris).
- **Objets à plat** : « Passer en 3D » remplace `item/generated` par des cubes d'un pixel
  d'épaisseur (réglages d'affichage en main, au sol, sur la tête gardés), prêts à recevoir
  d'autres formes.

Tout enregistrement de modèle crée d'abord un point de restauration ; une texture remplacée est
copiée dans `.mcstudio/history/textures/`.

## Importer, porter, exporter

- **Importer** (« Ouvrir ou importer » dans la liste des projets) : un dossier Gradle Fabric,
  Forge ou NeoForge fait ailleurs est examiné (`gradle.properties`, `build.gradle`,
  `fabric.mod.json` / `mods.toml`, classe principale, licence) et un aperçu montre ce qui a été
  compris. Importer écrit seulement `.mcstudio/project.json` : aucun autre fichier n'est touché.
  Une version sans profil ou un projet illisible est refusé avec la raison.
- **Porter** (tableau de bord, « Porter vers une autre version ») : même loader, autre version de
  Minecraft. Le plan s'affiche avant de confirmer (étapes automatiques, changements d'API connus).
  Après un point de restauration, Mod Studio résout les versions (loader, mappings, API), met à
  jour les lignes de version de `gradle.properties`, `build.gradle`, du wrapper Gradle et du
  descripteur du mod (vos retouches restent), renomme les dossiers de données (`recipes` →
  `recipe`, `tags/blocks` → `tags/block`… en 1.21) et ajoute les définitions de modèle d'objet
  (1.21.4). Le code Java est confié à l'assistant IA avec un message prêt (versions, changements
  d'API, classes de référence de la version cible), à relire avant l'envoi.
- **Exporter** (tableau de bord, « Exporter les sources ») : archive ZIP `<modid>-<version>/`
  avec les sources, le wrapper (`gradlew` reste exécutable), `.mcstudio/project.json` et les
  modèles d'entités ; sans builds, caches, `run/`, `.git`, ni `local.properties`. Une clé qui
  ressemble à un secret dans un fichier `.properties` (`*_token`, `password`…) est signalée
  avant le partage. L'archive se réimporte telle quelle.

## Projet généré

```
<modid>/
├── build.gradle · settings.gradle · gradle.properties
├── gradlew · gradlew.bat · gradle/wrapper/          # Gradle Wrapper embarqué (Apache 2.0)
├── src/main/java/<package>/<MainClass>.java
├── src/main/java/<package>/registry/ModItems.java · ModBlocks.java
├── src/main/resources/                              # fabric.mod.json | META-INF/(neoforge.)mods.toml
│   ├── assets/<modid>/ (icon.png, lang/, models/, blockstates/, textures/)
│   └── data/<modid>/ (recettes, loot tables) · data/minecraft/tags/
├── .mcstudio/project.json · builds.json · builds/<id>.log
└── dist/<modid>-<version>-<loader>-<mc>.jar         # après une compilation réussie
```

Les classes de registre portent des marqueurs `// @mcstudio:items`, `// @mcstudio:blocks`,
`// @mcstudio:creative-tab` : les générateurs insèrent leur code au-dessus. Les retirer n'empêche
pas de compiler, seulement d'ajouter du contenu depuis Mod Studio (message explicite).

## Compilation

`build_project` vérifie le wrapper et le JDK, puis lance `gradlew --console=plain build` avec
`JAVA_HOME` = JDK du profil (Forge 1.20.1 : Java 17 exactement). Chaque ligne est diffusée avec un
niveau (erreur, avertissement, info, debug) ; « Arrêter » tue l'arbre de processus (`taskkill /T`,
groupe de processus sous Unix). Le statut vient du code de sortie de Gradle ; le jar est celui écrit
dans `build/libs/` pendant ce build, copié dans `dist/`. Chaque compilation est inscrite dans le
journal d'audit (`mcstudio.gradle`).

**Tester en jeu** (onglet Build) lance `gradlew runClient` : Minecraft démarre avec le mod, via
la configuration de lancement du projet (Fabric Loom l'a d'office, les templates Forge et NeoForge
la déclarent). **Serveur de test** lance `gradlew runServer` dans `run/` : la première fois,
Mod Studio demande d'accepter le CLUF de Minecraft (lien vers le texte, `eula=true` écrit
seulement après ce clic) et met `online-mode=false` dans `server.properties` s'il n'existe pas,
pour rejoindre le serveur depuis le client de développement (`localhost`). Un code client chargé
sur le serveur est expliqué. Le serveur tourne **à côté** de la compilation et du jeu (deux
emplacements par projet), avec son propre journal et une **console** : chaque ligne tapée est
envoyée au serveur (↑ / ↓ rappellent les précédentes). Gradle ne transmet pas son entrée aux
tâches `JavaExec` : Mod Studio passe `--init-script .mcstudio/gradle/server-console.gradle`
(branche `System.in` sur `runServer`, sans toucher aux fichiers du projet). « Arrêter le
serveur » envoie `stop` (le monde est enregistré) ; après 20 s, ou avec « Forcer l'arrêt »,
l'arbre de processus est arrêté. La première partie télécharge les ressources du jeu. Fermer le jeu termine la
partie ; « Arrêter le jeu » tue l'arbre de processus. Un plantage est reconnu dans le journal
(« Le jeu a planté », avec le chemin du rapport dans `run/crash-reports/`), de même qu'une classe
ou méthode absente au lancement et un Mixin non appliqué ; l'assistant IA peut être chargé de
corriger.

`diagnostics.rs` reconnaît : erreurs javac/Kotlin (fichier, ligne), API ou mappings inconnus,
Java incompatible, réseau (dont refus 403/407 d'un proxy), plugin ou dépendance introuvable, JSON
invalide, wrapper endommagé ; sinon le bloc « What went wrong » de Gradle. La cause la plus en
amont passe en premier (sans réseau, les dépendances « introuvables » n'en sont que la conséquence).

> **Sécurité** : un script Gradle est du code exécutable. Compiler un projet exécute ses
> `build.gradle`/`settings.gradle` sur la machine. Les phases IA n'appliqueront jamais
> automatiquement une modification de ces fichiers.

## Commandes Rust

Projets : `list_projects` · `get_project` · `create_project` · `open_project` · `duplicate_project` ·
`remove_project` (retrait de la liste, ou Corbeille) · `project_stats` · `default_parent_dir` ·
`inspect_import` · `import_project` · `export_zip` · `port_plan` · `port_project`
Versions : `version_catalog` · `version_options` · `resolve_versions` · `update_project_versions`
Java : `detect_java` · `inspect_java` · `project_java` · `set_project_java` · `environment` ·
`jdk_offer` · `install_jdk` · `cancel_jdk_install`
Contenu : `add_item` · `add_block` · `add_recipe`
Textures : `openrouter_status` · `set_openrouter_key` · `clear_openrouter_key` · `image_models` ·
`gemini_status` · `set_gemini_key` · `clear_gemini_key` · `gemini_image_models` · `edit_texture` ·
`texture_history` · `delete_draft` ·
`draft_pixels` · `save_draft_pixels` · `set_block_layout` · `create_gui_texture` · `delete_textures` ·
`texture_prompt` · `list_textures` · `generate_texture` · `import_texture` · `reprocess_texture` ·
`apply_texture`

Modèles 3D : `list_models` · `read_model` · `save_model` · `read_entity_model` · `save_entity_model` ·
`entity_model_code` · `texture_pixels` · `save_texture_pixels`
Build : `build_project` · `cancel_build` · `server_eula` · `accept_server_eula` · `stop_server` ·
`send_server_command` · `list_builds` · `read_build_log`
Fichiers : `list_files` · `read_project_file` · `write_project_file` · `create_project_file` ·
`rename_project_file` · `trash_project_file` · `validate_project`
Restauration : `list_snapshots` · `create_snapshot` · `restore_snapshot` · `delete_snapshot`
Assistant : `agent_prepare` · `agent_instructions` · `agent_changes` · `agent_apply` · `agent_discard` ·
`agent_reset`

## Tests

- `cargo test mcstudio` : profils, parseurs de métadonnées, rendu des templates (tous les profils,
  JSON/TOML valides, aucun marqueur oublié), générateurs, JDK, diagnostics (dont un vrai journal
  NeoForge), exécution réelle d'un processus de build, conversion pixel-art (fond, cadrage, détails
  rares, palette), brouillons et historique des textures, clients OpenRouter et Gemini contre de
  faux serveurs locaux (clé, modèles, image en data URL ou `inlineData`, repli sans `imageConfig`,
  refus de sécurité, erreurs 401/429), fichiers (sortie du projet refusée,
  liens symboliques, conflit d'écriture, état interne protégé), validateur (syntaxe localisée,
  formats par version, références cassées ; chaque projet généré passe sans problème), points de
  restauration (fichiers remis, fichiers créés retirés, restauration elle-même annulable), agent
  (copie sans builds, modifications de l'agent distinguées de celles de la personne, conflits,
  application annulable, consignes exactes pour les 23 profils), import (Fabric, Forge, NeoForge,
  dossier inutilisable), portage (Fabric 1.20.1 → 1.21.1 → 1.21.4 : retouches gardées, données
  renommées, définitions d'objet), export ZIP (fichiers exclus, `gradlew` exécutable, secret
  signalé), CLUF du serveur (jamais accepté sans la personne).
- `pnpm test` (atelier 3D) : formes en cubes (sans chevauchement, dans leur boîte, creuses),
  creuser (volume exact, UV gardés, peau des entités recopiée), objets à plat en relief, groupes
  au format Blockbench, zones de texture des nouveaux cubes d'entité.
- `JAVA_HOME=… cargo test server_console -- --ignored --nocapture` : vrai Gradle 8.14.3 et vrai
  Java sur un faux `runServer` ; commandes reçues par la console, partie lancée pendant que le
  serveur tourne, arrêt propre sur `stop`.
- `cargo test mcstudio::e2e -- --ignored --nocapture` : crée **TestMod** (1 objet, 1 bloc, recettes)
  pour la version la plus récente de chaque profil et le compile vraiment ; affiche
  `MODULE BASIC PIPELINE = OK (…)` par version et un bilan final. Options :
  `MCSTUDIO_E2E_PROFILES=fabric-1.21,forge-1.20` (filtre), `MCSTUDIO_E2E_ALL=1` (toutes les
  versions de chaque profil), `MCSTUDIO_E2E_INSTALL_JDK=1` (installe les JDK manquants).
- `MCSTUDIO_KEEP_TEST_OUTPUT=1 cargo test every_profile_creates` garde les projets générés.
- `pnpm test` : identifiants, assistant de création, journal, réglages de texture (raccord par face,
  éléments d'interface), éditeur de pixels (aller-retour base64, remplissage, traits, palette), choix du modèle,
  chemins, message de correction et sélection par défaut de l'assistant IA.

## Données

| Fichier | Contenu |
|---|---|
| `%APPDATA%\com.sdai.archimed\modules\mcstudio\projects.json` | chemins des projets connus |
| `…\mcstudio\profiles\*.toml` | profils de l'utilisateur (remplacent ceux livrés) |
| `…\mcstudio\cache\meta\` | dernières réponses des métadonnées des loaders |
| `…\mcstudio\cache\openrouter-models.json` · `gemini-models.json` · `cache\textures\` | modèles d'image connus, brouillons de textures |
| `…\mcstudio\jdks\` · `env.json` | JDK installés par Mod Studio, sources remplaçables |
| `…\mcstudio\work\<projet>\` · `work\<projet>.base.json` | copie de travail de l'assistant IA, empreintes de base |
| Gestionnaire d'identifiants Windows | clés OpenRouter (`mcstudio-openrouter.com.sdai.archimed`) et Google AI Studio (`mcstudio-gemini.com.sdai.archimed`) |
| `<projet>\.mcstudio\` | identité, historique et journaux de build, anciennes textures (`history/textures/`) |
