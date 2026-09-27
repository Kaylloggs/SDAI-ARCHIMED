# ADR 0013 — Mise à jour depuis l'application

- **Date** : 2026-09-27
- **Statut** : accepté

## Contexte

La personne veut qu'ARCHIMED se mette à jour lui-même : un petit bouton, à gauche des boutons de
la fenêtre, qui n'apparaît que lorsqu'une nouvelle version est publiée sur le dépôt GitHub. Les
releases sont publiées par `build.ps1 -Publish` (localement ou par l'action « Release ») avec deux
fichiers : l'installeur NSIS `SDAI.Archimed_<version>_x64-setup.exe` et l'exécutable portable
`SDAI-Archimed.exe`.

## Options

1. **`tauri-plugin-updater`** (officiel) : manifeste `latest.json` et signature minisign de chaque
   fichier. Exige une paire de clés dont la clé privée (et son mot de passe) doit être ajoutée aux
   secrets du dépôt, sans quoi la compilation de release échoue ; ne met pas à jour la version
   portable ; demande de réécrire la publication pour produire `latest.json` et les `.sig`.
2. **Mise à jour maison sur l'API des releases GitHub** : aucune clé à gérer, fonctionne avec les
   releases telles qu'elles sont publiées aujourd'hui (0.7.0 comprise), couvre l'installeur et le
   portable. L'intégrité repose sur l'empreinte SHA-256 que GitHub calcule pour chaque fichier
   publié (champ `digest`), lue en HTTPS sur `api.github.com`.

## Décision

Option 2, dans le core (`src-tauri/src/core/updater.rs`, `src/core/updater/`) :

1. **Vérifier** : `GET /repos/<owner>/<repo>/releases/latest` (dépôt lu dans `Cargo.toml`,
   champ `repository`), 8 s après le démarrage puis toutes les 6 h (loin de la limite de 60
   requêtes par heure de l'API sans compte). Brouillons et préversions ignorés ; versions
   comparées en `x.y.z`. Aucune vérification en build de développement.
2. **Type d'installation** : un `uninstall.exe` à côté de l'exécutable signale l'installeur NSIS ;
   sinon, version portable.
3. **Installer**, uniquement sur clic : l'interface envoie la version affichée, jamais une adresse.
   Le Rust relit la release ; si GitHub publie autre chose, il refuse. Le fichier doit venir de
   `https://github.com/<owner>/<repo>/releases/download/`, peser moins de 400 Mo, et son
   empreinte SHA-256 (calculée au fil du téléchargement) doit égaler le `digest` publié. Sans
   `digest`, pas d'installation automatique : lien vers la page de la release.
   - **Installeur** : téléchargé dans `<données>/updates/`, lancé avec `/P /UPDATE /R` (mode
     passif : barre de progression sans questions ; `/UPDATE` garde les données ; `/R` rouvre
     ARCHIMED). Installation pour tous les utilisateurs : Windows demande l'autorisation (UAC).
   - **Portable** : téléchargé à côté de l'exécutable (`.<nom>.update`), puis l'exécutable en
     cours est renommé en `<nom>.old` (permis par Windows), le nouveau prend sa place et est lancé.
     En cas d'échec, l'ancien est remis en place. Dossier en lecture seule : message et lien.
   - Avant de lancer, les conversations en attente d'écriture sont enregistrées
     (`flushConversations`), puis ARCHIMED se ferme (`AppHandle::exit`).
4. **Version compilée par la personne (avec ses modules)** : les modules sont compilés dans
   l'exécutable (ADR 0002) ; le fichier officiel ne contient donc pas ceux de la personne.
   `build.rs` inscrit l'origine du build : `ARCHIMED_BUILD=official` seulement pour une release
   publiée (`build.ps1 -Publish`, qui pose `ARCHIMED_OFFICIAL_BUILD=1`, y compris dans l'action
   « Release »), sinon `source`, avec le dossier du code (`ARCHIMED_SOURCE_DIR`) et la liste des
   modules compilés (`ARCHIMED_MODULES`). Pour une version `source` :
   - le panneau nomme les modules absents de la version officielle proposée (liste de
     `src/modules/` au tag, via l'API GitHub) ;
   - l'action principale est **« Fusionner et recompiler »** : `scripts/update-from-source.ps1`,
     dans une fenêtre PowerShell visible (la personne suit et répond), ajoute le dépôt officiel
     comme remote si besoin, récupère le tag, propose d'enregistrer les modifications non
     commitées, fusionne le tag, règle seuls les conflits mécaniques
     (`scripts/merge-conflicts.mjs` : numéros de version, CHANGELOG, fichiers de verrouillage
     régénérés ensuite), annule la fusion sans rien changer s'il reste un vrai conflit, puis
     `pnpm install`, `build.ps1 -Bump none`, fermeture propre d'ARCHIMED (`CloseMainWindow`) et
     installation (installeur `/P /UPDATE /R`, ou échange de l'exécutable portable) ;
   - les modules vivent dans leurs propres dossiers et sont découverts sans fichier partagé
     (`build.rs`, `import.meta.glob`) : la fusion ne les touche pas, ni leurs données
     (`<données>/modules/<id>/`), ni leur état (activé, supprimé) ;
   - installer malgré tout le fichier officiel reste possible, après une confirmation qui nomme
     les modules perdus (`replaceSource`, refusé par le Rust sans elle). Leurs données restent et
     reviennent à la prochaine recompilation.
5. **Au démarrage** : `updates/` vidé, `<nom>.old` supprimé (quelques essais, le temps que
   l'ancienne version se ferme).
6. Chaque tentative est inscrite au journal d'audit (`app.update`, `app.update.source`).

## Conséquences

- Aucun secret à ajouter au dépôt ; les releases publiées par `build.ps1` suffisent.
- La confiance repose sur GitHub (HTTPS + empreinte publiée), pas sur une signature propre au
  projet : quelqu'un qui pourrait publier une release sur le dépôt pourrait aussi publier une
  mise à jour. Passer à `tauri-plugin-updater` (signature minisign) reste possible plus tard,
  en gardant cette interface.
- Les exécutables ne sont pas signés (Authenticode) : Windows SmartScreen peut avertir au
  lancement de l'installeur comme au premier téléchargement.
- Recompiler demande les outils de développement (Node, pnpm, Rust, Visual Studio Build Tools),
  déjà présents chez qui a compilé sa version ; `build.ps1` les vérifie et explique ce qui manque.
- Les versions antérieures à celle qui introduit la mise à jour intégrée (0.7.0 et avant) ne
  la voient pas : il faut installer la suivante à la main une dernière fois.
