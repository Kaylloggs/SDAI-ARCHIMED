# ADR 0011 — Terminal intégré et recherche dans le projet (module Code)

- **Date** : 2026-09-26
- **Statut** : accepté

## Contexte

La personne veut, dans le module Code, un terminal et une recherche de texte dans tout le
projet (retrouver un élément dans un projet aux nombreux dossiers). Les deux exécutent ou lisent
beaucoup de choses : il faut fixer ce qui passe par la policy, ce qui tourne où, et ce qui
survit à un changement de module.

## Décisions

### Terminal

1. **Un vrai shell dans un pseudo-terminal**, pas un faux terminal ligne à ligne : PowerShell 7
   (`pwsh.exe`) s'il est installé, sinon Windows PowerShell (toujours présent), sinon `cmd.exe`.
   Il est ouvert dans le dossier du projet, via `portable-pty` (ConPTY sous Windows), déjà utilisé
   par le moteur. Rendu par `@xterm/xterm` + `@xterm/addon-fit`, déjà déclarés dans
   `package.json` : aucune dépendance nouvelle.
2. **Ce qui s'y tape vient de la personne**, comme dans Windows Terminal : ni une IA ni un autre
   module ne peut écrire dans ce terminal (aucun service fourni, aucun slot). Les commandes ne
   passent donc pas par `engine::policy` (guidelines.md §11 vise les actions initiées par l'app ou
   une CLI) ; l'ouverture d'un terminal est inscrite au journal d'audit (`code.terminal_open`).
3. **Flux** : sortie du shell → thread lecteur → décodage UTF-8 par morceaux (un caractère coupé
   entre deux lectures attend la suite) → `Channel<TerminalEvent>` (`output`, `exit`). Frappe →
   commande `terminal_write` → thread écrivain. Fin du shell → thread d'attente. Aucune I/O
   bloquante sur le runtime async.
4. **Durée de vie** : les terminaux vivent dans un registre du module (hors de React). Changer de
   module ne coupe pas un serveur de dev lancé dans le terminal ; masquer le panneau non plus. Un
   terminal s'arrête quand on le ferme, quand on ouvre un autre projet, ou à la fermeture de
   l'application. L'arrêt tue l'arbre de processus (`taskkill /T /F`), mais jamais après la fin
   du shell : son numéro de processus a pu être réattribué.
5. **Couleurs** : le thème de xterm est calculé à partir des tokens du preset actif (convertis en
   sRGB au pixel près, xterm ne lisant pas `oklch`) ; cyan et magenta sont des mélanges
   `color-mix` de tokens existants. Un changement de preset repeint les terminaux ouverts.

### Recherche dans le projet

1. **Côté Rust** (`search_text`), parcours du dossier en sautant les mêmes dossiers que
   l'arborescence (`node_modules`, `target`, `dist`, `.git`…) et tout dossier caché, les fichiers
   binaires (octet nul dans les 8 premiers ko) et ceux de plus de 2 Mo.
2. **Options** : casse, mot entier, expression régulière (crate `regex`, déjà présente ; une
   expression invalide renvoie une erreur lisible). Filtres « inclure » et « exclure » : motifs
   séparés par des virgules, glob (`*.ts`, `**/generated/**`) ou fragment de chemin (`src/`).
3. **Limites** : 2 000 occurrences, 100 lignes listées par fichier, 10 s ; au-delà, le résultat
   est marqué « tronqué » et l'interface demande de préciser. Une nouvelle recherche interrompt la
   précédente (compteur de génération).
4. **Extraits pré-découpés** : chaque ligne arrive en morceaux `{ text, hit }`, coupée autour de la
   première occurrence et sans l'indentation. L'interface n'a aucun index d'octets ou de
   caractères à convertir (UTF-8 côté Rust, UTF-16 côté JavaScript).

## Conséquences

- Un clic sur un résultat ouvre le fichier et sélectionne la ligne (`reveal` de l'éditeur
  partagé, qui attend désormais que CodeMirror ait créé sa vue).
- `ResizeHandle` gagne une orientation horizontale (hauteur du terminal).
- Pas de recherche-remplacement ni de prise en compte de `.gitignore` pour l'instant : à ajouter
  si le besoin apparaît (le crate `ignore` le ferait, au prix d'une dépendance).
