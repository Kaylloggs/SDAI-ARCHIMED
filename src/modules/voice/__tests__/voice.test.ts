import { describe, expect, it } from "vitest";
import { delegationStart, toolLabel } from "../agent/orchestrator";
import { agentName } from "../lib/agents";
import { SentenceChunker } from "../lib/chunker";
import { brainLocation, effectiveSettings, fullyOffline, privacyRows, sttLocation, ttsLocation } from "../lib/privacy";
import { contextPreamble, delegation, languageName } from "../lib/prompt";
import { matchModule, parseConfirmation, route } from "../lib/router";
import { DEFAULT_SETTINGS, normalizeSettings, type VoiceSettings } from "../lib/settings";
import { matches, parseShortcut, shortcutLabel } from "../lib/shortcuts";
import { SpeechQueue, type SpeechItem } from "../lib/speech-queue";
import { busy, statusLabel, statusSentence, waveMode } from "../lib/status";
import { firstSentences, speakable } from "../lib/text";
import { Vad, rms, thresholdFor } from "../lib/vad";
import { concat, encodeWav, resample, toBase64 } from "../lib/wav";

const MODULES = [
  { id: "planner", name: "Planner" },
  { id: "image-maker", name: "Image Maker" },
  { id: "mcstudio", name: "Mod Studio" },
  { id: "code", name: "Code" },
  { id: "chat", name: "Chat" },
];

const settings = (patch: (s: VoiceSettings) => void): VoiceSettings => {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
};

describe("routeur local", () => {
  it("reconnaît les commandes courantes, avec politesse et ponctuation", () => {
    expect(route("Stop !")).toEqual({ type: "stop" });
    expect(route("Tais-toi")).toEqual({ type: "stop" });
    expect(route("attends")).toEqual({ type: "pause" });
    expect(route("vas-y continue")).toEqual({ type: "resume" });
    expect(route("Laisse tomber")).toEqual({ type: "cancel" });
    expect(route("Tu peux répéter ?")).toEqual({ type: "repeat" });
    expect(route("parle plus lentement s'il te plaît")).toEqual({ type: "speed", delta: -0.15 });
    expect(route("plus fort")).toEqual({ type: "volume", delta: 0.15 });
    expect(route("Qu'est-ce que tu fais ?")).toEqual({ type: "status" });
    expect(route("Quelle heure est-il ?")).toEqual({ type: "time" });
    expect(route("Termine la session")).toEqual({ type: "endSession" });
    expect(route("Travaille en mode local")).toEqual({ type: "localMode", on: true });
    expect(route("utilise le modèle local")).toEqual({ type: "brain", brain: "local" });
  });

  it("ouvre un module nommé ou par alias", () => {
    expect(route("Ouvre le Planner", MODULES)).toEqual({ type: "open", module: "planner" });
    expect(route("va dans image maker", MODULES)).toEqual({ type: "open", module: "image-maker" });
    expect(route("ouvre minecraft", MODULES)).toEqual({ type: "open", module: "mcstudio" });
    expect(matchModule("l'éditeur", MODULES)).toBe("code");
    expect(matchModule("le module des licornes", MODULES)).toBeNull();
  });

  it("change d'agent", () => {
    expect(route("utilise Codex")).toEqual({ type: "agent", adapter: "codex" });
    expect(route("passe sur Claude Code")).toEqual({ type: "agent", adapter: "claude" });
  });

  it("laisse le reste à l'agent, texte d'origine intact", () => {
    expect(route("Ouvre le fichier main.rs et explique-le", MODULES)).toEqual({ type: "ask", text: "Ouvre le fichier main.rs et explique-le" });
    expect(route("Stop la compilation du mod")).toEqual({ type: "ask", text: "Stop la compilation du mod" });
  });

  it("comprend les confirmations", () => {
    expect(parseConfirmation("Oui")).toBe("yes");
    expect(parseConfirmation("ok vas-y")).toBe("yes");
    expect(parseConfirmation("oui toujours")).toBe("always");
    expect(parseConfirmation("Non merci")).toBe("no");
    expect(parseConfirmation("annule")).toBe("no");
    expect(parseConfirmation("peut-être plus tard")).toBeNull();
  });
});

describe("texte parlé", () => {
  it("retire le Markdown, les liens et le code", () => {
    const text = speakable("## Titre\n- **Point** un\n- `fichier.ts` modifié\n```ts\nconst a = 1;\n```\nVoir [la doc](https://x.y) ou https://a.b/c 🎉");
    expect(text).not.toMatch(/[#*`]|https?:|🎉/);
    expect(text).toContain("Point un");
    expect(text).toContain("fichier.ts modifié");
    expect(text).toContain("code affiché à l'écran");
    expect(text).toContain("la doc");
  });

  it("dit les unités en toutes lettres et remplace les parenthèses par des pauses", () => {
    expect(speakable("Il fait 18°C (ressenti 16 °C), 40 % d'humidité, vent à 20 km/h.")).toBe(
      "Il fait 18 degrés, ressenti 16 degrés, 40 pour cent d'humidité, vent à 20 kilomètres heure.",
    );
    expect(speakable("It's 64°F & sunny (light wind).", "en-US")).toBe("It's 64 degrees Fahrenheit and sunny, light wind.");
    expect(speakable("Build → OK")).toBe("Build, OK");
  });

  it("résume en quelques phrases", () => {
    expect(firstSentences("Un. Deux ! Trois ? Quatre.", 2)).toBe("Un. Deux !");
    expect(firstSentences("a".repeat(400), 1, 50)).toHaveLength(50);
  });
});

describe("découpe en phrases", () => {
  it("rend une phrase dès qu'elle est complète", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("Bonjour, je regarde le fichier ")).toEqual([]);
    expect(chunker.push("main.rs maintenant. Ensuite je")).toEqual(["Bonjour, je regarde le fichier main.rs maintenant."]);
    expect(chunker.flush()).toEqual(["Ensuite je"]);
  });

  it("ne coupe pas sur les abréviations ni dans un bloc de code", () => {
    const chunker = new SentenceChunker();
    expect(chunker.push("Voici la réponse de M. Dupont sur le sujet. ")).toEqual(["Voici la réponse de M. Dupont sur le sujet."]);
    expect(chunker.push("```js\nconst x = 1. Encore.\n")).toEqual([]);
  });

  it("coupe une phrase trop longue à la virgule", () => {
    const chunker = new SentenceChunker(24, 80);
    const pieces = chunker.push(`${"mot ".repeat(15)}, ${"suite ".repeat(15)}`);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces[0]!.length).toBeLessThanOrEqual(80);
  });
});

describe("file de parole", () => {
  const item = (id: string, priority: SpeechItem["priority"], kind: SpeechItem["kind"] = "notice", queuedAt = 0): SpeechItem => ({
    id,
    text: id,
    priority,
    kind,
    queuedAt,
  });

  it("ordonne par priorité, critical coupe la parole", () => {
    const queue = new SpeechQueue();
    expect(queue.add(item("a", "normal", "reply"))).toBe(false);
    expect(queue.add(item("b", "high"))).toBe(false);
    expect(queue.add(item("c", "critical"))).toBe(true);
    expect([queue.next(false, 0)?.id, queue.next(false, 0)?.id, queue.next(false, 0)?.id]).toEqual(["c", "b", "a"]);
  });

  it("les annonces basses attendent un moment calme et expirent", () => {
    const queue = new SpeechQueue();
    queue.add(item("low", "low", "notice", 0));
    expect(queue.next(true, 1000)).toBeNull();
    expect(queue.next(false, 1000)?.id).toBe("low");
    queue.add(item("old", "low", "notice", 0));
    expect(queue.next(false, 120_000)).toBeNull();
  });

  it("garde au plus trois annonces basses et oublie les réponses interrompues", () => {
    const queue = new SpeechQueue();
    for (const id of ["1", "2", "3", "4"]) queue.add(item(id, "low"));
    expect(queue.list().map((i) => i.id)).toEqual(["2", "3", "4"]);
    queue.add(item("r", "normal", "reply"));
    queue.dropReplies();
    expect(queue.list().some((i) => i.kind === "reply")).toBe(false);
  });
});

describe("détection de la parole", () => {
  it("démarre après une parole assez longue et finit après un silence", () => {
    const vad = new Vad({ threshold: 0.02, minSpeechMs: 60, endSilenceMs: 100, maxUtteranceMs: 10_000 });
    expect(vad.push(0.5, 20).type).toBe("none");
    expect(vad.push(0.5, 20).type).toBe("none");
    expect(vad.push(0.5, 20).type).toBe("start");
    for (let i = 0; i < 4; i += 1) expect(vad.push(0, 20).type).toBe("none");
    const end = vad.push(0, 20);
    expect(end).toEqual({ type: "end", durationMs: 160 });
  });

  it("ignore un clic isolé", () => {
    const vad = new Vad({ threshold: 0.02, minSpeechMs: 60, endSilenceMs: 100, maxUtteranceMs: 10_000 });
    vad.push(0.5, 20);
    vad.push(0, 20);
    vad.push(0.5, 20);
    expect(vad.active).toBe(false);
  });

  it("calcule le niveau et le seuil", () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(thresholdFor(1)).toBeLessThan(thresholdFor(0));
    expect(thresholdFor(5)).toBe(thresholdFor(1));
  });
});

describe("audio", () => {
  it("écrit un WAV 16 bits mono valide", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });

  it("ré-échantillonne et assemble", () => {
    expect(resample(new Float32Array(48_000), 48_000, 16_000)).toHaveLength(16_000);
    expect(Array.from(resample(new Float32Array([1, 3, 5, 7]), 4, 2))).toEqual([2, 6]);
    expect(Array.from(concat([new Float32Array([1]), new Float32Array([2, 3])]))).toEqual([1, 2, 3]);
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });
});

describe("confidentialité", () => {
  it("dit où passe chaque étape", () => {
    expect(sttLocation(DEFAULT_SETTINGS)).toBe("local");
    expect(ttsLocation(DEFAULT_SETTINGS)).toBe("local");
    expect(brainLocation(DEFAULT_SETTINGS)).toBe("cloud");
    expect(sttLocation(settings((s) => (s.stt.engine = "openai")))).toBe("cloud");
    expect(sttLocation(settings((s) => ((s.stt.engine = "custom"), (s.stt.baseUrl = "http://127.0.0.1:8000/v1"))))).toBe("local");
    expect(sttLocation(settings((s) => ((s.stt.engine = "custom"), (s.stt.baseUrl = "https://api.example.com/v1"))))).toBe("cloud");
    expect(privacyRows(DEFAULT_SETTINGS, "Claude Code").map((r) => r.location)).toEqual(["local", "local", "cloud", "local"]);
  });

  it("hors ligne complet seulement si tout est local", () => {
    expect(fullyOffline(DEFAULT_SETTINGS)).toBe(false);
    expect(fullyOffline(settings((s) => (s.agent.brain = "local")))).toBe(true);
  });

  it("le mode local remplace les moteurs en ligne sans toucher aux réglages enregistrés", () => {
    const saved = settings((s) => ((s.stt.engine = "groq"), (s.tts.engine = "elevenlabs"), (s.privacy.localOnly = true)));
    const effective = effectiveSettings(saved);
    expect(effective.stt.engine).toBe("windows");
    expect(effective.tts.engine).toBe("system");
    expect(saved.stt.engine).toBe("groq");
    expect(effectiveSettings(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
  });
});

describe("réglages", () => {
  it("complète un fichier ancien ou abîmé", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    // L'ancien mode « mot d'éveil » n'existe plus : retour à l'ouverture au clic.
    expect(normalizeSettings({ general: { mode: "wake" } }).general.mode).toBe("toggle");
    expect(normalizeSettings({ general: { mode: "push" } }).general.mode).toBe("push");
    const merged = normalizeSettings({ general: { language: "en-US", mode: 42 }, tts: { voice: "alloy", speed: "vite" }, unknown: { a: 1 } });
    expect(merged.general.language).toBe("en-US");
    expect(merged.general.mode).toBe(DEFAULT_SETTINGS.general.mode);
    expect(merged.tts.voice).toBe("alloy");
    expect(merged.tts.speed).toBe(DEFAULT_SETTINGS.tts.speed);
    expect(merged.overlay).toEqual(DEFAULT_SETTINGS.overlay);
    expect("unknown" in merged).toBe(false);
  });
});

describe("raccourcis", () => {
  it("lit et compare une combinaison", () => {
    const shortcut = parseShortcut("Ctrl+Shift+Space");
    expect(shortcut).toEqual({ ctrl: true, shift: true, alt: false, meta: false, key: " " });
    expect(matches(shortcut, { key: " ", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe(true);
    expect(matches(shortcut, { key: " ", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe(false);
    expect(matches(parseShortcut("Alt+V"), { key: "v", ctrlKey: false, shiftKey: false, altKey: true, metaKey: false })).toBe(true);
    expect(shortcutLabel("Ctrl+Shift+Space")).toEqual(["Ctrl", "Maj", "Espace"]);
  });
});

describe("agent", () => {
  it("détecte la délégation du modèle local sans lire le préfixe", () => {
    expect(delegationStart("")).toBeNull();
    expect(delegationStart("DEL")).toBeNull();
    expect(delegationStart("DÉLÉGUER: crée le projet")).toBe("delegate");
    expect(delegationStart("Bonjour !")).toBe("speak");
    expect(delegation("DELEGUER: crée le tableau Roadmap")).toBe("crée le tableau Roadmap");
    expect(delegation("déléguer : lance les tests")).toBe("lance les tests");
    expect(delegation("Il fait beau.")).toBeNull();
  });

  it("nomme les outils de façon lisible", () => {
    expect(toolLabel("Read", {})).toBe("lecture");
    expect(toolLabel("mcp__archimed__run_action", { module: "planner", action: "add_tasks" })).toBe("planner · add_tasks");
    expect(toolLabel("mcp__archimed__open_module", { module: "code" })).toBe("ouvrir code");
    expect(toolLabel("OutilInconnu", {})).toBe("OutilInconnu");
    expect(agentName("claude")).toBe("Claude Code");
    expect(agentName("autre")).toBe("autre");
  });

  it("résume le contexte de l'écran", () => {
    const preamble = contextPreamble(
      {
        activeModule: "code",
        modules: {
          code: { project: { name: "boutique", path: "C:/p/boutique" }, file: "src/cart.ts", details: { unsaved: true } },
          planner: { object: { type: "tableau", name: "Roadmap" } },
        },
      },
      { code: "Code", planner: "Planner" },
    );
    expect(preamble).toContain("Module affiché : Code.");
    expect(preamble).toContain("projet « boutique » (C:/p/boutique)");
    expect(preamble).toContain("fichier src/cart.ts");
    expect(preamble).toContain("Aussi ouvert : planner — tableau sélectionné : Roadmap");
    expect(languageName("fr-CA")).toBe("français");
  });
});

describe("état de la pastille", () => {
  it("associe une vague, un libellé et une phrase à chaque état", () => {
    expect(waveMode("listening")).toBe("input");
    expect(waveMode("hearing")).toBe("input");
    expect(waveMode("speaking")).toBe("output");
    expect(waveMode("thinking")).toBe("busy");
    expect(waveMode("off")).toBe("rest");
    expect(statusLabel("tool", "lecture")).toBe("Lecture");
    expect(statusSentence("tool", "commande")).toContain("commande");
    expect(busy("speaking")).toBe(true);
    expect(busy("listening")).toBe(false);
  });
});
