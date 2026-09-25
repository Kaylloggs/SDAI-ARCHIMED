# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions en [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté — Module Image Maker (catégorie Création)
- **Studio d'images par IA** : créer à partir d'une description (consigne libre ou structurée :
  sujet, décor, composition, lumière, appareil, matières, couleurs, ambiance, style, détail),
  améliorer la consigne avec un modèle de texte, images de référence avec leur rôle.
- **Retoucher** : une zone sélectionnée (remplacer, effacer, ajouter, modifier), toute l'image,
  étendre la toile (16:9, 21:9, 4:3…, place de l'original au choix), variantes (ce qu'il faut
  garder), style, fond (retirer ou remplacer), améliorer, restaurer. Hors de la zone, chaque
  pixel d'origine est gardé ; l'original est replacé au pixel près après une extension.
- **Outils** : main, zoom, rectangle, ellipse, lasso, pinceau, gomme (sélection ou image),
  déplacer une sélection, recadrer (formats 1:1 à 21:9, libre, formats de réseaux sociaux
  modifiables). Annuler / rétablir, comparaison avant / après (curseur ou côte à côte).
- **Sur la machine, sans envoi** : redimensionner, agrandir (×1,5 à ×4), tourner, miroir,
  luminosité, contraste, teinte, flou du fond, fond uni rendu transparent, export PNG, JPEG,
  WebP, TIFF, GIF, BMP (qualité, taille, nom des fichiers, préréglages).
- **Historique en arbre** : chaque opération crée une version ; générations, favoris, références,
  traitements par lot (export, agrandissement, détourage).
- **Fournisseurs** : OpenRouter, Google AI Studio, Higgsfield. Capacités lues chez le fournisseur
  (ou dans sa documentation officielle, signalé), options non prises en charge masquées, mode
  Auto qui choisit un modèle compatible et dit pourquoi. File de demandes (en attente, en cours,
  terminée, échec, annulée) avec annulation, relance et correction proposée selon l'erreur.
- **Connexions** : clés vérifiées puis rangées dans le Gestionnaire d'identifiants, jamais
  affichées en entier ; une clé déjà donnée à Mod Studio est relue sans être copiée. Mode compte :
  ouvrir le site officiel, puis importer l'image téléchargée (aucun mot de passe demandé).
- **Confidentialité et coûts** : avant chaque envoi, ce qui part et chez qui ; coût affiché
  seulement quand le fournisseur le donne. Glisser-déposer, Ctrl+V, copie d'image.
- **Service `image.maker`** pour les autres modules : générer, modifier, détourer, agrandir,
  varier (ADR 0010).

### Technique
- Couche de fournisseurs d'images partagée dans le core (`core/imaging`, trait `ImageProvider`),
  relecture en lecture seule des clés d'un autre module (`all_credentials()` généré par
  `build.rs`), décodeurs TIFF, GIF et BMP ajoutés à `image`.

## [0.5.0] - 2026-09-25

### Ajouté — Module Tutoriel
- **Tutoriel**, dans le menu juste au-dessus de Réglages : « Premiers pas » (le tour de
  l'application en huit étapes), un tutoriel pour chaque module, et « Créer un module » (du code
  source à votre propre version de l'application, commandes à copier).
- Chaque étape se voit sur une **miniature de la fenêtre** où la zone à regarder s'allume ; le
  repère glisse d'une zone à l'autre en changeant d'étape. Clavier `←` `→` pour les étapes, `↑`
  `↓` pour les tutoriels, recherche sans accents, progression gardée, écran de fin avec astuces et
  tutoriel suivant.
- Bouton **?** à côté du nom du module, dans la barre de titre : ouvre son tutoriel (« Premiers
  pas » sur l'accueil).
- Tout module déclare son tutoriel (`tutorial.ts`, `defineTutorial`) : `pnpm check` refuse un
  module qui n'en a pas, et le modèle de `pnpm new:module` en contient un. Tutoriels écrits pour
  Chat, Code, Planner, Mémoire, Skills, Crédits, JobAgent, Mod Studio et Réglages.

### Modifié
- **Réglages → Modules** ne montre plus les modules requis (Accueil, Réglages, Tutoriel), qu'on ne
  peut ni désactiver ni supprimer.
- README (anglais et français) : les modules se désactivent ou se suppriment ; ajouter son
  propre module (sources nécessaires, compilation de sa version) ; Accueil et Réglages retirés du
  tableau des modules.
- **Publication en un clic** : Actions → Release → Run workflow publie la version du projet et
  crée le tag lui-même ; une version déjà publiée depuis un autre commit est refusée.

## [0.4.0] - 2026-09-25

### Modifié — Publication des versions
- Chaque tag `vX.Y.Z` lance la compilation Windows sur GitHub Actions (vérifications, tests,
  installeur, exe portable) et publie la release avec ses deux fichiers.
- **Accents des notes de release** : ils sortaient cassés (« AjoutÃ© ») car `build.ps1` lisait
  le CHANGELOG en ANSI sous Windows PowerShell 5.1. Les notes sont maintenant écrites en UTF-8
  par `scripts/release-notes.mjs`, et le workflow « Release notes » répare une release déjà
  publiée.

### Documentation
- README en français (`README.fr.md`), galerie des six thèmes, prérequis installés en une
  seule commande `winget`, clés API personnelles (OpenRouter, Google, Higgsfield).

### Ajouté — Atelier 3D façon Blockbench
- **Formes** : cube, cylindre, sphère, cône, pleins ou creux, avec aperçu et poignée pour les
  placer ; faites de cubes regroupés (le seul volume que le jeu connaît).
- **Texture au choix** pour une nouvelle forme ou les cubes choisis : même texture que le cube de
  départ, texture du mod ou du jeu réutilisée, nouvelle texture unie, ou nouvelle texture générée
  par l'IA ou importée (l'atelier de texture s'ouvre sans quitter le modèle).
- **Creuser** : une boîte retirée des cubes qu'elle traverse, textures gardées en place.
- **Groupes** (format Blockbench), sélection multiple, poignée pour déplacer ou redimensionner.
- **Objets en 3D** : un objet à plat passe en cubes d'un pixel d'épaisseur pour recevoir
  d'autres formes. Les entités reçoivent formes, creusage et textures de la même façon.

### Corrigé — Mod Studio : serveur de test
- Le jeu se lance pendant que le serveur de test tourne (« Tester en jeu », puis Multijoueur,
  `localhost`) : le serveur a son propre emplacement et son propre journal.
- La console du serveur accepte les commandes (`op`, `time set day`…) : Gradle ne transmettait
  pas l'entrée standard au serveur. Historique avec ↑ / ↓.
- « Arrêter le serveur » envoie `stop` pour enregistrer le monde, avec « Forcer l'arrêt » en
  secours.

### Ajouté — Assistant IA : tout cocher
- **Modifications proposées** : une case « Tout cocher » / « Tout décocher » (état partiel
  quand une partie seulement est cochée) et le compte des fichiers choisis.

### Ajouté — Mod Studio : serveur de test, import, portage, export
- **Serveur de test** (onglet Build) : `runServer` lance un serveur local avec le mod. Le CLUF de
  Minecraft s'accepte d'un clic explicite (jamais en silence) ; `online-mode=false` est réglé
  pour rejoindre le serveur depuis le client de développement.
- **Importer un projet existant** : un dossier Fabric, Forge ou NeoForge est examiné, résumé,
  puis ajouté sans modifier ses fichiers (seul `.mcstudio/project.json` est écrit).
- **Porter vers une autre version de Minecraft** : plan affiché avant de confirmer, point de
  restauration, versions et fichiers de build mis à jour (retouches gardées), dossiers de données
  renommés, puis message prêt pour que l'assistant IA adapte le code Java.
- **Exporter les sources** en ZIP : sans builds ni caches, `gradlew` exécutable, secrets
  possibles signalés avant le partage.

### Ajouté — Mod Studio : atelier 3D (ADR 0009)
- Nouvel onglet **Modèles 3D**, à la manière de Blockbench : vue 3D des modèles de blocs et
  d'objets, des entités et des armures, avec la texture peinte directement sur le modèle (crayon,
  gomme, remplissage, pipette, pinceau de 1 à 16 px) ou à plat avec les zones de chaque face.
- **Blocs et objets 3D** : cubes à placer (poignée de déplacement ou valeurs), tourner, dupliquer ;
  faces, UV et variables de texture ; la forme d'un parent du jeu se convertit en cubes d'un clic ;
  les objets à plat se montrent en relief.
- **Entités** : gabarits humanoïde et quadrupède, os et cubes (pivot, rotation, UV en boîte,
  gonflement, miroir), répartition automatique des UV, patron de texture. L'enregistrement génère
  la classe Java de la géométrie (Yarn ou Mojmap, Minecraft 1.17+).
- **Armures** : les couches de texture portées sur le modèle d'armure du jeu, autour d'un mannequin.
- Annuler / rétablir communs au modèle et à ses textures ; point de restauration avant chaque
  enregistrement.

### Ajouté — Taille du pinceau
- Retouche au pixel : le crayon et la gomme ont une taille de 1 à 16 px (boutons − / + ou
  touches [ et ]), carrée jusqu'à 3 px, ronde au-delà ; l'empreinte s'affiche sous la souris.
  Pratique pour vider d'un geste une superposition générée pleine.

### Ajouté — Toutes les textures du mod dans l'onglet Textures
- Les textures qui ne sont ni un objet, ni un bloc, ni l'icône apparaissent aussi, classées :
  **Superpositions** (lunettes, casque, longue-vue…), **Entités**, **Armures**, **Particules**,
  **Effets**, **Tableaux**, **Autres textures** ; les éléments d'interface rangés en
  sous-dossiers rejoignent **Interface**.
- Une texture citée par le code du mod (`id("textures/misc/googles_overlay.png")`…), un modèle,
  une particule, un équipement ou un tableau est listée même si le fichier n'existe pas encore
  (« Texture manquante »), avec le fichier qui l'utilise. Elle se génère et s'applique comme les
  autres, à la taille de son fichier ou de sa famille dans le jeu, avec un texte adapté
  (superposition au centre dégagé, feuille d'entité, armure…).
- Une texture d'objet utilisée seulement par le code n'est plus classée « non utilisée ».

### Ajouté — Supprimer un module
- **Réglages → Modules** : chaque module (sauf Accueil et Réglages) a un interrupteur pour
  l'activer ou le désactiver (tout est gardé) et une corbeille pour le **supprimer**. La
  confirmation, dans la carte, dit ce qui partira : taille de ses données (mises à la Corbeille),
  outils donnés aux agents, clés d'API rangées dans le Gestionnaire d'identifiants. Les fichiers
  créés ailleurs (projets de mods, exports) restent. Un module supprimé se remet depuis « Modules
  supprimés ».
- Un module déclare ses clés dans `module.toml` (`credentials`) pour qu'elles partent avec lui.

### Modifié
- Atelier des textures plus compact : le canevas et les aperçus s'adaptent à la taille de la
  fenêtre (320 px au plus), la barre d'outils de retouche passe au-dessus du canevas avec
  **Grille** et **Cadrer** côte à côte et nommés ; « Retoucher cette texture » est toujours
  visible. L'aperçu « Répétée » ne déborde plus pour une texture de 64 px.
- « Tout supprimer » (historique des conversations) confirme dans la carte, sans fenêtre native.
- README raccourci (l'essentiel, les détails sont dans le README de chaque module).

### Modifié — Mod Studio : atelier des textures
- Nouvelle disposition, pensée comme un atelier : le **canevas** au centre, les **outils** en
  colonne à gauche (crayon, gomme, remplissage, pipette, **Cadrer**…), les **aperçus** à droite (en
  jeu en 3D, répétée, taille réelle, qualité du raccord), la **bande des versions** dessous et une
  **barre de création** en bas, comme le chat : description (Entrée génère), service et modèle,
  style et texte envoyé, Retirer le fond, import d'une image. Toutes les fonctions restent.
- **Cadrage dans la retouche** : l'outil « Cadrer » (C) choisit la zone de l'image reçue qui
  devient la texture, aux proportions de la texture ; la conversion suit aussitôt.
- **Moins de réglages** : taille, couleurs et raccord ne se choisissent plus. La taille est celle
  de la texture en place (16 px pour une nouvelle), la palette suit la taille, le raccord suit la
  face du bloc.
- **Propositions gardées** : chaque image générée, importée ou retouchée reste dans l'historique
  de sa texture (20 par texture), même fermée ; on la rouvre d'un clic avec ses réglages.

### Amélioré — Retirer le fond
- Le modèle reçoit la consigne d'un fond uni magenta pur (vert si l'objet est rose ou violet),
  retiré ensuite avec une tolérance large. Le retrait part des couleurs dominantes du bord : fond
  uni, dégradé ou damier « faux transparent ». Les zones de fond enfermées (entre le bras et le
  corps), le liseré coloré autour de l'objet et les poussières isolées disparaissent aussi.

### Ajouté — Supprimer une texture
- Corbeille dans l'en-tête de l'atelier et sur chaque ligne de la liste (confirmation) : la
  texture part à la Corbeille, restaurable.
- Groupe **Non utilisées** : les PNG qu'aucun modèle ne référence (les faces laissées en essayant
  plusieurs répartitions d'un bloc) ne sont plus pris pour des blocs ; « Tout supprimer » les met à
  la Corbeille d'un coup.

### Corrigé
- Onglet Textures : des blocs apparaissaient sans raison (modèles de variantes d'une dalle, d'une
  bûche, faces laissées par un changement de répartition) ; seuls les blocs déclarés ou ayant un
  état de bloc sont listés, les autres PNG vont sous « Non utilisées », et un bloc à modèle fait
  main montre sa vraie texture.
- Tailles de texte (`text-caption`, `text-footnote`…) perdues quand une couleur les suivait dans
  une classe composée (`cn`) : partout dans l'application.

### Ajouté — Mod Studio : atelier des textures (ADR 0008)
- **Faces des blocs** : une texture pour tout le bloc, colonne (côtés + extrémités), dessus /
  dessous / côtés, ou six faces. Le modèle du bloc est réécrit (point de restauration avant), chaque
  face a son onglet ; aperçu du bloc en 3D.
- **Vrai raccord** : cadre ajouté par le modèle retiré, bords fondus pour que la texture se
  répète sans coupure (en largeur seulement pour un côté d'herbe), qualité du raccord affichée,
  aperçu répété 3 × 3.
- **Texte envoyé à l'IA personnalisable** : style (jeu de base, détaillé, simple), consignes en plus,
  texture de référence (palette partagée entre les faces, variantes), et texte final modifiable
  mot pour mot.
- **Retouche au pixel** : crayon, gomme, remplissage, pipette, miroir, grille, décalage pour
  corriger un raccord, annuler / rétablir, clavier ; sur une proposition ou sur la texture actuelle.
- **Éléments d'interface** (`textures/gui/`) : écran de conteneur (avec l'inventaire du joueur),
  bouton, case, flèche de progression ou toile libre, aux couleurs du jeu ; générables par l'IA à
  leur taille (toile 256 × 256 pour les écrans).

### Ajouté — Mod Studio : textures avec Google Gemini (ADR 0007)
- Nouveau **service d'image** dans l'onglet Textures : Google Gemini (modèles Nano Banana, dont
  Nano Banana 2), avec une clé Google AI Studio vérifiée puis rangée dans le Gestionnaire
  d'identifiants. Modèles lus en direct ; chaque génération est facturée par Google sur le projet
  de la clé et demande « Accepter la facturation Google ». L'abonnement Gemini ne couvre pas
  l'API (ses crédits Google Cloud, si) : c'est dit dans l'application.
- Clé Gemini aussi réglable dans Environnement (liste des projets).

### Corrigé — IA dans les modules
- Claude refusait toute création, modification ou suppression (« The canUseTool callback returned
  an invalid permission result ») : l'autorisation renvoyait `updatedInput: null`. Elle renvoie
  désormais l'entrée de l'outil (ou celle modifiée dans la carte).

### Modifié — Choix du modèle
- Le modèle se choisit **par son nom** (Fable 5.1, Opus 5.5, Opus 5, Sonnet 5, Haiku 4.5 ; « Gemini
  3.8 Flash »… pour Antigravity) et l'effort avec un **curseur** (Auto → Maximum pour Claude, les
  niveaux listés par `agy` pour Gemini), au lieu d'une entrée par niveau. Haiku 4.5 n'a pas de
  curseur (pas d'effort réglable). Les conversations existantes gardent leur réglage.

### Ajouté — Mod Studio : test en jeu
- Bouton **Tester en jeu** (onglet Build) : `gradlew runClient` lance Minecraft avec le mod, journal
  en direct, « Arrêter le jeu ». Plantages reconnus et expliqués (rapport de plantage, classe ou
  méthode absente, Mixin non appliqué), et correction proposée à l'assistant IA.

### Ajouté — Mod Studio : assistant IA avec vos CLI (phase G)
- Onglet **Assistant IA** : conversation avec Claude Code, Antigravity ou Codex (ce qui est
  installé), qui connaît la version de Minecraft, le loader, les versions exactes, les mappings
  et reçoit des **exemples de code exacts** de la version.
- L'IA travaille dans une **copie de travail** du projet : ses modifications sont listées fichier
  par fichier avec leur diff, les conflits signalés ; **rien n'entre dans le projet sans être
  appliqué**, chaque application crée un point de restauration et se vérifie aussitôt.
- **Correction bornée** : après un build en échec, un message d'erreurs expliquées est préparé
  pour l'IA (trois essais d'affilée au plus).

### Modifié — Moteur (ADR 0006)
- **Mode Auto plus sûr** : en « Smart », une modification de fichier **hors du dossier de travail**
  de la conversation (chemin absolu ailleurs, `..`, `~`) n'est plus validée d'office : elle est
  demandée, pour tous les modules.
- Les modules peuvent ouvrir leurs propres conversations (origine libre, rouvertes depuis
  l'accueil dans leur module) et leur passer des consignes : prompt système ajouté (Claude
  `--append-system-prompt`, sinon en tête du premier message) et outils refusés
  (`--disallowedTools`).

### Ajouté — Mod Studio : points de restauration (phase F)
- Tableau de bord → **Points de restauration** : création à la main (tous les fichiers du
  projet), restauration confirmée et **annulable** (l'état courant est sauvegardé d'abord),
  fichiers créés depuis remis à la Corbeille, suppression vers la Corbeille.

### Modifié
- **Vrai diff** dans le core (`core/lib/diff.ts`, algorithme de Myers) : `DiffView` affiche un
  diff unifié par blocs, avec contexte, numéros de ligne et compteurs. L'ancien diff comparait
  des ensembles de lignes et ne voyait ni les déplacements ni les lignes répétées.

### Ajouté — Mod Studio : vérification sans compiler (phase E)
- Panneau **Problèmes** (onglet Fichiers) et résumé sur le tableau de bord : JSON et TOML
  localisés à la ligne et à la colonne avec une explication, PNG illisibles ou de mauvaise
  taille, dossiers de données d'une autre époque (`recipes/` contre `recipe/`), recettes au
  format d'une autre version, textures, modèles et définitions d'objet introuvables, noms
  affichés manquants. Un clic ouvre le fichier à la ligne, surlignée dans l'éditeur.
- Chaque projet généré (23 profils) passe cette vérification sans aucun problème.

### Ajouté — Mod Studio : explorateur et éditeur (phase D)
- **Onglet Fichiers** : arborescence du projet, éditeur à onglets (Java, JSON, TOML, Gradle,
  `.properties`), aperçu des images, clic droit pour créer, renommer ou mettre à la Corbeille.
- Brouillons conservés par projet, enregistrement `Ctrl+S`, fermeture d'un fichier modifié
  confirmée, **aucun écrasement silencieux** d'un fichier changé sur le disque depuis son ouverture.
- Chemins confinés au projet côté Rust (`..`, absolus, lecteurs, liens symboliques refusés),
  `.mcstudio/` et `.git/` protégés en écriture, actions auditées ; bandeau sur les scripts Gradle.

### Modifié
- `CodeEditor` et `FileTree` quittent le module Code pour `src/core/editor/` (génériques : la
  lecture des dossiers est fournie par le module). Le module Code les utilise sans changement
  visible ; l'éditeur sait surligner des lignes signalées.

### Ajouté — Mod Studio : textures par IA (OpenRouter)
- **Onglet Textures** : icône, objets et blocs du mod, avec leur texture actuelle ou manquante ;
  ajout d'un objet ou d'un bloc (code, modèles, traductions, loot table, outil de minage) sans
  quitter l'onglet.
- **Génération par un modèle d'image d'OpenRouter** avec la clé de la personne : clé vérifiée puis
  rangée dans le Gestionnaire d'identifiants de Windows, jamais renvoyée à l'interface ; modèles
  lus en direct, gratuits en tête, payants refusés sans accord explicite ; texte envoyé au modèle
  visible avant l'envoi ; erreurs d'OpenRouter expliquées (clé refusée, crédit, quota 429).
- **Import d'une image** (PNG, JPEG, WebP) pour qui n'a pas de clé.
- **Conversion en pixel-art** déterministe : fond retiré, objet cadré, 16, 32 ou 64 px, couleurs
  franches qui gardent les petits détails, palette limitée ; réglages appliqués en direct.
- **Aperçu avant application** (image reçue, texture, taille réelle) ; l'ancienne texture est
  gardée dans `.mcstudio/history/textures/` ; générations, applications et changements de clé
  inscrits au journal d'audit. Voir ADR 0005.
- Dépendances : `image` (décodage PNG/JPEG/WebP borné), `base64`, `keyring`.

### Corrigé
- Interrupteurs de Mod Studio : la pastille sortait du rail (hérité du centrage du bouton).

### Ajouté — Mod Studio : toutes les versions, choix du loader, installation de Java
- **Minecraft 1.14 à 1.21.x** : 23 profils de version couvrent Fabric 1.14 → 1.21.x, Forge 1.14.4 →
  1.21.5 et NeoForge 1.20.4 → 1.21.x, avec un template par époque d'API (registres, onglets créatifs,
  identifiants, `setId` de 1.21.2) et un format de données par version (dossiers au singulier en
  1.21, ingrédients en texte en 1.21.2, définitions `items/` en 1.21.4). Ce qui reste hors champ
  (snapshots, avant 1.14, Forge 1.21.6+, NeoForge 1.20.2–1.20.3) est affiché avec la raison.
  Les profils non encore compilés de bout en bout portent le badge « Non vérifié ».
- **Choix des versions** : version du loader, de Fabric API et de Yarn (ou de Forge / NeoForge)
  choisie parmi les versions publiées, recommandée présélectionnée ; modifiable après création
  (`gradle.properties`, `fabric.mod.json` et `project.json` réécrits).
- **Java manquant installé depuis l'app** : panneau « Environnement » (un JDK par famille de
  versions, version exacte pour Forge), et proposition de téléchargement d'Eclipse Temurin
  (API Adoptium) dans l'assistant, le tableau de bord et le build. Rien ne s'installe sans
  confirmation ; l'archive est vérifiée par SHA-256, décompressée sans pouvoir sortir de son dossier
  (`jdks/`), et l'installation est inscrite au journal d'audit. Voir ADR 0004.
- Test e2e en matrice : `MCSTUDIO_E2E_ALL`, `MCSTUDIO_E2E_PROFILES`, `MCSTUDIO_E2E_INSTALL_JDK`.
- Dépendances : `zip`, `tar`, `flate2`, `sha2`.

### Ajouté — Module Minecraft Mod Studio (phases A à C)
- **Projets de mods réels** pour Fabric, Forge et NeoForge : assistant en six étapes (nom, identifiants,
  version, loader, Java, contenu), projet Gradle complet avec son wrapper, métadonnées, registres,
  icône pixel-art, fichiers de langue `en_us` / `fr_fr`, licence MIT ou aucune au choix.
- **Profils de version** (`fabric-1.20`, `fabric-1.21`, `forge-1.20`, `neoforge-1.21`) : Java, Gradle,
  plugin, mappings et format de données propres à chaque plage de Minecraft. Les versions du loader,
  des mappings et de Fabric API sont lues dans les métadonnées officielles, gardées en cache pour le
  hors-ligne. Une version sans profil vérifié est affichée « non prise en charge ».
- **Compilation réelle** : Gradle lancé avec le JDK du profil, journal en direct filtrable par niveau,
  arrêt de l'arbre de processus, erreurs expliquées (fichier, ligne, cause probable, solution), jar
  copié dans `dist/`, historique des 30 dernières compilations.
- **Générateurs déterministes** : objet, bloc (état, modèles, loot table, tag d'outil) et recettes
  (façonnée, sans forme, cuisson) au format de la version du projet ; textures générées en PNG.
- Détection des JDK installés (fichier `release`, sans lancer de processus) et choix par projet.
- Test de bout en bout `mcstudio::e2e` (ignoré par défaut : réseau et JDK requis) qui crée TestMod et
  le compile vraiment pour chaque profil.

## [0.3.0] - 2026-09-24

Première version publiée depuis la 0.2.2 : elle regroupe les compilations locales 0.2.4 à
0.2.10, qui n'ont pas fait l'objet de release.

### Ajouté — Module JobAgent
- **Recherche d'emploi multi-plateformes** : Indeed, LinkedIn, Glassdoor, ZipRecruiter,
  Google Jobs, **HelloWork** et **Welcome to the Jungle**, à partir de
  [JobSpy](https://github.com/speedyapply/JobSpy) (MIT, inclus). Plusieurs métiers, pays,
  villes et types de contrat sont interrogés en parallèle ; les résultats sont dédoublonnés
  entre plateformes et filtrés par niveau d'études, fraîcheur et télétravail.
- **Revue rapide** : sections repliables (métier, fraîcheur, contrat, ville, entreprise,
  plateforme), onglets exclusifs — une annonce en favori quitte « Toutes », une
  candidature envoyée quitte les favoris —, sélection multiple (Ctrl / Maj + clic) et tri
  au clavier (`F` favori, `Suppr` supprimer, `Ctrl+Z` annuler).
- **Carte du monde** hors ligne : un point par ville, cadrage automatique sur les
  résultats, couleurs du thème actif.
- **Contact direct** (option) : pendant la recherche, une adresse de recrutement est
  cherchée sur le site de chaque entreprise ; `robots.txt` respecté, quatre pages au plus.
- **Candidatures** : lettres, e-mails et réponses de formulaire rédigés par Antigravity à
  partir d'un CV français ou anglais, choisi selon le pays de l'annonce ; envoi SMTP par lot
  après une confirmation unique qui liste chaque destinataire. Le message au contact direct
  dit qu'il vient en plus de la candidature officielle.
- **Outils pour les agents** : le module expose sa recherche en MCP (`search_jobs`,
  `job_details`, `company_contacts`, `read_profile`…), branchée d'un interrupteur.
- Moteur Python embarqué, installé dans son propre environnement au premier usage
  (Python 3.10 ou plus récent requis).

### Ajouté
- **Outils des modules donnés aux agents.** Un module peut déposer un serveur MCP dans
  `<données>/mcp/<module>.json` ; le moteur fusionne ces déclarations et passe
  `--mcp-config` à chaque session Claude. Les outils d'un module branché sont disponibles
  au message suivant, sans commande à taper dans un terminal.
- **Message préparé par un module** : un module peut déposer un texte dans la barre de
  saisie du Chat (`openModule("chat", { prompt })`). Le message est relu et envoyé par la
  personne, jamais automatiquement.
- Accès au stockage protégé de Windows (DPAPI) pour les modules qui ont un secret à garder
  sur la machine.

### Ajouté — Dictée
- **Vumètre dans la barre de saisie** : cinq barres montent avec la voix et l'anneau du
  bouton micro suit le niveau d'entrée. On voit immédiatement si le micro capte quelque chose.
- **Alerte micro muet** : après quatre secondes sans le moindre signal, ARCHIMED nomme le
  périphérique écouté — « Le micro « … » ne capte aucun son » — et renvoie vers
  Paramètres › Son. Windows impose son micro par défaut à la dictée : un casque éteint ou une
  entrée virtuelle donnait une transcription vide, sans explication.
- Le nom du micro écouté apparaît dans l'infobulle du bouton et pendant la dictée (commande
  `engine_dictation_device`).

### Modifié
- **Modules backend découverts automatiquement.** `src-tauri/src/modules/mod.rs` inclut
  désormais un registre généré par `build.rs` à partir des dossiers présents : plus de
  `register!` à écrire, et supprimer un dossier de module ne casse plus la compilation
  (règle d'or n°4). `capabilities/modules.generated.json`, entièrement généré, sort du suivi
  git.

### Corrigé
- **La dictée restait muette sans jamais dire pourquoi.** Trois causes cumulées : la fin de
  session Windows n'était pas écoutée (`Completed`), donc l'écoute s'arrêtait au premier
  silence sans que l'interface le sache ; la contrainte de dictée n'était pas déclarée
  explicitement (`SpeechRecognitionTopicConstraint`) ; et le délai de silence initial
  demandé (10 minutes) dépassait ce que Windows accepte, l'appel échouait en silence et les
  réglages d'usine restaient. La session est maintenant relancée toute seule tant que la
  personne n'a pas cliqué sur « arrêter », et chaque cause d'arrêt (micro indisponible,
  langue absente, accès refusé) devient un message clair.
- **Interfaces sans marges dans un module ignoré par git.** Tailwind ne parcourt pas les
  fichiers que git ignore : un module gardé en local y perdait, sans le moindre
  avertissement, les classes qu'il était seul à utiliser, et ses panneaux se retrouvaient
  tassés contre les bords. Les dossiers de `src/modules` sont maintenant déclarés comme
  sources au démarrage de Vite.
- **`vite.config.ts` sans effet.** `tsc -b` compilait la configuration en
  `vite.config.js` à côté de sa source, et Vite chargeait ce fichier figé plutôt que le
  `.ts` : toute modification de configuration restait lettre morte. La compilation sort
  désormais dans `node_modules/.tmp`.

## [0.2.2] - 2026-09-17

### Ajouté
- **Modèles Claude par niveau d'effort** : chaque modèle n'apparaît plus qu'en trois variantes — effort élevé, moyen ou faible (`--effort`). Défaut : Sonnet · effort moyen.
- **Réglages › Économie de tokens** étendus : effort de réflexion par défaut (Claude et Antigravity), désactivation des skills des CLI (`--disable-slash-commands`), contexte optimisé pour le cache (`--exclude-dynamic-system-prompt-sections`), compactage anticipé à 100 k (`--autocompact`), et relance automatique des réponses coupées désactivable.

### Corrigé — Dictée
- La dictée ne transcrivait rien : le fil n'initialisait pas l'appartement COM/WinRT, et le `SpeechRecognizer` était libéré juste après le démarrage (la session mourait en silence). Arrêt par `CancelAsync` (`StopAsync` bloquait), délais de silence allongés, nouvel événement `dictation:started` pour n'afficher « écoute » qu'une fois le micro ouvert.

### Ajouté — Dictée
- **Bouton micro dans la barre de saisie** (Chat et Code) : la voix est transcrite en direct dans le champ par la reconnaissance vocale de Windows. Tout est local, **aucun token consommé**. Le texte provisoire s'affiche pendant qu'on parle, chaque phrase confirmée s'ajoute au message.

### Ajouté — Planner
- **Titres et notes en Markdown** : le titre d'une carte accepte `**gras**`, `*italique*`, `` `code` ``, `~~barré~~` et les liens (rendu sur une ligne) ; les notes s'écrivent comme un fichier `.md` complet. Édition brute d'un côté, aperçu mis en forme de l'autre ; exports .ics et Google Agenda sans balisage.
- **Glisser-déposer animé** : la carte reste tenue exactement au point où la souris l'a saisie (aucun décalage, pivot au curseur) ; elle **quitte sa colonne** et suit la souris (ressort souple, inclinaison selon la vitesse, agrandissement au-dessus d'une colonne acceptée) ; la colonne survolée ouvre un emplacement d'accueil, et la carte s'y glisse au relâchement. Suivi direct si « animations réduites » est activé.

### Modifié
- **Changement d'agent possible en cours de conversation** : le sélecteur n'est plus grisé une fois la conversation démarrée. Le processus est arrêté, la reprise CLI abandonnée (chaque CLI a ses propres conversations) et une ligne signale que le nouvel agent ne connaît pas les messages précédents.
- **Accueil : grande tuile et colonne « Récemment » à taille généreuse (44 % de la hauteur), puis les modules par rangées de **trois grandes tuiles** ; au-delà, la page défile.
- **Menu latéral** : défilement visible (barre fine, dégradés haut et bas) quand les modules dépassent la hauteur.

## [0.2.1] - 2026-09-17

### Ajouté
- **Économie de tokens (Réglages)** : mode caveman intégré au logiciel (skill embarqué), activable, 3 niveaux (léger, standard, maximal). Appliqué à chaque prompt dans Chat et Code, toutes CLI : règles complètes au premier message d'une conversation, rappel d'une ligne ensuite.

### Modifié
- **Tokens sous chaque réponse** : distinction entre tokens **générés** et **contexte** relu (instructions, outils, skills, historique) avec sa part en cache. L'ancien total unique laissait croire qu'un simple « coucou » coûtait 28 k tokens.

## [0.2.0] - 2026-09-17

### Ajouté — Phase 1 (fondations exécutables)
- Squelette Tauri 2 + React 19 + TypeScript strict + Tailwind v4, packagé par `build.ps1`.
- **Système de modules** : découverte automatique (`module.config.ts` + `import.meta.glob`), validation zod, activation/désactivation, points d'extension (slots, services, commandes, cartes).
- **Backend modulaire** : chaque module = plugin Tauri inline ; `build.rs` génère les permissions et refuse un module non enregistré.
- **Moteur multi-CLI** : `SessionManager`, sessions en tâches tokio, transport structuré NDJSON, `Channel<EngineEvent>` vers le frontend.
- **Adaptateur Claude Code** : protocole de permission `--permission-prompt-tool stdio` (`control_request`/`control_response`) → cartes cliquables.
- **Adaptateur Antigravity (`agy`)** : flux `stream-json`, modèles listés via `agy models`, refus de permission headless remonté explicitement.
- **Policy de risque + Mode Auto** (off / intelligent / complet) ; les actions critiques restent toujours confirmées.
- **Modules** : `home` (launchpad), `chat` (timeline, composer, cartes, terminal brut), `skills` (bibliothèque + jonctions vers les CLI), `settings`.
- **Design system** : tokens OKLCH, typographie Geist, primitives, presets de motion.
- Outillage : `pnpm new:module`, `pnpm check` (types + invariants de modularité), tests Vitest et `cargo test`.

### Ajouté — Conversations, thèmes et Codex
- **Chat multi-conversations** : liste latérale, création, sélection, suppression (double clic de confirmation), persistance locale de l'historique (`archimed.sessions`). Chaque conversation affiche sa date, son modèle et son dossier de travail.
- **Dossier de travail par conversation** : sélecteur dans le composer (dialogue natif), transmis comme `cwd` au processus CLI.
- **Pièces jointes** : ajout de fichiers (PDF, images, documents…) au prompt ; les chemins sont transmis à l'agent et affichés dans la timeline.
- **Adaptateur Codex** (expérimental, `codex exec --json`) : détecté automatiquement s'il est installé.
- **Réglages > Moteur** : état de détection de chaque CLI (version, chemin, modèles), possibilité de désigner l'exécutable d'une CLI hors PATH (persisté dans `engine.json`).
- **Réglages > Thème** : 6 presets (Archimède, Papier, Tokyo Néon, Nord, Terra, Encre) appliqués via `data-theme`.
- **Réglages > Données** : suppression de tout l'historique.
- `pnpm check` impose désormais que chaque module soit listé dans `README.md` et `architecture.md`.

### Ajouté — Module Code
- **Nouveau module `code`** : arborescence de projet (chargement paresseux, dossiers lourds grisés), onglets de fichiers, lecture avec coloration syntaxique via CodeMirror 6 (~35 langages), détection du type de projet.
- **Assistant intégré** au module Code : même moteur et mêmes conversations que le module Chat, panneau repliable.
- **Drag & drop** : un fichier glissé de l'arborescence devient une cible de modification ; des fichiers glissés depuis Windows deviennent des pièces jointes (`useOsFileDrop`).
- **Passage de relais Chat → Code** : quand le dossier de travail est un projet (détecté via le service `code.project`), le chat propose de l'ouvrir dans le module Code.
- **UI de conversation mutualisée** dans `@/core/chat` (`Composer`, `ConversationView`) et `@/core/engine/useChat`.
- **Primitive `Select`** : les menus déroulants suivent enfin le thème de l'application (les `<select>` natifs utilisaient le style du système).

### Corrigé
- **Positionnement du `Select`** : correction du menu déroulant qui flottait trop haut au-dessus du bouton lors de l'ouverture vers le haut (le calcul utilisait une hauteur arbitraire au lieu d'ancrer le bas de la liste au déclencheur via `bottom`).

### Corrigé — Module Code
- **Fond blanc illisible dans l'éditeur** : `@uiw/react-codemirror` appliquait son thème clair par défaut. L'éditeur utilise désormais un thème et une coloration syntaxique branchés sur les tokens (`--color-syntax-*`), qui suivent le preset choisi.
- **Conversations parasites dans le Chat** : ouvrir un dossier ou un fichier dans Code créait une conversation visible dans le module Chat. Les conversations ont maintenant une origine (`chat` | `code`), celles du module Code ne sont créées qu'au premier message et n'apparaissent que dans Code. Migration automatique : les conversations vides créées ainsi sont supprimées.
- **Thème Papier** : le fond restait sombre à cause d'une couleur figée dans `index.html` ; les couleurs sémantiques ont aussi été assombries pour le fond clair.

### Ajouté — Phase 2 (1/3)
- **Édition directe dans le module Code** : modification, indicateur « non enregistré », `Ctrl+S`, écriture atomique côté Rust (`write_file`), fermeture d'un onglet modifié confirmée par un second clic.
- **Palette de fichiers `Ctrl+P`** (branchée sur `search_files`).
- **Rechargement automatique** des fichiers ouverts après chaque outil exécuté par l'assistant.
- **Plusieurs conversations par projet** dans Code (sélecteur + « Nouvelle conversation »).
- **Journal d'audit** `logs/audit.jsonl` : décisions de permission (utilisateur, Mode Auto, policy) et écritures de fichiers, avec rotation à 5 Mo.
- Slot `code.editor.footer`.

### Ajouté — Identité et navigation
- **Logo** : spirale d'Archimède laiton ; icônes de l'application régénérées (`.ico`, `.icns`, PNG).
- **Refonte du cadre** inspirée de la maquette fournie : rail de navigation flottant en verre (logo, groupes, réglages épinglés, replier/déployer), barre de titre intégrée avec recherche et contrôles de fenêtre en pastille, panneau de contenu arrondi, fond ambiant.
- **Accueil en grille bento** : héros, conversations récentes (Chat et Code), tuiles de modules.
- Primitive `Tooltip` aux couleurs du thème ; prise en charge de « transparence réduite ».
- La barre d'état du bas est supprimée ; le slot `statusbar.items` s'affiche dans la barre de titre.

### Ajouté — Module Planner
- **Tableaux multiples** type Trello : colonnes, cartes (échéance, étiquettes, notes, sous-tâches), glisser-déposer, progression, renommage et suppression confirmée.
- **Lien avec un `roadmap.md`** : sections → colonnes, cases → cartes. Cocher une carte réécrit la case dans le fichier ; une modification du fichier (par une IA) resynchronise le tableau via un watcher `notify`. Notes et étiquettes conservées d'une synchronisation à l'autre.
- **Agenda** : « Ajouter à Google Agenda » (lien pré-rempli) et export `.ics` d'un tableau.
- **Suggestions contextuelles** : sous un message de l'IA contenant des tâches ou des dates (slot `chat.message.actions`), et bandeau « Roadmap détectée » dans le module Code (slot `code.editor.footer`).
- Nouvelle catégorie de navigation « Organisation » ; les slots peuvent recevoir un contexte typé (`SlotContext`).

### Ajouté — Phase 2 (2/3 et 3/3)
- **Reprise de contexte** : l'identifiant de conversation de la CLI est mémorisé et repassé au redémarrage (`--resume`, `--conversation`). Changement de modèle à chaud sans perte de contexte.
- **Conversations sur disque** (`sessions/conversations.json`, écriture atomique regroupée), migration automatique depuis le `localStorage`.
- **Transport PTY (ConPTY)** et **Parsing Intelligent à l'écran** : écran virtuel `vt100`, règles TOML génériques (`[Y/n]`, `(o/N)`, « Appuyez sur Entrée », écrasement), menus numérotés ou à curseur, questions ouvertes ; réponse aux requêtes de position du curseur de ConPTY. Vérifié de bout en bout sur un vrai `Read-Host` PowerShell.
- **Adaptateurs déclaratifs** : ajouter n'importe quelle CLI par un fichier TOML dans `%APPDATA%\com.sdai.archimeddapters\` (exemple fourni, bouton « Ajouter une CLI… » dans Réglages › Moteur), avec ses propres règles de questions.

### Corrigé — Antigravity
- **Antigravity ne répondait jamais** : deux erreurs dans l'adaptateur, reproduites puis corrigées sur la CLI réelle (agy 1.2.3).
  - `-p` attend une valeur : placé avant les autres options, il avalait `--input-format` comme prompt (« -p took "--input-format" as its prompt »). Lancement désormais `… --output-format stream-json -p=`.
  - Format des messages : `agy` exige `{"event":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}` (« stream input message is missing the "event" field »).
  - Vérifié : réponse reçue, plusieurs messages enchaînés dans le même processus, même conversation.
- Mode Auto intelligent ou complet : `--mode accept-edits` (modifications de fichiers acceptées sans demande).

### Ajouté — Activité de l'agent et bilan de réponse
- Indicateur en direct façon application Claude : « Réflexion… », « Création de main.rs… », « Exécution de pnpm test… », avec chronomètre.
- Outils regroupés et résumés (« 2 fichiers créés · 2 commandes exécutées »), dépliables pour voir le détail.
- Sous chaque réponse : durée, tokens (entrée, cache, sortie, réflexion en infobulle) et coût estimé.
- Nouveaux événements moteur `Activity`, `TurnCompleted`, `RateLimit` ; registre de consommation `usage/ledger.jsonl` et `usage/limits.json`.

### Ajouté — Module Crédits
- **Limites d'abonnement Claude** : fenêtre de 5 h et semaine glissante (% restant, niveau d'alerte, réinitialisation), abonnement lu via `claude auth status`. Relevées à chaque réponse de Claude, ou à la demande (« Actualiser », message Haiku très court). Vérifié sur le compte réel.
- **Consommation mesurée** par CLI et par jour : réponses, tokens, coût estimé, temps de travail (période 24 h / 7 j / 30 j).
- Antigravity et les CLI TOML ne communiquent pas de quota : seule leur consommation est affichée, et c'est indiqué.

### Corrigé — Permissions Antigravity
- **Plus de refus silencieux** : quand `agy` refuse une action (commande, lecture, écriture), une carte **Autoriser / Toujours autoriser / Refuser** s'affiche, dans tous les Modes Auto (le Mode Auto intelligent ou complet répond seul selon la policy ; les actions critiques restent demandées).
- Autoriser écrit la règle exacte (`command(…)`, `read_file(…)`) dans les réglages d'agy, relance la CLI sur la même conversation et lui demande de reprendre l'action. « Autoriser » retire la règle à la fin du tour ; « Toujours autoriser » la conserve. Chaque règle est journalisée dans l'audit.
- Vérifié sur agy 1.2.3 : une règle ajoutée pendant qu'agy tourne est ignorée, d'où la relance.
- La conversation reste « en attente » si la CLI termine son tour avant la réponse de l'utilisateur.

### Ajouté — Planner : colonnes et calendrier
- Colonnes **renommables et supprimables** (avec leurs cartes, confirmation en deux temps).
- **Vue Calendrier** mensuelle : échéances par jour, glisser-déposer pour planifier ou déplanifier, création de carte datée, bascule Tableau / Calendrier dans l'en-tête.

### Ajouté — Liens de fichiers dans les réponses
- Les chemins cités par l'IA (code en ligne, liens `file://`) deviennent **cliquables** s'ils existent : chemins absolus, relatifs au dossier de travail, ou simples noms de fichiers résolus dans un dossier cité par le même message.
- **Clic** : ouvre le fichier dans le module Code (dossier du projet si le fichier en fait partie). **Clic droit** : menu aux couleurs du thème — ouvrir dans Code, avec l'application par défaut, afficher dans l'Explorateur, copier le chemin.
- Sécurité : un programme (`.exe`, `.bat`, `.ps1`…) n'est jamais lancé depuis un lien, seulement affiché dans l'Explorateur.
- Nouvelle primitive `ContextMenu`, commandes `engine_resolve_paths`, `engine_open_path`, `engine_reveal_path`, service `code.open`.

### Ajouté — Skills dans la barre de chat
- Bouton **Utiliser un skill** dans le composer (Chat et Code) : liste de la bibliothèque avec recherche et clavier, skills activés pour l'agent en premier.
- Claude reçoit la commande native `/nom` ; les autres CLI une consigne pointant le `SKILL.md` du skill.
- Le slot `chat.composer.actions` reçoit désormais `{ cwd, adapter, insertText }`.

### Ajouté — Module Mémoire
- **Journal automatique** : chaque réponse d'IA (Chat et Code) est résumée — demande, résultat, fichiers modifiés, commandes lancées.
- **Notes** globales ou par projet : ajout manuel, bouton « Mémoriser » sous une réponse, ou lignes `📌 Mémoire :` écrites par l'IA.
- **Rappel** : au premier message d'une conversation, les notes et derniers travaux du projet sont transmis à la CLI (3 000 caractères max). Aperçu exact dans le module.
- Réglages : rappel et journal désactivables ; tout est stocké localement.
- Nouveaux points d'extension : slot `app.background`, service `memory.context`.

### Modifié — Mémoire (v0.2)
- La mémoire contient uniquement **ce que vous saisissez** dans le module : informations globales ou par projet, chacune **activable** (transmise aux IA ou mise de côté), modifiables et supprimables. Interrupteur général et aperçu du bloc transmis.
- **Journal automatique retiré** (ainsi que « Mémoriser » sous les réponses et les lignes `📌 Mémoire :`) ; `journal.jsonl` est supprimé au démarrage.

### Corrigé
- **Dossier de travail ignoré par Antigravity** : les fichiers étaient créés ailleurs. agy n'utilise le dossier que s'il lui est passé par `--add-dir` (vérifié sur agy 1.2.3). Changer de dossier en cours de conversation relance aussi la CLI dans le nouveau dossier, contexte conservé.
- **Liens de fichiers menant à `http://tauri.localhost`** : react-markdown effaçait les URL `file:///…` produites par les IA. Elles sont conservées et ouvertes par le lien de fichier ; les liens web s'ouvrent dans le navigateur, jamais dans la fenêtre.
- **Menus trop transparents** (clic droit, palette `Ctrl+K`, listes) : couches flottantes quasi opaques.
- **Barre de saisie** : outils, Mode Auto et envoi alignés sur une seule ligne.

### Ajouté
- **Mémoire : import d'un fichier** (.txt, .md, .json) pour ajouter plusieurs informations d'un coup, avec aperçu, cases à cocher et choix de la portée.
- **Module Code : suppression d'une conversation** (corbeille dans l'en-tête du chat, confirmation par un second clic).
- **Réglages** : mention « Logiciel réalisé par SearaDesign - version - ARCHIMED ».

### Corrigé
- **Tokens Antigravity très surestimés** : agy renvoie en fin de tour un usage **cumulé depuis le début de la conversation**, qui était additionné à chaque réponse. La consommation est maintenant la somme des appels au modèle du tour (vérifié sur agy 1.2.3), et la durée celle du tour. L'historique déjà enregistré dans Crédits garde les anciennes valeurs.
- **Glisser-déposer interne inopérant** (fichier de l'arborescence vers le chat de Code, cartes du Planner) : sous Windows, WebView2 intercepte le drag & drop HTML5 quand le dépôt de fichiers de l'Explorateur est actif. Nouveau glisser-déposer au pointeur (`@/core/dnd`) ; le dépôt depuis l'Explorateur reste disponible.

### Publication
- Projet publié sous **licence MIT** sur GitHub (`Kaylloggs/SDAI-ARCHIMED`).
- `README.md` public en anglais : fonctionnalités, modules, étapes d'installation (prérequis, CLI, clonage, lancement, compilation du `.exe`).

### Ajouté — Aperçu, panneaux et contrôle des réponses
- **Aperçu web** : serveurs de test lancés par l'agent (URL locales citées, `pnpm dev`, `python -m http.server`…, ports sondés toutes les 4 s) et pages HTML créées. Colonne d'aperçu dans le module Code (bouton globe, pastille verte si un serveur répond) ; pastille discrète dans l'en-tête du Chat.
- **Module Code** : panneaux redimensionnables (arborescence, éditeur, aperçu, assistant) ; **arborescence, onglets et aperçu mis à jour automatiquement** quand des fichiers changent sur disque.
- **Bouton Arrêter** (ou `Échap`) pendant que l'agent réfléchit ou répond ; le message suivant reprend la même conversation.
- **Relance automatique** d'une réponse coupée (agent arrêté juste après une action, sans conclure), invisible, 3 fois de suite au plus.

### Corrigé
- **Antigravity s'arrêtait en pleine réponse** : `--print-timeout` d'agy (5 min par défaut) coupait le tour en annonçant un succès. Délai porté à 24 h.
- Texte sans espace (chemins, URL) qui débordait des bulles et des cartes de la conversation.

### Ajouté — Versions et releases
- **Version incrémentée automatiquement à chaque build de release** (`build.ps1`, `patch` par défaut ; `-Bump minor|major|none`) : `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, et datation de la section du CHANGELOG. La version affichée dans Réglages suit.
- `build.ps1 -Publish` : commit de version, tag `vX.Y.Z`, push et release GitHub avec les installeurs (GitHub CLI).
- `pnpm version:bump` pour changer de version sans compiler.

### Connu / à faire (Phase 3)
- Génération des types TS depuis Rust (`ts-rs`) : seuls les codes d'erreur sont générés, les types du moteur sont encore recopiés à la main.
- Envoi natif des images aux CLI qui le supportent (aujourd'hui : chemins transmis à l'agent).
- Validation des flags Codex sur une machine où la CLI est installée ; reprise de contexte Codex (`codex exec resume`).
- Synchronisation bidirectionnelle avec l'API Google Calendar (nécessite un identifiant OAuth Google Cloud fourni par l'utilisateur).
