import { categorize } from "@/core/chat/activity";
import type { TimelineItem } from "@/core/engine/session.store";

/**
 * Repère, dans une conversation, ce qui peut se prévisualiser :
 * - les serveurs de test (URL locales citées, ports des commandes lancées par l'agent) ;
 * - les pages HTML créées ou modifiées par l'agent.
 * Les ports sont ensuite sondés (`engine_probe_ports`) : seuls les serveurs actifs sont montrés.
 */

export type ServerCandidate = {
  port: number;
  /** URL citée par l'agent (chemin conservé), sinon `http://localhost:<port>/`. */
  url: string;
  /** Port déduit d'une commande de serveur sans port explicite (affiché seulement s'il répond). */
  guessed: boolean;
};

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})(\/[^\s"'`<>)\]]*)?/gi;

/** Commandes qui lancent un serveur de développement ou de fichiers statiques. */
const SERVER_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)|npx\s+(?:vite|serve|http-server|live-server|next)|vite(?:\s|$)|next\s+dev|http-server|live-server|serve\s|python3?\s+-m\s+http\.server|php\s+-S|flask\s+run|uvicorn|rails\s+s|hugo\s+server|jekyll\s+serve|astro\s+dev|webpack(?:-dev-server|\s+serve))/i;

const PORT_FLAGS = [
  /(?:--port|-p)(?:=|\s+)(\d{2,5})\b/i,
  /\bPORT=(\d{2,5})\b/,
  /http\.server\s+(\d{2,5})\b/i,
  /php\s+-S\s+[\w.]+:(\d{2,5})/i,
];

/** Ports par défaut des serveurs courants (Vite, Next, CRA, Angular, Python, Live Server…). */
export const COMMON_DEV_PORTS = [5173, 3000, 4173, 8080, 8000, 4200, 5000, 5500, 4321, 8888];

const HTML_FILE = /\.html?$/i;
const FILE_KEYS = ["file_path", "path", "TargetFile", "AbsolutePath", "notebook_path"];
const COMMAND_KEYS = ["command", "CommandLine", "cmd"];

function field(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function localUrls(text: string): ServerCandidate[] {
  return [...text.matchAll(LOCAL_URL)].flatMap((match) => {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
    return [{ port, url: `http://localhost:${port}${match[2] ?? "/"}`, guessed: false }];
  });
}

/** Serveurs possibles d'une conversation, du plus récent au plus ancien, un par port. */
export function serverCandidates(timeline: TimelineItem[], ignoredPorts: number[] = []): ServerCandidate[] {
  const found: ServerCandidate[] = [];
  let serverLaunched = false;

  for (const item of timeline) {
    if (item.kind === "assistant") {
      found.push(...localUrls(item.text));
    } else if (item.kind === "tool") {
      const command = categorize(item.tool) === "command" ? field(item.input, COMMAND_KEYS) : null;
      if (command) {
        found.push(...localUrls(command));
        const explicit = PORT_FLAGS.map((flag) => flag.exec(command)?.[1]).find(Boolean);
        if (explicit) found.push({ port: Number(explicit), url: `http://localhost:${explicit}/`, guessed: false });
        else if (/python3?\s+-m\s+http\.server/i.test(command)) found.push({ port: 8000, url: "http://localhost:8000/", guessed: false });
        else if (SERVER_COMMAND.test(command)) serverLaunched = true;
      }
      if (item.output) found.push(...localUrls(item.output));
    }
  }

  const byPort = new Map<number, ServerCandidate>();
  for (const candidate of found.reverse()) {
    if (!ignoredPorts.includes(candidate.port) && !byPort.has(candidate.port)) byPort.set(candidate.port, candidate);
  }
  if (serverLaunched) {
    for (const port of COMMON_DEV_PORTS) {
      if (!ignoredPorts.includes(port) && !byPort.has(port)) {
        byPort.set(port, { port, url: `http://localhost:${port}/`, guessed: true });
      }
    }
  }
  return [...byPort.values()];
}

/** Pages HTML créées ou modifiées par l'agent, de la plus récente à la plus ancienne. */
export function htmlFiles(timeline: TimelineItem[]): string[] {
  const files: string[] = [];
  for (const item of timeline) {
    if (item.kind !== "tool" || item.ok === false) continue;
    const category = categorize(item.tool);
    if (category !== "create" && category !== "edit") continue;
    const path = field(item.input, FILE_KEYS);
    if (path && HTML_FILE.test(path)) files.push(path);
  }
  return [...new Set(files.reverse())];
}

export function isHtmlFile(path: string): boolean {
  return HTML_FILE.test(path);
}
