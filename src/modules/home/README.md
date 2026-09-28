# Module `home`

Écran d'accueil (Launchpad). Génère une tuile par module actif à partir du registre — aucun nom de module en dur.

- **Backend** : aucun.
- **Slots exposés** : `launchpad.widgets`.
- **Services consommés** : aucun.
- **Obligatoire** : oui (`required: true`), non désactivable.

## Commandes pour les agents
`agent-actions.ts` (base de commandes, ADR 0017 ; `open` ajoutée d'office). Reprendre un travail récent (les autres modules s'ouvrent avec leur commande `open`).

`recent_work`, `resume_work`.
