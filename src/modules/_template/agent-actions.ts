import { defineActions } from "@/core/modules";

/**
 * Base de commandes du module : tout ce que la personne peut faire dans le module, un agent
 * (voix, CLI par le serveur MCP d'ARCHIMED) doit pouvoir le faire avec une commande. La base est
 * lue dans ce fichier : une commande ajoutée ici est trouvée par `search_commands` dès la
 * prochaine version, et disparaît avec le module s'il est désactivé ou supprimé. `open`
 * (afficher le module) est ajoutée d'office.
 *
 * Une commande par geste (créer, renommer, supprimer…), nommée en `snake_case`, décrite en une
 * phrase avec les mots que la personne emploierait. `risk` : `read` (lire), `write` (modifier),
 * `destructive` (supprimer, envoyer, payer : confirmation demandée).
 */
export default defineActions([
  {
    name: "get_state",
    description: "Décrit l'état du module __PASCAL__.",
    risk: "read",
    run: async () => ({ ok: true, message: "__PASCAL__ : rien à signaler." }),
  },
]);
