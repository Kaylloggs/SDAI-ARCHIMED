# Module `usage` (Crédits)

Limites d'abonnement restantes et consommation des CLI d'IA.

- **Backend** : plugin `usage` (`src-tauri/src/modules/usage/`), lit le registre tenu par le moteur (`core/usage.rs`).
- **Commandes** : `summary(days)`, `claude_account`, `refresh_claude_limits`.
- **Données** :
  - `%APPDATA%\com.sdai.archimed\usage\ledger.jsonl` — une ligne par réponse (tokens d'entrée, de cache, de sortie, de réflexion, coût estimé, durée), écrite à chaque `TurnCompleted` ;
  - `usage\limits.json` — dernières fenêtres de limite par CLI, écrites à chaque `RateLimit`.

## Ce que chaque CLI expose réellement
| CLI | Quota restant | Source |
|---|---|---|
| Claude Code (abonnement) | **Oui** : fenêtre de 5 h et semaine glissante, en % utilisé + date de réinitialisation | événement `rate_limit_event` du flux ; abonnement via `claude auth status --json` |
| Antigravity | Non communiqué | consommation mesurée par ARCHIMED (tokens par réponse) |
| Codex / CLI TOML | Non communiqué | consommation mesurée quand la CLI fournit des tokens |

« Actualiser » (Claude) envoie un message très court avec le modèle Haiku, car Claude ne donne ses limites qu'au fil d'une requête : cela consomme quelques tokens. Le coût affiché est l'équivalent tarif API calculé par la CLI ; avec un abonnement, il n'est pas facturé en plus.
