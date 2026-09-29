// Captures de l'application réelle (Vite + IPC simulé) pour la vidéo /brag.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";

const OUT = new URL("./shots/", import.meta.url).pathname;
const now = Date.now();
const D = 864e5;
const day = (n) => new Date(now + n * D).toISOString().slice(0, 10);
const friday = (() => { const d = new Date(now); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); })();

const adapters = [
  { id: "claude", name: "Claude Code", installed: true, version: "2.1.281", binaryPath: "claude", transport: "structured", models: [{ id: "claude-opus-5-5", label: "Opus 5.5", efforts: [] }], defaultModel: null, accent: "claude", hint: null },
  { id: "antigravity", name: "Antigravity", installed: true, version: "1.2.3", binaryPath: "agy", transport: "structured", models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", efforts: [] }], defaultModel: null, accent: "antigravity", hint: null },
  { id: "codex", name: "Codex", installed: true, version: "0.9.0", binaryPath: "codex", transport: "structured", models: [], defaultModel: null, accent: "neutral", hint: null },
];
const card = (id, columnId, title, extra = {}) => ({ id, columnId, title, notes: "", due: null, labels: [], done: false, createdAt: now, ...extra });
const board = (withNew) => ({
  id: "b1", name: "Lancement de l'application", createdAt: now - 20 * D, updatedAt: now, roadmapPath: null, projectRoot: null, lastSync: null,
  columns: [{ id: "c1", title: "À faire" }, { id: "c2", title: "En cours" }, { id: "c3", title: "Terminé" }],
  cards: [
    ...(withNew
      ? [
          card("n1", "c1", "Écrire le communiqué de presse", { due: friday, labels: ["com"] }),
          card("n2", "c1", "Préparer la démo vidéo", { labels: ["com"] }),
          card("n3", "c1", "Publier la version 1.0", { due: day(10), labels: ["release"] }),
          card("n4", "c1", "Annoncer sur les réseaux", { labels: ["com"] }),
        ]
      : []),
    card("k3", "c2", "Mode sombre", { labels: ["design"], due: day(2), subtasks: [{ title: "Bouton", done: true }, { title: "Couleurs", done: true }, { title: "Tests", done: false }] }),
    card("k4", "c2", "Formulaire de contact", { labels: ["dev"], due: day(4) }),
    card("k6", "c3", "Nom de domaine", { done: true, labels: ["admin"] }),
    card("k7", "c3", "Maquette de l'accueil", { done: true, labels: ["design"] }),
  ],
});
const boards = (withNew) => [board(withNew), { id: "b2", name: "Recherche de stage", createdAt: now, updatedAt: now, roadmapPath: null, projectRoot: null, lastSync: null, columns: [{ id: "d1", title: "À postuler" }], cards: [] }];

const init = ({ adapters, boards, module }) => {
  localStorage.setItem("archimed.ui", JSON.stringify({ state: { activeModuleId: module, sidebarCollapsed: false }, version: 0 }));
  localStorage.setItem("archimed.planner.view", "board");
  let n = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: (cb) => { const id = n++; window["_" + id] = cb; return id; },
    unregisterCallback: () => {}, convertFileSrc: (p) => p,
    invoke: async (cmd) => {
      if (cmd === "engine_list_adapters") return adapters;
      if (cmd === "engine_load_conversations") return null;
      if (cmd === "engine_default_cwd") return "C:\\Projets";
      if (cmd === "updater_check") return { current: "0.14.0", kind: "installer", source: null, releasesUrl: "", available: null };
      if (cmd === "updater_local_status") return { sourceDir: null, configured: false, valid: false, modules: [], quietMs: 30000 };
      if (cmd === "plugin:planner|load_boards") return boards;
      if (cmd === "commands_sync") return 13;
      if (cmd === "plugin:voice|voice_list_sessions") return [];
      if (cmd === "plugin:voice|voice_mcp_info") return { running: true, url: "", config: null, tools: [], calls: 0 };
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const boxes = {};
const shot = async (name, { module = "planner", withNew = false, voice = null } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(init, { adapters, boards: boards(withNew), module });
  await page.goto("http://localhost:1420/"); await page.waitForTimeout(7000);
  if (voice) {
    await page.evaluate(async (voice) => {
      const { useVoiceStore, meter } = await import("/src/modules/voice/store.ts");
      const { orchestrator } = await import("/src/modules/voice/runtime/instance.ts");
      orchestrator();
      meter.input = voice.level; meter.output = () => voice.level;
      useVoiceStore.getState().patch({ status: voice.status, micOn: true, liveOpen: false, caption: voice.caption ?? "", partial: voice.partial ?? "" });
    }, voice);
  }
  await page.waitForTimeout(1500);
  await page.mouse.move(1910, 1070);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}${name}.png` });
  // Repères : cartes, colonnes, pastille vocale et sous-titres.
  boxes[name] = await page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const out = { cards: {}, columns: [], pill: null };
    for (const el of document.querySelectorAll("button, div, li")) {
      const t = el.textContent?.trim() ?? "";
      if (el.children.length > 0 && /^(Écrire le communiqué|Préparer la démo|Publier la version|Annoncer sur)/.test(t) && el.getBoundingClientRect().height < 120 && el.getBoundingClientRect().height > 40) out.cards[t.slice(0, 18)] = rect(el);
    }
    const pill = document.querySelector('[aria-label*="conversation vocale"]')?.closest("div");
    if (pill) out.pill = rect(pill);
    return out;
  });
  console.log(name, JSON.stringify(errors.slice(0, 3)));
  await page.close();
};

await shot("planner-before", { withNew: false, voice: { status: "hearing", level: 0.55, partial: "Ajoute les quatre étapes du lancement à ma roadmap" } });
await shot("planner-after", { withNew: true, voice: { status: "speaking", level: 0.5, caption: "C'est fait : quatre cartes ajoutées au tableau Lancement, la première échéance est vendredi." } });
await shot("planner-clean", { withNew: true });
await shot("home", { module: "home" });
writeFileSync(`${OUT}boxes.json`, JSON.stringify(boxes, null, 2));
await browser.close();
