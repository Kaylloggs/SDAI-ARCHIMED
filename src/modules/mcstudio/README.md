# Module `mcstudio` — Minecraft Mod Studio

Crée, compile et exporte de **vrais** mods Minecraft (Fabric, Forge, NeoForge). Chaque projet est
un dossier Gradle autonome : il se compile aussi sans ARCHIMED (`gradlew build`).

- **Backend** : plugin `mcstudio` (`src-tauri/src/modules/mcstudio/`).
- **Services / slots / événements** : aucun pour l'instant. Le flux de compilation passe par un
  `Channel<BuildEvent>` propre à chaque build.
- **Dépendances ajoutées** : `reqwest` (HTTPS), `png` (textures), `trash` (Corbeille, exigée par
  guidelines §11), `zip`, `tar`, `flate2`, `sha2` (installation vérifiée des JDK), `image`,
  `base64` (images reçues d'OpenRouter), `keyring` (clé API dans le Gestionnaire d'identifiants).

## État des phases

| Phase | Contenu | État |
|---|---|---|
| A | Squelette, types ts-rs, registre des projets | ✓ |
| B | Profils de version, métadonnées officielles, templates, JDK, création | ✓ |
| C | Build Gradle réel, diagnostics, jar dans `dist/`, test e2e | ✓ (Fabric 1.21.1 compilé sur Windows) |
| B+ | 1.14 → 1.21.x, choix des versions du loader, installation des JDK | ✓ (profils hors `fabric-1.21` à valider par l'e2e) |
| T | Textures par IA (OpenRouter, clé de la personne), import d'image, conversion pixel-art, ajout d'objets et de blocs | ✓ (testé contre un faux OpenRouter local) |
| D | Explorateur et éditeur (`CodeEditor`/`FileTree` déplacés dans `core/editor`) | ✓ |
| E | Validateur (JSON/TOML ligne/colonne, références, format de la version) et panneau Problèmes | ✓ |
| F | Snapshots, historique, undo/redo, relecture des diffs | à venir |
| G–I | Agent IA de code via les CLI (plan structuré, copie de travail, auto-fix borné) | à venir |
| J–M | `runClient`/`runServer`, import de projets, audit/portage, export ZIP | à venir |

Rien n'est simulé : un bouton qui n'a pas encore de moteur n'est pas affiché.

## Versions prises en charge

Un **profil** par époque d'API (`src-tauri/src/modules/mcstudio/profiles/defaults/*.toml`) : Java,
Gradle, plugin, mappings, template, dialecte de code et format de données. **1.14 → 1.21.11** pour
Fabric, **1.14.4 → 1.21.5** pour Forge, **1.20.4 → 1.21.11** pour NeoForge.

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

**JDK en gras** : version exacte (les JVM plus récentes cassent Forge). ✓ = validé par une vraie
compilation ; les autres sont marqués « Non vérifié » dans l'assistant jusqu'à leur premier build
réussi (`verified = true` dans le profil). `profiles_cover_every_release_once` garantit qu'aucune
version n'est couverte deux fois et que Fabric les couvre toutes.

**Pas encore pris en charge**, avec la raison affichée dans l'assistant : avant 1.14 (ForgeGradle 1
à 3, Gradle 2 à 4, formats de données différents), Forge 1.21.6+ (EventBus 7), les premières
versions de NeoForge (1.20.2 – 1.20.3), la numérotation 26.x (jeu non obfusqué, chaînes d'outils
refondues) et les snapshots.

- **Choix des versions** : l'assistant (étape Loader) et le tableau de bord (« Changer les
  versions ») listent toutes les versions publiées du loader, de Fabric API (Modrinth, repli sur
  Maven) et de Yarn, la recommandée par défaut. Changer de version réécrit `gradle.properties`,
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

## Textures : IA (OpenRouter) ou image importée

Onglet **Textures** d'un projet : l'icône, les objets et les blocs (présents, ou déclarés sans
texture). « + » ajoute un objet ou un bloc (code, modèles, traductions, loot table, outil de minage)
avec une texture provisoire.

1. **Source** : une description envoyée à un modèle d'image d'OpenRouter, ou un PNG/JPEG/WebP.
   Le texte exact envoyé au modèle est visible avant l'envoi (description cadrée pour Minecraft :
   objet isolé sur fond uni, tuile sans bord pour un bloc).
2. **Clé** : saisie dans l'app, vérifiée par OpenRouter (`/key`) puis rangée dans le Gestionnaire
   d'identifiants de Windows (`mcstudio-openrouter.com.sdai.archimed`). Elle ne revient jamais vers
   l'interface et n'est envoyée qu'à OpenRouter.
3. **Modèles** : lus en direct (`/models`, sortie « image »), gratuits en tête, gardés en cache.
   Un modèle payant est grisé tant que « Autoriser les modèles payants » n'est pas activé, et le
   backend le refuse de même. Les modèles gratuits vont et viennent chez OpenRouter et ont des
   quotas (erreur 429 expliquée).
4. **Conversion** (`pixelart.rs`, déterministe) : fond uni ou en dégradé retiré par remplissage
   depuis les bords, objet cadré, réduction à 16, 32 ou 64 px en gardant par zone une couleur
   franche (la plus rare de l'image quand elle couvre au moins 12 % de la zone : les éclats d'un
   minerai ou un contour survivent), palette limitée par coupe médiane. Une icône est agrandie à
   64 px sans lissage. Changer un réglage reconvertit la même image, sans réseau.
5. **Application** : rien n'est écrit dans le projet avant « Appliquer au projet ». L'ancienne
   texture est copiée dans `.mcstudio/history/textures/<date>-<cible>.png`, la nouvelle écrite de
   façon atomique ; l'action est inscrite au journal d'audit (`mcstudio.texture_apply`), comme
   chaque génération (`mcstudio.texture_generate`) et chaque changement de clé.

Brouillons : `%APPDATA%\com.sdai.archimed\modules\mcstudio\cache\textures\` (30 derniers).
Source remplaçable (HTTPS uniquement) : `{"openrouterApi": "https://…"}` dans `env.json`.
Décision détaillée : [ADR 0005](../../../docs/adr/0005-mcstudio-openrouter-textures.md).

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

`diagnostics.rs` reconnaît : erreurs javac/Kotlin (fichier, ligne), API ou mappings inconnus,
Java incompatible, réseau (dont refus 403/407 d'un proxy), plugin ou dépendance introuvable, JSON
invalide, wrapper endommagé ; sinon le bloc « What went wrong » de Gradle. La cause la plus en
amont passe en premier (sans réseau, les dépendances « introuvables » n'en sont que la conséquence).

> **Sécurité** : un script Gradle est du code exécutable. Compiler un projet exécute ses
> `build.gradle`/`settings.gradle` sur la machine. Les phases IA n'appliqueront jamais
> automatiquement une modification de ces fichiers.

## Commandes Rust

Projets : `list_projects` · `get_project` · `create_project` · `open_project` · `duplicate_project` ·
`remove_project` (retrait de la liste, ou Corbeille) · `project_stats` · `default_parent_dir`
Versions : `version_catalog` · `version_options` · `resolve_versions` · `update_project_versions`
Java : `detect_java` · `inspect_java` · `project_java` · `set_project_java` · `environment` ·
`jdk_offer` · `install_jdk` · `cancel_jdk_install`
Contenu : `add_item` · `add_block` · `add_recipe`
Textures : `openrouter_status` · `set_openrouter_key` · `clear_openrouter_key` · `image_models` ·
`texture_prompt` · `list_textures` · `generate_texture` · `import_texture` · `reprocess_texture` ·
`apply_texture`
Build : `build_project` · `cancel_build` · `list_builds` · `read_build_log`
Fichiers : `list_files` · `read_project_file` · `write_project_file` · `create_project_file` ·
`rename_project_file` · `trash_project_file` · `validate_project`

## Tests

- `cargo test mcstudio` : profils, parseurs de métadonnées, rendu des templates (tous les profils,
  JSON/TOML valides, aucun marqueur oublié), générateurs, JDK, diagnostics (dont un vrai journal
  NeoForge), exécution réelle d'un processus de build, conversion pixel-art (fond, cadrage, détails
  rares, palette), brouillons et historique des textures, client OpenRouter contre un faux serveur
  local (clé, modèles, image en data URL, erreurs 401/429), fichiers (sortie du projet refusée,
  liens symboliques, conflit d'écriture, état interne protégé), validateur (syntaxe localisée,
  formats par version, références cassées ; chaque projet généré passe sans problème).
- `cargo test mcstudio::e2e -- --ignored --nocapture` : crée **TestMod** (1 objet, 1 bloc, recettes)
  pour la version la plus récente de chaque profil et le compile vraiment ; affiche
  `MODULE BASIC PIPELINE = OK (…)` par version et un bilan final. Options :
  `MCSTUDIO_E2E_PROFILES=fabric-1.21,forge-1.20` (filtre), `MCSTUDIO_E2E_ALL=1` (toutes les
  versions de chaque profil), `MCSTUDIO_E2E_INSTALL_JDK=1` (installe les JDK manquants).
- `MCSTUDIO_KEEP_TEST_OUTPUT=1 cargo test every_profile_creates` garde les projets générés.
- `pnpm test` : identifiants, assistant, journal, réglages de texture, choix du modèle, chemins.

## Données

| Fichier | Contenu |
|---|---|
| `%APPDATA%\com.sdai.archimed\modules\mcstudio\projects.json` | chemins des projets connus |
| `…\mcstudio\profiles\*.toml` | profils de l'utilisateur (remplacent ceux livrés) |
| `…\mcstudio\cache\meta\` | dernières réponses des métadonnées des loaders |
| `…\mcstudio\cache\openrouter-models.json` · `cache\textures\` | modèles d'image connus, brouillons de textures |
| `…\mcstudio\jdks\` · `env.json` | JDK installés par Mod Studio, sources remplaçables |
| Gestionnaire d'identifiants Windows | clé OpenRouter (`mcstudio-openrouter.com.sdai.archimed`) |
| `<projet>\.mcstudio\` | identité, historique et journaux de build, anciennes textures (`history/textures/`) |
