# ADR 0017 — Base de commandes des modules

- **Date** : 2026-09-28
- **Statut** : accepté

## Contexte

L'assistant vocal (ADR 0016) agit dans ARCHIMED par les actions des modules. Deux limites sont
apparues à l'usage :

- les actions couvraient quelques gestes par module : l'agent ne pouvait pas, par exemple,
  modifier une carte du Planner, alors que la personne le fait en deux clics ;
- avec Antigravity, l'agent ne voyait aucun outil d'ARCHIMED : `agy` n'a pas d'option
  `--mcp-config` et ignore la déclaration passée par le moteur.

La personne veut que l'assistant puisse faire **tout ce qu'elle peut faire** dans le logiciel,
avec n'importe quel agent, et que chaque module ait sa propre base de commandes, tenue à jour
automatiquement quand un module est créé ou modifié, et inaccessible quand il est désactivé ou
supprimé.

## Décision

1. **Une base de commandes par module, lue dans son code.** `agent-actions.ts` devient
   obligatoire (vérifié par `pnpm check`, modèle dans `_template`) et doit couvrir tout ce que la
   personne fait dans le module. Le core (`core/modules/commands.ts`) y ajoute `open` (afficher le
   module) et les commandes de la palette qui agissent (`ui_…`). Rien n'est enregistré à la
   main : un module ajouté ou modifié arrive avec ses commandes dans la version compilée.
2. **Seuls les modules actifs.** `loadCommands` ne lit que les modules activés ; un module
   désactivé ou supprimé n'a plus de commandes, ni dans la recherche ni pour `run_action`.
3. **Recherche plutôt que liste complète.** Avec plus de 170 commandes, `list_modules` ne donne
   plus que la vue d'ensemble (noms des commandes) ; le nouvel outil MCP `search_commands`
   (lecture seule) trouve la commande décrite en français ou en anglais : racines, synonymes, nom
   de la commande puis début de sa description. `run_action` la lance (`runCommand` : arguments
   vérifiés, puis `module.data.changed` pour que la page ouverte relise ses données).
4. **Copie sur le disque.** `<données>/commands/<module>.json`, un fichier par module actif,
   réécrit à chaque changement de modules (`core/commands_catalog.rs`, `commands_sync`) ; les
   fichiers des modules désactivés ou supprimés sont effacés.
5. **Antigravity reçoit le serveur MCP d'ARCHIMED** dans sa configuration personnelle
   (`~/.gemini/config/mcp_config.json`, et l'ancien emplacement s'il existe), au format
   `serverUrl` + `headers`, avant chaque lancement ; les serveurs de la personne sont gardés, ceux
   d'ARCHIMED retirés à la fermeture (leur jeton ne vaut plus). En headless, agy refuse tout outil
   MCP non autorisé sans le nommer (impossible d'en faire une carte Autoriser) : la règle
   `mcp(<serveur>/*)` est ajoutée à `permissions.allow` pour les seuls serveurs d'ARCHIMED, et
   retirée avec eux.
6. **Les confirmations restent au serveur d'ARCHIMED.** Une commande `destructive` (supprimer,
   envoyer, payer, lancer une commande dans un terminal, écrire un fichier) demande l'accord de
   la personne, sauf avec l'autonomie « Tout accepter ». Les commandes qui coûtent (génération
   d'image) le disent ; un modèle de texture payant exige l'accord explicite (`allow_paid`).
   Aucune commande ne lit ni n'écrit un identifiant secret (mot de passe d'envoi, clés).

## Conséquences

- Ajouter un geste à l'interface d'un module, c'est ajouter sa commande (guidelines §4.6,
  checklist §4.7) ; `catalog.test.ts` vérifie que chaque module charge une base bien formée et
  que des demandes parlées courantes trouvent la bonne commande.
- Les pages qui lisent leurs données une fois (Mémoire, Skills, Crédits) écoutent
  `module.data.changed` ; les modules à store (Planner, Image Maker, JobAgent, Mod Studio) se
  mettent à jour d'eux-mêmes.
- Les commandes du Chat reçoivent les contrôles des conversations par `ActionContext.chat`
  (fournis par l'appelant, la voix) : pas d'import entre modules.
- Le fichier `mcp_config.json` d'Antigravity est modifié pendant qu'ARCHIMED tourne ; après un
  arrêt brutal, l'entrée `archimed` reste jusqu'au lancement suivant, qui la remplace.
