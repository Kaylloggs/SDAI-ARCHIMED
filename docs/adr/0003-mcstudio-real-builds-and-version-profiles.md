# ADR 0003 — Mod Studio : builds réels, profils de version, copie de travail pour l'IA

- **Date** : 2026-09-24
- **Statut** : accepté (volets 1 et 2 livrés ; volet 3 pour les phases IA)

## Contexte

Le module `mcstudio` doit produire des mods Minecraft réellement compilables pour Fabric, Forge et
NeoForge. Les API de Minecraft, les loaders, leurs plugins Gradle et le format des fichiers de
données changent d'une version à l'autre ; une liste de versions écrite en dur vieillit en quelques
semaines. L'IA, elle, se trompe d'API d'une version à l'autre.

## Décision

1. **Profils de version en données** (`profiles/defaults/*.toml`, surchargeables par l'utilisateur) :
   plage de Minecraft, Java, Gradle, plugin, mappings, template, dialecte de code, format de données.
   Les versions exactes (loader, Yarn, Fabric API) sont lues à la création dans les métadonnées
   officielles, avec un cache pour le hors-ligne. Une version sans profil est « non prise en charge ».
2. **Le build réel fait foi** : le projet embarque le Gradle Wrapper ; ARCHIMED lance `gradlew` avec
   le JDK du profil et ne déclare un succès que sur un code de sortie 0 et un jar écrit par Gradle.
   Le squelette et le contenu courant (objets, blocs, recettes) viennent de générateurs
   déterministes, pas de l'IA.
3. **Copie de travail pour l'IA (phases à venir)** : l'agent travaillera avec ses propres outils dans
   une copie du projet (`.mcstudio/work/<tour>/`) ; ARCHIMED calcule le diff, la personne l'applique
   fichier par fichier, après un snapshot. Cela fonctionne avec toutes les CLI (Claude, Antigravity,
   Codex) sans protocole propre, et le projet réel n'est jamais modifié sans relecture.

## Conséquences

- **Positif** : ajouter une version = un profil (et un template si l'API change), vérifié par le test
  e2e ; aucune recompilation pour corriger une version de plugin.
- **Positif** : les erreurs de l'IA seront attrapées par une vraie compilation, pas supposées absentes.
- **Négatif** : la première compilation télécharge plusieurs centaines de Mo (Gradle, Minecraft,
  mappings) ; le test e2e demande le réseau vers les dépôts des loaders.
- **Négatif** : compiler exécute les scripts Gradle du projet ; un `build.gradle` modifié par l'IA
  devra toujours passer par une relecture humaine.
- **Dépendances** : `reqwest` (HTTP), `png` (textures), `trash` (Corbeille).
