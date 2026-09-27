import { useCallback, useEffect, useRef, useState } from "react";
import { workspaceApi, type GitStatus } from "@/core/engine/workspace.api";

/**
 * État git du dossier de la conversation, relu quand l'agent agit (`revision`), quand son tour
 * se termine et quand la fenêtre revient au premier plan (fichiers modifiés à côté).
 * `undefined` : pas encore lu ; `null` : pas un dépôt git.
 */
export function useGitStatus(cwd: string | null | undefined, revision: number, running: boolean) {
  const [status, setStatus] = useState<GitStatus | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(cwd);
  current.current = cwd;

  const refresh = useCallback(() => {
    if (!cwd) return;
    setLoading(true);
    workspaceApi
      .gitStatus(cwd)
      .then((value) => {
        if (current.current !== cwd) return;
        setStatus(value);
        setError(null);
      })
      .catch((e) => current.current === cwd && setError((e as { message?: string }).message ?? "git indisponible"))
      .finally(() => current.current === cwd && setLoading(false));
  }, [cwd]);

  useEffect(() => {
    setStatus(undefined);
    setError(null);
  }, [cwd]);

  // Relecture groupée : plusieurs actions d'affilée ne lancent qu'un `git status`.
  useEffect(() => {
    const timer = setTimeout(refresh, 400);
    return () => clearTimeout(timer);
  }, [refresh, revision, running]);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return { status: cwd ? status : null, loading, error, refresh };
}
