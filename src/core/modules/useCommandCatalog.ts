import { useEffect } from "react";
import { loadCommands, syncCommandCatalogs } from "./commands";
import { useEnabledModules } from "./useModules";

/**
 * Tient à jour la copie sur le disque de la base de commandes (`<données>/commands/`) : à
 * chaque activation, désactivation ou suppression d'un module, et au démarrage (un module
 * ajouté ou modifié arrive avec une nouvelle version de l'application).
 */
export function useCommandCatalogSync() {
  const modules = useEnabledModules();
  useEffect(() => {
    let cancelled = false;
    // Après le premier affichage : les actions des modules sont chargées à la demande.
    const timer = window.setTimeout(() => {
      void loadCommands(modules).then((entries) => {
        if (!cancelled) void syncCommandCatalogs(entries);
      });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [modules]);
}
