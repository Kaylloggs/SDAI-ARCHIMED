import { create } from "zustand";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { codeApi, type TerminalEvent } from "../api";

/**
 * Terminaux du module Code. Chaque terminal (xterm + shell côté backend) vit ici, hors de
 * React : changer de module ne coupe pas un serveur de dev lancé dans le terminal. Un
 * terminal se ferme sur demande, ou quand on ouvre un autre projet.
 */

export type TerminalStatus = "starting" | "running" | "exited" | "error";

export type TerminalTab = {
  key: string;
  root: string;
  title: string;
  status: TerminalStatus;
  exitCode: number | null;
  error: string | null;
};

type Runtime = {
  term: Terminal;
  fit: FitAddon;
  /** Élément hôte de xterm, déplacé d'un conteneur à l'autre sans être recréé. */
  host: HTMLDivElement;
  opened: boolean;
  backendId: string | null;
  /** Génération du shell : les événements d'un shell précédent sont ignorés. */
  generation: number;
};

type Store = {
  tabs: TerminalTab[];
  /** Terminal affiché, par projet. */
  active: Record<string, string>;
  set: (key: string, patch: Partial<TerminalTab>) => void;
};

export const useTerminals = create<Store>((set) => ({
  tabs: [],
  active: {},
  set: (key, patch) => set((state) => ({ tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, ...patch } : tab)) })),
}));

const runtimes = new Map<string, Runtime>();
let counter = 0;

/** Ouvre un nouveau terminal pour `root` et le rend actif. */
export function createTerminal(root: string): string {
  counter += 1;
  const key = `t${counter}`;
  const term = new Terminal({
    fontFamily: '"Geist Mono Variable", "Cascadia Code", ui-monospace, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 5000,
    allowProposedApi: false,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const host = document.createElement("div");
  host.className = "h-full w-full";
  const runtime: Runtime = { term, fit, host, opened: false, backendId: null, generation: 0 };
  runtimes.set(key, runtime);

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;
    const ctrl = event.ctrlKey || event.metaKey;
    // Copier la sélection (Ctrl+C sans sélection reste l'interruption du shell).
    if (ctrl && event.key.toLowerCase() === "c" && (event.shiftKey || term.hasSelection())) {
      void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
      term.clearSelection();
      return false;
    }
    // Raccourcis de l'application : laissés à la fenêtre.
    if (ctrl && (event.key === "`" || event.key.toLowerCase() === "p" || (event.shiftKey && event.key.toLowerCase() === "f"))) {
      return false;
    }
    return true;
  });

  term.onData((data) => {
    const tab = useTerminals.getState().tabs.find((t) => t.key === key);
    if (!tab) return;
    if (tab.status === "exited" || tab.status === "error") {
      if (data === "\r") void start(key);
      return;
    }
    if (runtime.backendId) void codeApi.terminalWrite(runtime.backendId, data).catch(() => undefined);
  });
  term.onResize(({ cols, rows }) => {
    if (runtime.backendId) void codeApi.terminalResize(runtime.backendId, cols, rows).catch(() => undefined);
  });

  const count = useTerminals.getState().tabs.filter((tab) => tab.root === root).length;
  useTerminals.setState((state) => ({
    tabs: [
      ...state.tabs,
      { key, root, title: count === 0 ? "Terminal" : `Terminal ${count + 1}`, status: "starting", exitCode: null, error: null },
    ],
    active: { ...state.active, [root]: key },
  }));
  return key;
}

/** Place le terminal dans `container` (le démarre la première fois). */
export function attachTerminal(key: string, container: HTMLElement): void {
  const runtime = runtimes.get(key);
  if (!runtime) return;
  if (runtime.host.parentElement !== container) container.appendChild(runtime.host);
  if (!runtime.opened) {
    runtime.term.open(runtime.host);
    runtime.opened = true;
    // Les polices embarquées doivent être chargées avant de mesurer les cellules.
    void document.fonts.ready.then(() => {
      fitTerminal(key);
      void start(key);
    });
  } else {
    fitTerminal(key);
  }
}

export function fitTerminal(key: string): void {
  const runtime = runtimes.get(key);
  if (!runtime?.opened || !runtime.host.isConnected || runtime.host.clientWidth === 0 || runtime.host.clientHeight === 0) return;
  try {
    runtime.fit.fit();
  } catch {
    // Conteneur en cours de mise en page : la prochaine mesure suffira.
  }
}

export function focusTerminal(key: string): void {
  runtimes.get(key)?.term.focus();
}

export function clearTerminal(key: string): void {
  runtimes.get(key)?.term.clear();
}

/** (Re)lance le shell du terminal, dans le dossier du projet. */
async function start(key: string): Promise<void> {
  const runtime = runtimes.get(key);
  const tab = useTerminals.getState().tabs.find((t) => t.key === key);
  if (!runtime || !tab) return;
  const store = useTerminals.getState();
  const generation = ++runtime.generation;
  store.set(key, { status: "starting", exitCode: null, error: null });
  if (runtime.backendId) {
    void codeApi.terminalClose(runtime.backendId).catch(() => undefined);
    runtime.backendId = null;
    runtime.term.write("\r\n");
  }
  const onEvent = (event: TerminalEvent) => {
    if (generation !== runtime.generation) return;
    if (event.type === "output") {
      runtime.term.write(event.data);
    } else {
      runtime.backendId = null;
      useTerminals.getState().set(key, { status: "exited", exitCode: event.code });
      const code = event.code === null ? "" : ` (code ${event.code})`;
      runtime.term.write(`\r\n\x1b[2mProcessus terminé${code}. Appuyez sur Entrée pour relancer.\x1b[0m\r\n`);
    }
  };
  try {
    const info = await codeApi.terminalOpen(tab.root, runtime.term.cols, runtime.term.rows, onEvent);
    if (generation !== runtime.generation || !runtimes.has(key)) {
      void codeApi.terminalClose(info.id).catch(() => undefined);
      return;
    }
    runtime.backendId = info.id;
    useTerminals.getState().set(key, { status: "running", title: numbered(tab.title, info.shell) });
  } catch (error) {
    const message = (error as { message?: string }).message ?? "Lancement impossible";
    useTerminals.getState().set(key, { status: "error", error: message });
    runtime.term.write(`\x1b[31m${message}\x1b[0m\r\n\x1b[2mAppuyez sur Entrée pour réessayer.\x1b[0m\r\n`);
  }
}

/** « Terminal 2 » + « PowerShell 7 » → « PowerShell 7 (2) ». */
function numbered(title: string, shell: string): string {
  const index = /(\d+)$/.exec(title)?.[1];
  return index ? `${shell} (${index})` : shell;
}

/** Ferme le terminal et arrête ce qui y tourne. */
export function closeTerminal(key: string): void {
  const runtime = runtimes.get(key);
  if (runtime) {
    runtime.generation += 1;
    if (runtime.backendId) void codeApi.terminalClose(runtime.backendId).catch(() => undefined);
    runtime.term.dispose();
    runtime.host.remove();
    runtimes.delete(key);
  }
  useTerminals.setState((state) => {
    const closing = state.tabs.find((tab) => tab.key === key);
    const tabs = state.tabs.filter((tab) => tab.key !== key);
    const active = { ...state.active };
    if (closing && active[closing.root] === key) {
      const next = tabs.filter((tab) => tab.root === closing.root).at(-1);
      if (next) active[closing.root] = next.key;
      else delete active[closing.root];
    }
    return { tabs, active };
  });
}

/** Ouverture d'un autre projet : les terminaux des autres dossiers se ferment. */
export function closeTerminalsOutside(root: string): void {
  for (const tab of useTerminals.getState().tabs) {
    if (tab.root !== root) closeTerminal(tab.key);
  }
}

export function activateTerminal(root: string, key: string): void {
  useTerminals.setState((state) => ({ active: { ...state.active, [root]: key } }));
}

/** Couleurs du thème actif (tokens de design.md), converties en sRGB pour xterm. */
export function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  const mix = (a: string, b: string, weight: number) => `color-mix(in oklab, ${token(a)} ${weight}%, ${token(b)})`;
  const c = (css: string, fallback: string) => toHex(css) ?? fallback;
  const red = c(token("danger"), "#e5484d");
  const green = c(token("success"), "#46a758");
  const yellow = c(token("warning"), "#e5a13a");
  const blue = c(token("info"), "#5b9bd5");
  const magenta = c(mix("danger", "info", 50), "#c678dd");
  const cyan = c(mix("info", "success", 55), "#56b6c2");
  const white = c(token("text-muted"), "#b8bcc6");
  return {
    background: c(token("bg"), "#15161a"),
    foreground: c(token("text"), "#f2f3f5"),
    cursor: c(token("accent"), "#d9a94f"),
    cursorAccent: c(token("bg"), "#15161a"),
    selectionBackground: c(mix("accent", "bg", 32), "#4a4130"),
    black: c(token("surface-3"), "#3a3c44"),
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: c(token("text-subtle"), "#8a8f9a"),
    brightRed: red,
    brightGreen: green,
    brightYellow: c(token("accent"), "#d9a94f"),
    brightBlue: blue,
    brightMagenta: magenta,
    brightCyan: cyan,
    brightWhite: c(token("text"), "#f2f3f5"),
  };
}

/** Applique le thème actif à tous les terminaux (changement de preset). */
export function refreshTerminalThemes(): void {
  const theme = terminalTheme();
  for (const runtime of runtimes.values()) runtime.term.options.theme = theme;
}

let canvas: CanvasRenderingContext2D | null = null;

/** Couleur CSS quelconque (oklch, color-mix…) → `#rrggbb`, lue au pixel près. */
function toHex(css: string): string | null {
  if (!css) return null;
  canvas ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!canvas) return null;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = "#010203";
  canvas.fillStyle = css;
  if (canvas.fillStyle === "#010203") return null;
  canvas.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
