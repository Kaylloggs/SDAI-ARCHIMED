# Module `mcstudio` — Minecraft Mod Studio

Crée, compile et exporte de **vrais** mods Minecraft (Fabric, Forge, NeoForge). Chaque projet est
un dossier Gradle autonome : il se compile aussi sans ARCHIMED (`gradlew build`).

- **Backend** : plugin `mcstudio` (`src-tauri/src/modules/mcstudio/`).
- **Services / slots / événements** : aucun pour l'instant. Le flux de compilation passe par un
  `Channel<BuildEvent>` propre à chaque build.
- **Dépendances ajoutées** : `reqwest` (métadonnées HTTPS des loaders), `png` (textures),
  `trash` (Corbeille, exigée par guidelines §11).

## État des phases

| Phase | Contenu | État |
|---|---|---|
| A | Squelette, types ts-rs, registre des projets | ✓ |
| B | Profils de version, métadonnées officielles, templates, JDK, création | ✓ |
| C | Build Gradle réel, diagnostics, jar dans `dist/`, test e2e | ✓ (e2e à lancer sur une machine avec accès aux dépôts des loaders) |
| D | Explorateur et éditeur (déplacement de `CodeEditor`/`FileTree` vers `core/editor`) | à venir |
| E | Validateur (JSON ligne/colonne, références, assets) et page Diagnostics | à venir |
| F | Snapshots, historique, undo/redo, relecture des diffs | à venir |
| G–I | Agent IA (plan structuré, copie de travail, auto-fix borné), textures décrites par l'IA | à venir |
| J–M | `runClient`/`runServer`, import de projets, audit/portage, export ZIP | à venir |

Rien n'est simulé : un bouton qui n'a pas encore de moteur n'est pas affiché.

## Profils de version

`src-tauri/src/modules/mcstudio/profiles/defaults/*.toml` — un profil par couple loader × plage de
Minecraft :

| Profil | Minecraft | Java | Gradle | Plugin | Mappings | Données |
|---|---|---|---|---|---|---|
| `fabric-1.20` | 1.20 – 1.20.1 | 17+ | 8.14.3 | Loom 1.10-SNAPSHOT | Yarn | `recipes/`, `loot_tables/` |
| `fabric-1.21` | 1.21 – 1.21.1 | 21+ | 8.14.3 | Loom 1.10-SNAPSHOT | Yarn | `recipe/`, `loot_table/` |
| `forge-1.20` | 1.20.1 | **17 exactement** | 8.8 | ForgeGradle `[6.0.16,6.2)` | officiels | `recipes/`, `loot_tables/` |
| `neoforge-1.21` | 1.21.1 | 21+ | 8.14.3 | ModDevGradle `[2.0.0,2.1)` | officiels | `recipe/`, `loot_table/` |

- Les versions exactes du loader, de Yarn et de Fabric API sont **résolues à la création** depuis
  `meta.fabricmc.net`, `maven.fabricmc.net`, `files.minecraftforge.net` et `maven.neoforged.net`,
  puis écrites dans `gradle.properties`. Chaque réponse est gardée dans `cache/meta/` : sans
  réseau, la dernière réponse sert et l'interface l'indique.
- Fabric s'arrête à 1.21.1 : à partir de 1.21.2, objets et blocs exigent une clé de registre et les
  recettes changent de format. Il faut un profil et un template dédiés, vérifiés par une compilation.
- **Corriger un profil sans recompiler** : déposer un `.toml` de même `id` dans
  `%APPDATA%\com.sdai.archimed\modules\mcstudio\profiles\`.
- Ajouter un loader (Quilt…) : une variante de `LoaderId`, un `Dialect` (snippets Java), un
  template dans `templates/files/`, un profil.

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

`list_projects` · `get_project` · `create_project` · `open_project` · `duplicate_project` ·
`remove_project` (retrait de la liste, ou Corbeille) · `version_catalog` · `resolve_versions` ·
`detect_java` · `inspect_java` · `project_java` · `set_project_java` · `project_stats` ·
`default_parent_dir` · `add_item` · `add_block` · `add_recipe` · `build_project` · `cancel_build` ·
`list_builds` · `read_build_log`

## Tests

- `cargo test mcstudio` : profils, parseurs de métadonnées, rendu des templates (tous les profils,
  JSON/TOML valides, aucun marqueur oublié), générateurs, JDK, diagnostics (dont un vrai journal
  NeoForge), exécution réelle d'un processus de build.
- `cargo test mcstudio::e2e -- --ignored --nocapture` : crée **TestMod** (1 objet, 1 bloc, recettes)
  pour chaque profil et le compile vraiment. Affiche `MODULE BASIC PIPELINE = OK` par profil.
  Demande le réseau (Gradle, Minecraft, loader) et les JDK 17 et 21. Filtrer avec
  `MCSTUDIO_E2E_PROFILES=fabric-1.21`.
- `MCSTUDIO_KEEP_TEST_OUTPUT=1 cargo test every_profile_creates` garde les projets générés.
- `pnpm test` : identifiants, assistant, journal.

## Données

| Fichier | Contenu |
|---|---|
| `%APPDATA%\com.sdai.archimed\modules\mcstudio\projects.json` | chemins des projets connus |
| `…\mcstudio\profiles\*.toml` | profils de l'utilisateur (remplacent ceux livrés) |
| `…\mcstudio\cache\meta\` | dernières réponses des métadonnées des loaders |
| `<projet>\.mcstudio\` | identité, historique et journaux de build du projet |
