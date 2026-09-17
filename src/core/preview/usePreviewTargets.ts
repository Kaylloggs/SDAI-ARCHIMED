import { useEffect, useMemo, useState } from "react";
import { engineApi } from "@/core/engine/engine.api";
import type { TimelineItem } from "@/core/engine/session.store";
import { htmlFiles, serverCandidates } from "./detect";

export type PreviewTarget =
  | { kind: "server"; id: string; label: string; url: string; port: number }
  | { kind: "file"; id: string; label: string; path: string };

const PROBE_INTERVAL = 4000;

/** Port de l'interface d'ARCHIMED en développement (`pnpm tauri dev`) : jamais proposé. */
function ownPorts(): number[] {
  const port = Number(window.location.port);
  return Number.isInteger(port) && port > 0 ? [port] : [];
}

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * Ce qui peut être prévisualisé dans une conversation : serveurs de test **actifs**
 * (sondés toutes les 4 s tant que le composant est affiché) et pages HTML écrites par l'agent.
 * `extraFiles` : pages à ajouter (ex. fichier HTML ouvert dans l'éditeur).
 */
export function usePreviewTargets(timeline: TimelineItem[] | undefined, extraFiles: string[] = []): PreviewTarget[] {
  const candidates = useMemo(() => serverCandidates(timeline ?? [], ownPorts()), [timeline]);
  const portsKey = candidates.map((c) => c.port).join(",");
  const [livePorts, setLivePorts] = useState<number[]>([]);

  useEffect(() => {
    if (!portsKey) {
      setLivePorts([]);
      return;
    }
    const ports = portsKey.split(",").map(Number);
    let cancelled = false;
    const probe = () => {
      if (document.visibilityState === "hidden") return;
      engineApi
        .probePorts(ports)
        .then((live) => {
          if (!cancelled) setLivePorts((current) => (current.join(",") === live.join(",") ? current : live));
        })
        .catch(() => undefined);
    };
    probe();
    const timer = setInterval(probe, PROBE_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [portsKey]);

  const extraKey = extraFiles.join("\n");
  return useMemo(() => {
    const servers: PreviewTarget[] = candidates
      .filter((candidate) => livePorts.includes(candidate.port))
      .map((candidate) => ({
        kind: "server",
        id: `server:${candidate.port}`,
        label: `localhost:${candidate.port}`,
        url: candidate.url,
        port: candidate.port,
      }));
    const paths = [...new Set([...(extraKey ? extraKey.split("\n") : []), ...htmlFiles(timeline ?? [])])];
    const files: PreviewTarget[] = paths.map((path) => ({ kind: "file", id: `file:${path}`, label: fileName(path), path }));
    return [...servers, ...files];
  }, [candidates, livePorts, timeline, extraKey]);
}
