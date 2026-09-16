import { useEffect, useMemo, useState } from "react";
import { useEnabledModules } from "./useModules";

/**
 * Services : capacités qu'un module expose aux autres (couplage faible).
 * Un consommateur DOIT gérer l'absence du service (module désactivé/supprimé).
 */
export function useServiceAvailable(name: string): boolean {
  const modules = useEnabledModules();
  return useMemo(() => modules.some((m) => m.provides?.[name]), [modules, name]);
}

/**
 * Charge un service à la demande. Retourne `undefined` tant qu'il n'est pas
 * disponible (ou si aucun module actif ne le fournit).
 */
export function useService<T>(name: string): T | undefined {
  const modules = useEnabledModules();
  const [service, setService] = useState<T>();

  const provider = useMemo(
    () => modules.find((m) => m.provides?.[name])?.provides?.[name],
    [modules, name],
  );

  useEffect(() => {
    let cancelled = false;
    if (!provider) {
      setService(undefined);
      return;
    }
    void provider().then((module) => {
      if (!cancelled) setService(module as T);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  return service;
}
