# ADR 0014 — Intégrer les modules créés dans le code source

- **Date** : 2026-09-27
- **Statut** : accepté

## Contexte

Une personne qui modifie ARCHIMED (souvent avec l'aide d'une IA) crée ses propres modules dans
`src/modules/<id>/`. Les modules sont compilés dans l'exécutable (ADR 0002) : tant qu'ARCHIMED
n'est pas recompilé, le nouveau module n'existe pas dans l'application qu'elle utilise. Elle veut
un bouton « Mise à jour » d'une autre couleur que celui des versions publiées (ADR 0013), qui
apparaît quand un module qu'elle vient de créer est terminé.

## Options

1. **Surveiller le dossier en continu** (watcher) : réactif, mais un watcher de plus sur un gros
   dépôt (`node_modules`, `target`) et des événements en rafale pendant qu'une IA écrit.
2. **Relire `src/modules/` régulièrement** : une lecture de quelques dossiers toutes les 20 s et au
   retour sur la fenêtre, sans état à maintenir.

## Décision

Option 2, dans le core (`src-tauri/src/core/updater/local.rs`, `src/core/updater/local.ts`,
`LocalUpdateButton.tsx`) :

1. **Dossier suivi** : celui d'où vient le build (`ARCHIMED_SOURCE_DIR`, build `source`), sinon
   celui choisi dans Réglages › Mises à jour, ou inscrit par `pnpm new:module` dans
   `<données>/updater.json`. Il doit ressembler au code d'ARCHIMED (`src/modules/` et
   `tauri.conf.json` avec l'identifiant `com.sdai.archimed`).
2. **Détection** : chaque dossier de `src/modules/` (hors `_*` et `.*`) est comparé à la liste
   des modules compilés (`ARCHIMED_MODULES`). Absent : **nouveau**. Présent mais modifié depuis la
   référence : **modifié**. Référence = date du build quand il vient de ce dossier, sinon date de
   première lecture (gardée dans `updater.json`), pour qu'un clone neuf ne passe pas pour modifié.
3. **« Prêt »** : `module.config.ts` lisible (`id`, `name`), textes du modèle remplacés (« Module
   fraîchement créé », « À implémenter », « Décrire le module en une phrase. »), et aucun fichier
   modifié depuis 30 s (l'IA a fini d'écrire). Les modules en cours sont listés à part.
4. **Pastille bleue** « Mise à jour » (`info`), à gauche de la pastille laiton des releases : les
   modules prêts, ceux en cours, un avertissement si une conversation travaille encore dans ce
   dossier, « Plus tard » (masque jusqu'au prochain changement) et « Intégrer ».
5. **Intégrer** lance `scripts/update-from-source.ps1 -Local` : même chemin que la mise à jour
   d'une version compilée (fusion éventuelle de la dernière release, jamais plus ancienne que la
   version installée ; hors ligne si le code est déjà à jour ; enregistrement des modifications
   demandé seulement quand une fusion est nécessaire), puis recompilation et installation.

## Conséquences

- Aucune dépendance ni tâche de fond supplémentaire ; le coût est une lecture de dossiers.
- Le délai de 30 s évite d'intégrer un module à moitié écrit, mais retarde un peu la pastille.
- La recompilation demande l'environnement de développement (Rust, Node, pnpm) déjà nécessaire
  pour créer un module.
