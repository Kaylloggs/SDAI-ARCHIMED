# ADR 0004 — Mod Studio : téléchargement des JDK depuis l'application

- **Date** : 2026-09-24
- **Statut** : accepté

## Contexte

Chaque famille de versions de Minecraft demande un JDK précis : Java 8 pour Forge 1.14.4–1.16.5,
17 pour 1.17 à 1.20.4, 21 à partir de 1.20.5 (et une version **exacte** pour certains ForgeGradle).
Sans le bon JDK, aucun mod ne compile, et la personne ne sait pas lequel installer ni où le trouver.
Les règles du projet interdisent d'installer un logiciel en silence et de télécharger une dépendance
inconnue.

## Décision

1. **Une seule source, configurable** : l'API d'Adoptium (Eclipse Temurin), remplaçable par
   `modules/mcstudio/env.json` (`adoptiumApi`, HTTPS uniquement). Seules les versions 8, 11, 16, 17,
   21 et 25 sont proposées.
2. **Proposer, jamais imposer** : l'interface affiche l'offre (version, fichier, taille, dossier,
   empreinte) et n'installe qu'après un clic de confirmation. Annulable pendant le téléchargement.
3. **Le backend ne fait pas confiance à l'offre reçue par IPC** : à l'installation, il relit l'offre
   auprès de la source configurée et refuse si l'adresse ou l'empreinte diffèrent.
4. **Vérifier avant d'extraire** : empreinte SHA-256 calculée au fil du téléchargement et comparée à
   celle publiée ; en cas d'écart, l'archive est supprimée. L'extraction (zip ou tar.gz) se fait dans
   un dossier temporaire, refuse tout chemin qui sortirait de ce dossier, puis est renommée dans
   `modules/mcstudio/jdks/<version>/`. Rien n'est écrit ailleurs (ni registre, ni `PATH`, ni
   `JAVA_HOME`).
5. **Traçabilité** : chaque installation (adresse, empreinte, résultat) est inscrite au journal
   d'audit.

## Conséquences

- **Positif** : une personne sans Java peut créer et compiler un mod pour n'importe quelle version
  prise en charge sans quitter l'application.
- **Positif** : les JDK installés restent privés à ARCHIMED et se suppriment avec les données du module.
- **Négatif** : l'empreinte vient de la même source que l'archive ; elle protège contre un fichier
  corrompu ou tronqué, pas contre une source compromise. La source reste donc limitée à HTTPS et
  modifiable seulement par un fichier local.
- **Dépendances** : `zip`, `tar`, `flate2` (décompression), `sha2` (empreinte).
