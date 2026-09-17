import { useCallback, useEffect, useState } from "react";
import { engineApi } from "./engine.api";
import type { AdapterInfo } from "./types";

/** Détection des CLI installées. Partagé par le chat et les réglages → vit dans le core. */
export function useAdapters() {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback((force = false) => {
    setLoading(true);
    return engineApi
      .listAdapters(force)
      .then((list) => {
        setAdapters(list);
        setError(null);
      })
      .catch((e: { message?: string }) => setError(e.message ?? "Erreur inconnue"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  return { adapters, error, loading, refresh };
}
