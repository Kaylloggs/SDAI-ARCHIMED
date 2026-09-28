import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { bus, type VoicePriority } from "@/core/bus/event-bus";
import { currentContext } from "@/core/context";
import { engineApi } from "@/core/engine/engine.api";
import { useSessionStore, type ChatSession, type TimelineItem } from "@/core/engine/session.store";
import type { useChat } from "@/core/engine/useChat";
import type { LoadedModule } from "@/core/modules";
import { useUiStore } from "@/core/stores/ui.store";
import { Channel, voiceApi, type LocalChatEvent } from "../api";
import { AudioPlayer, earcon } from "../audio/player";
import { createStt, type SttSession } from "../engines/stt";
import { createTts, type TtsEngine } from "../engines/tts";
import { agentName } from "../lib/agents";
import { SentenceChunker } from "../lib/chunker";
import { effectiveSettings } from "../lib/privacy";
import { cliSystemPrompt, contextPreamble, delegation, localSystemPrompt } from "../lib/prompt";
import { normalize, parseConfirmation, route, type Intent } from "../lib/router";
import { routeModel, type Complexity, type Route } from "../lib/routing";
import { editedFiles, projectFolder } from "../lib/workspace";
import { SpeechQueue, type SpeechItem } from "../lib/speech-queue";
import { firstSentences, speakable } from "../lib/text";
import type { TtsEngineId, VoiceSettings } from "../lib/settings";
import { meter, useVoiceStore, type Turn, type VoiceSession, type VoiceStatus, type VoiceTask } from "../store";

type Chat = ReturnType<typeof useChat>;
type Answer = "yes" | "always" | "no";

const CONFIRM_TIMEOUT_MS = 120_000;

const uid = () => crypto.randomUUID();

/**
 * Début de réponse du modèle local : délégation (« DELEGUER: »), réponse à dire, ou encore
 * trop court pour savoir (`null`).
 */
export function delegationStart(answer: string): "speak" | "delegate" | null {
  const head = answer.trimStart().toUpperCase().replace(/É/g, "E");
  if (head.startsWith("DELEGUER")) return "delegate";
  if (head.length === 0) return null;
  return "DELEGUER".startsWith(head.slice(0, 8)) && head.length < 8 ? null : "speak";
}

/** Libellé court d'un outil d'agent, pour l'état et l'historique. */
export function toolLabel(tool: string, input: unknown): string {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (tool.startsWith("mcp__archimed__")) {
    const name = tool.slice("mcp__archimed__".length);
    if (name === "run_action") return `${String(args.module ?? "module")} · ${String(args.action ?? "action")}`;
    if (name === "open_module") return `ouvrir ${String(args.module ?? "un module")}`;
    if (name === "start_task") return "tâche confiée";
    return name.replace(/_/g, " ");
  }
  const labels: Record<string, string> = {
    Read: "lecture",
    Write: "création de fichier",
    Edit: "modification de fichier",
    MultiEdit: "modification de fichier",
    Bash: "commande",
    PowerShell: "commande",
    Grep: "recherche",
    Glob: "recherche",
    WebFetch: "page web",
    WebSearch: "recherche web",
    Task: "sous-agent",
    TodoWrite: "plan",
  };
  return labels[tool] ?? tool;
}

/**
 * Chef d'orchestre de la voix : écoute, comprend (routeur local ou agent), répond à voix
 * haute, se laisse interrompre, demande confirmation, suit les tâches confiées.
 * Une seule instance, créée par le composant monté en permanence (`VoiceRuntime`).
 */
export class VoiceOrchestrator {
  private stt: SttSession | null = null;
  private tts: TtsEngine | null = null;
  private player = new AudioPlayer();
  private queue = new SpeechQueue();
  private current: SpeechItem | null = null;
  private pumping = false;
  private speechPaused = false;
  /** Phrase coupée par la pause, redite à la reprise. */
  private pausedItem: SpeechItem | null = null;
  private chunker = new SentenceChunker();
  private unwatch: (() => void) | null = null;
  private lastSpoken = "";
  private lastReply = "";
  private resolvers = new Map<string, (answer: Answer) => void>();
  private localChat: string | null = null;
  private progressAt = new Map<string, number>();
  private progressTimer: ReturnType<typeof setInterval> | undefined;
  private notifiedFallback = false;

  chat: Chat | null = null;
  modules: LoadedModule[] = [];

  constructor() {
    meter.output = () => this.tts?.level() ?? 0;
    this.progressTimer = setInterval(() => this.announceProgress(), 15_000);
  }

  dispose(): void {
    clearInterval(this.progressTimer);
    void this.stop();
  }

  // ── État ─────────────────────────────────────────────────────────────────────────

  private get settings(): VoiceSettings {
    return effectiveSettings(useVoiceStore.getState().settings);
  }

  private status(status: VoiceStatus): void {
    useVoiceStore.getState().patch({ status });
  }

  private get listening(): boolean {
    return this.stt !== null;
  }

  private idleStatus(): VoiceStatus {
    return this.listening ? "listening" : useVoiceStore.getState().session ? "idle" : "off";
  }

  private addTurn(turn: Omit<Turn, "id" | "at">): Turn {
    const full = { ...turn, id: uid(), at: Date.now() };
    useVoiceStore.getState().updateSession((s) => ({
      ...s,
      title: s.turns.length === 0 && turn.role === "user" ? firstSentences(turn.text, 1, 60) || s.title : s.title,
      turns: [...s.turns, full],
    }));
    this.persist();
    return full;
  }

  private persist(): void {
    const session = useVoiceStore.getState().session;
    if (session) void voiceApi.saveSession(session).catch(() => undefined);
  }

  private newSession(): VoiceSession {
    const settings = this.settings;
    return {
      id: uid(),
      title: "Session vocale",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
      tasks: [],
      conversationId: null,
      agent: settings.agent.adapter,
      brain: settings.agent.brain,
    };
  }

  // ── Écoute ───────────────────────────────────────────────────────────────────────

  /** Démarre l'écoute (et la session si besoin). */
  async start(): Promise<void> {
    await useVoiceStore.getState().load();
    const store = useVoiceStore.getState();
    if (!store.session) {
      const session = this.newSession();
      store.patch({ session, error: null, ...(this.settings.overlay.immersive ? { liveOpen: true, panelOpen: false } : {}) });
      bus.emit("voice.started", { sessionId: session.id });
    }
    if (this.stt) return;
    const settings = this.settings;
    this.tts ??= createTts(settings, this.player);
    void this.player.setSink(settings.speaker.deviceId);
    const stt = createStt(settings, {
      onLevel: (level) => {
        meter.input = level;
      },
      onSpeechStart: () => this.onSpeechStart(),
      onPartial: (text) => this.onPartial(text),
      onFinal: (text) => void this.onFinal(text),
      onTranscribing: (busy) => {
        const status = useVoiceStore.getState().status;
        if (busy) this.status("transcribing");
        else if (status === "transcribing") this.status(this.idleStatus());
      },
      onError: (message) => this.fail(message),
    });
    this.stt = stt;
    try {
      await stt.start();
      store.patch({ error: null, micOn: true });
      this.status("listening");
      if (settings.general.sounds) earcon("listen");
    } catch {
      this.stt = null;
      if (useVoiceStore.getState().status !== "error") this.status(this.idleStatus());
    }
  }

  /** Coupe le micro ; la session reste (on peut reprendre). */
  async stopListening(): Promise<void> {
    const stt = this.stt;
    this.stt = null;
    meter.input = 0;
    useVoiceStore.getState().patch({ partial: "", micOn: false });
    await stt?.stop();
    if (this.settings.general.sounds && stt) earcon("stop");
    if (!this.pumping) this.status(this.idleStatus());
  }

  async toggle(): Promise<void> {
    if (this.listening) await this.stopListening();
    else await this.start();
  }

  /** Arrête tout : écoute, voix, réponse en cours. */
  async stop(): Promise<void> {
    this.interrupt(false);
    await this.stopListening();
    this.status(useVoiceStore.getState().session ? "idle" : "off");
  }

  /** Termine la session : le contexte de l'agent est oublié, l'historique reste consultable. */
  async endSession(): Promise<void> {
    const session = useVoiceStore.getState().session;
    await this.stop();
    this.cancelBrain();
    if (session) {
      this.persist();
      const conversation = this.conversation(session.conversationId);
      if (conversation && this.chat) void this.chat.remove(conversation);
      bus.emit("voice.stopped", { sessionId: session.id });
    }
    useVoiceStore.getState().patch({ session: null, status: "off", partial: "", tools: [], caption: "", confirmation: null, liveOpen: false });
    void voiceApi.stopEngines().catch(() => undefined);
  }

  /** Reprend une session de l'historique (l'agent repart d'une conversation neuve). */
  resume(session: VoiceSession): void {
    const current = useVoiceStore.getState().session;
    if (current && current.id !== session.id) {
      // La session affichée jusqu'ici est rangée comme à sa fin normale.
      this.interrupt(false);
      this.cancelBrain();
      this.persist();
      const conversation = this.conversation(current.conversationId);
      if (conversation && this.chat) void this.chat.remove(conversation);
    }
    useVoiceStore.getState().patch({
      session: { ...session, conversationId: null },
      status: this.listening ? "listening" : "idle",
      tools: [],
      caption: "",
      confirmation: null,
    });
    bus.emit("voice.started", { sessionId: session.id });
  }

  pushStart(): void {
    if (!this.stt) {
      void this.start().then(() => this.stt?.begin());
      return;
    }
    this.interrupt(true);
    this.stt.begin();
  }

  pushEnd(): void {
    this.stt?.end();
  }

  private fail(message: string): void {
    useVoiceStore.getState().patch({ error: message, status: "error" });
    if (this.settings.general.sounds) earcon("error");
    // L'erreur est aussi dite, sauf si c'est la voix elle-même qui est en panne.
    if (!/voix|synth/i.test(message)) this.say(message, "high", "notice", "voice");
    setTimeout(() => {
      if (useVoiceStore.getState().status === "error") this.status(this.idleStatus());
    }, 4000);
  }

  // ── Ce que la personne dit ───────────────────────────────────────────────────────

  private onSpeechStart(): void {
    // La personne parle pendant que l'assistant parle : il se tait (barge-in).
    if (this.current && this.current.kind === "reply") this.interrupt(true);
    else if (this.current) this.tts?.stop();
    const status = useVoiceStore.getState().status;
    if (status === "listening" || status === "speaking") this.status("hearing");
  }

  private onPartial(text: string): void {
    if (this.isEcho(text)) return;
    if (this.current) this.onSpeechStart();
    if (this.settings.general.liveTranscript) useVoiceStore.getState().patch({ partial: text });
  }

  /** La voix de l'assistant reprise par le micro (haut-parleurs, voix système). */
  private isEcho(text: string): boolean {
    if (!this.lastSpoken) return false;
    const heard = normalize(text);
    const said = normalize(this.lastSpoken);
    return heard.length > 3 && said.includes(heard);
  }

  private async onFinal(raw: string): Promise<void> {
    useVoiceStore.getState().patch({ partial: "" });
    if (this.isEcho(raw)) return;
    const text = raw.trim();
    if (!text) return;
    const confirmation = useVoiceStore.getState().confirmation;

    bus.emit("voice.transcript", { text, final: true });

    if (confirmation) {
      const answer = parseConfirmation(text);
      if (answer) {
        this.addTurn({ role: "user", text });
        this.resolve(confirmation.id, answer);
        return;
      }
    }

    const intent = route(text, this.modules.map((m) => ({ id: m.id, name: m.name })));
    if (intent.type !== "ask") this.addTurn({ role: "user", text });
    await this.execute(intent);
  }

  /** Commandes du routeur local : instantanées, sans modèle. */
  private async execute(intent: Intent): Promise<void> {
    const store = useVoiceStore.getState();
    switch (intent.type) {
      case "stop":
        this.interrupt(true);
        this.status(this.idleStatus());
        return;
      case "pause":
        this.pauseSpeech();
        return;
      case "resume":
        if (this.speechPaused) this.continueSpeech();
        else await this.continueAgent();
        return;
      case "cancel":
        this.cancel();
        this.say("D'accord, j'arrête.", "high", "notice", "voice");
        return;
      case "repeat":
        if (this.lastReply) this.say(this.lastReply, "high", "reply", "voice");
        else this.say("Je n'ai encore rien dit.", "high", "notice", "voice");
        return;
      case "speed":
        store.setSettings((s) => ({ ...s, tts: { ...s.tts, speed: Math.min(2, Math.max(0.6, +(s.tts.speed + intent.delta).toFixed(2))) } }));
        this.tts = null;
        this.say(intent.delta > 0 ? "Je parle plus vite." : "Je parle plus lentement.", "high", "notice", "voice");
        return;
      case "volume":
        store.setSettings((s) => ({ ...s, speaker: { ...s.speaker, volume: Math.min(1.5, Math.max(0.2, +(s.speaker.volume + intent.delta).toFixed(2))) } }));
        this.tts = null;
        this.say(intent.delta > 0 ? "Plus fort." : "Moins fort.", "high", "notice", "voice");
        return;
      case "open": {
        const module = this.modules.find((m) => m.id === intent.module);
        this.openModule(intent.module);
        this.say(`J'ouvre ${module?.name ?? intent.module}.`, "normal", "notice", "voice");
        return;
      }
      case "agent":
        store.setSettings((s) => ({ ...s, agent: { ...s.agent, adapter: intent.adapter, brain: "cli" } }));
        this.cancelBrain();
        store.updateSession((s) => ({ ...s, conversationId: null, agent: intent.adapter, brain: "cli" }));
        this.say(`C'est noté, j'utilise ${agentName(intent.adapter)}.`, "normal", "notice", "voice");
        return;
      case "brain":
        store.setSettings((s) => ({ ...s, agent: { ...s.agent, brain: intent.brain } }));
        store.updateSession((s) => ({ ...s, brain: intent.brain }));
        this.say(intent.brain === "local" ? "J'utilise le modèle local." : "J'utilise l'agent en ligne.", "normal", "notice", "voice");
        return;
      case "localMode":
        // L'écoute redémarre d'elle-même avec les nouveaux moteurs (VoiceRuntime).
        store.setSettings((s) => ({ ...s, privacy: { ...s.privacy, localOnly: intent.on } }));
        this.say(intent.on ? "Mode local activé : la reconnaissance et la voix restent sur l'ordinateur." : "Mode local désactivé.", "normal", "notice", "voice");
        return;
      case "status":
        this.say(this.describeStatus(), "high", "notice", "voice");
        return;
      case "time": {
        const now = new Date().toLocaleTimeString(this.settings.general.language, { hour: "2-digit", minute: "2-digit" });
        this.say(`Il est ${now}.`, "high", "reply", "voice");
        return;
      }
      case "endSession":
        this.say("À bientôt.", "high", "notice", "voice");
        setTimeout(() => void this.endSession(), 1200);
        return;
      case "confirm":
        return;
      case "ask":
        await this.ask(intent.text);
        return;
    }
  }

  /** Met la voix en pause (la phrase en cours sera reprise). */
  pauseSpeech(): void {
    if (!this.current && this.queue.list().length === 0) return;
    this.speechPaused = true;
    this.tts?.stop();
    this.status("paused");
  }

  continueSpeech(): void {
    if (!this.speechPaused) return;
    this.speechPaused = false;
    if (this.pausedItem) this.queue.add({ ...this.pausedItem, priority: "high" });
    this.pausedItem = null;
    this.status(this.idleStatus());
    void this.pump();
  }

  get paused(): boolean {
    return this.speechPaused;
  }

  /** Arrête la réponse en cours : voix et agent (la session et l'écoute continuent). */
  cancel(): void {
    this.interrupt(true);
    this.cancelBrain();
    useVoiceStore.getState().patch({ tools: [] });
    this.status(this.idleStatus());
  }

  /** Réglages de voix modifiés : le moteur est recréé à la phrase suivante. */
  resetVoice(): void {
    this.tts?.stop();
    this.tts = null;
    this.notifiedFallback = false;
    void this.player.setSink(this.settings.speaker.deviceId);
  }

  /** Redémarre écoute et voix après un changement de réglages. */
  async restartEngines(): Promise<void> {
    const wasListening = this.listening;
    this.tts?.stop();
    this.tts = null;
    if (wasListening) {
      await this.stopListening();
      await this.start();
    }
  }

  describeStatus(): string {
    const store = useVoiceStore.getState();
    const running = store.session?.tasks.filter((t) => t.status === "running") ?? [];
    const parts: string[] = [];
    if (store.status === "thinking" || store.status === "tool") {
      parts.push(store.tools.length > 0 ? `Je travaille : ${store.tools.at(-1)}.` : "Je réfléchis à ta demande.");
    }
    for (const task of running) {
      parts.push(`${agentName(task.agent)} travaille sur « ${task.title} »${task.activity ? `, en ce moment : ${task.activity}` : ""}.`);
    }
    return parts.join(" ") || "Rien en cours. Je t'écoute.";
  }

  // ── Agent ────────────────────────────────────────────────────────────────────────

  private conversation(id: string | null | undefined): ChatSession | null {
    if (!id) return null;
    return useSessionStore.getState().sessions.find((s) => s.id === id) ?? null;
  }

  private moduleNames(): Record<string, string> {
    return Object.fromEntries(this.modules.map((m) => [m.id, m.name]));
  }

  /** Envoie la phrase à l'agent (CLI ou modèle local). */
  async ask(text: string): Promise<void> {
    this.interrupt(true);
    this.addTurn({ role: "user", text });
    useVoiceStore.getState().patch({ tools: [], status: "thinking" });
    const brain = useVoiceStore.getState().session?.brain ?? this.settings.agent.brain;
    try {
      if (brain === "local") await this.askLocal(text);
      else await this.askCli(text);
    } catch (e) {
      this.fail((e as { message?: string }).message ?? "L'agent ne répond pas.");
    }
  }

  /** Conversation de l'agent pour cette session (créée au premier message). */
  private async ensureConversation(): Promise<ChatSession> {
    const chat = this.chat;
    if (!chat) throw new Error("Moteur des agents indisponible.");
    const store = useVoiceStore.getState();
    const settings = this.settings;
    const context = currentContext();
    const projectPath = context.modules[context.activeModule]?.project?.path ?? null;
    let conversation = this.conversation(store.session?.conversationId);
    if (!conversation) {
      const cwd = projectPath ?? (await engineApi.defaultCwd().catch(() => null));
      const id = chat.createSession({
        adapter: store.session?.agent ?? settings.agent.adapter,
        model: settings.agent.model,
        cwd,
        autoMode: settings.agent.autoMode,
        origin: "voice",
        title: store.session?.title ?? "Session vocale",
        options: { appendSystemPrompt: cliSystemPrompt(settings.general.language) },
        activate: false,
      });
      store.updateSession((s) => ({ ...s, conversationId: id }));
      conversation = this.conversation(id);
      if (!conversation) throw new Error("Conversation de l'agent introuvable.");
    } else if (projectPath && conversation.cwd !== projectPath) {
      // Nouveau projet à l'écran : l'agent y travaille désormais (même conversation).
      await chat.setCwd(conversation, projectPath);
      conversation = this.conversation(conversation.id)!;
    }
    return conversation;
  }

  /**
   * Dossier du projet sur lequel l'agent vient de travailler (fichiers créés ou modifiés) : la
   * conversation vocale d'abord, puis les tâches confiées, de la plus récente à la plus ancienne.
   */
  workFolder(): string | null {
    const session = useVoiceStore.getState().session;
    const tasks = [...(session?.tasks ?? [])].sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
    for (const id of [session?.conversationId, ...tasks.map((t) => t.conversationId)]) {
      const conversation = this.conversation(id);
      const folder = conversation ? projectFolder(editedFiles(conversation.timeline), conversation.cwd) : null;
      if (folder) return folder;
    }
    return null;
  }

  /**
   * Affiche un module ; sans paramètres, il s'ouvre sur le dossier où l'agent vient de travailler
   * (`cwd`, lu par Code) : « crée-moi un site » puis « montre-le » ouvre le bon projet.
   */
  openModule(id: string, params?: Record<string, unknown> | null): string | null {
    const folder = params ? null : this.workFolder();
    const finalParams = params ?? (folder ? { cwd: folder } : null);
    if (finalParams) useUiStore.getState().openModule(id, finalParams);
    else useUiStore.getState().navigate(id);
    return folder;
  }

  /**
   * Autonomie choisie dans les réglages, appliquée aussi aux conversations déjà ouvertes (celle
   * de la voix et les tâches en cours) : changer le réglage prend effet tout de suite.
   */
  async applyAutonomy(): Promise<void> {
    const chat = this.chat;
    if (!chat) return;
    const wanted = this.settings.agent.autoMode;
    const ids = [useVoiceStore.getState().session?.conversationId, ...this.tasks().filter((t) => t.status === "running").map((t) => t.conversationId)];
    for (const id of new Set(ids)) {
      const conversation = this.conversation(id);
      if (!conversation || conversation.autoMode === wanted) continue;
      try {
        await chat.setAutoMode(conversation, wanted);
      } catch {
        // Conversation arrêtée entre-temps : le réglage s'applique à sa reprise.
      }
    }
  }

  private async askCli(text: string): Promise<void> {
    const created = await this.ensureConversation();
    await this.applyAutonomy();
    const conversation = this.conversation(created.id) ?? created;
    const baseline = conversation.timeline.length;
    this.watch(conversation.id, baseline);
    const preamble = contextPreamble(currentContext(), this.moduleNames());
    await this.chat!.send(conversation, `${preamble}\n\n${text}`);
  }

  /** Suit la réponse de l'agent : phrases dites au fil de l'eau, outils, questions, fin. */
  private watch(conversationId: string, baseline: number): void {
    this.unwatch?.();
    this.chunker = new SentenceChunker();
    const consumed = new Map<string, number>();
    const seenTools = new Set<string>();
    const handledPrompts = new Set<string>();
    let replyText = "";
    let pendingFlush = false;

    const check = () => {
      const conversation = this.conversation(conversationId);
      if (!conversation) return;
      const items = conversation.timeline.slice(baseline);
      for (const item of items) {
        if (item.kind === "assistant") {
          const done = consumed.get(item.id) ?? 0;
          if (item.text.length > done) {
            const delta = item.text.slice(done);
            consumed.set(item.id, item.text.length);
            replyText += delta;
            this.speakChunks(this.chunker.push(delta));
            pendingFlush = true;
          }
        } else if (item.kind === "tool" && !seenTools.has(item.id)) {
          seenTools.add(item.id);
          // Le texte avant un outil est complet : il part tout de suite.
          if (pendingFlush) this.speakChunks(this.chunker.flush());
          pendingFlush = false;
          const label = toolLabel(item.tool, item.input);
          useVoiceStore.getState().patch({ tools: [...useVoiceStore.getState().tools, label], status: "tool" });
        } else if (item.kind === "prompt" && !item.resolvedBy && !item.prompt.auto && !handledPrompts.has(item.id)) {
          handledPrompts.add(item.id);
          void this.handlePrompt(conversation, item);
        } else if (item.kind === "error" && !handledPrompts.has(item.id)) {
          handledPrompts.add(item.id);
          this.say(item.message, "high", "notice", "agent");
        }
      }
      const ended = ["idle", "ended", "error"].includes(conversation.status) && items.some((i) => i.kind === "turn" || i.kind === "error");
      if (ended) {
        this.unwatch?.();
        this.unwatch = null;
        this.speakChunks(this.chunker.flush());
        this.finishReply(replyText);
      }
    };
    this.unwatch = useSessionStore.subscribe(check);
    check();
  }

  private finishReply(text: string): void {
    const tools = useVoiceStore.getState().tools;
    if (text.trim()) {
      this.addTurn({ role: "assistant", text: text.trim(), tools });
      this.lastReply = speakable(text, this.settings.general.language);
      bus.emit("voice.response", { text: text.trim() });
    } else if (tools.length > 0) {
      this.say("C'est fait.", "normal", "reply", "agent");
      this.addTurn({ role: "assistant", text: "C'est fait.", tools });
    }
    if (!this.pumping) this.status(this.idleStatus());
  }

  /** Question de l'agent (permission) : posée à voix haute, réponse « oui » ou « non ». */
  private async handlePrompt(conversation: ChatSession, item: Extract<TimelineItem, { kind: "prompt" }>): Promise<void> {
    const prompt = item.prompt;
    const hasAlways = prompt.options.some((o) => o.id === "always");
    const question =
      prompt.detail?.type === "plan"
        ? "L'agent propose un plan. Je l'exécute ?"
        : prompt.detail?.type === "questions"
          ? `L'agent te pose une question : ${prompt.detail.questions[0]?.question ?? prompt.title}. Réponds dans la conversation.`
          : `L'agent demande : ${speakable(prompt.title)}. Tu confirmes ?`;
    if (prompt.detail?.type === "questions") {
      this.announcePermission(question, "agent");
      return;
    }
    const answer = await this.confirm(question, "agent", true);
    const chat = this.chat;
    const live = this.conversation(conversation.id);
    if (!chat || !live) return;
    if (answer === "always" && !hasAlways) {
      // « Toujours » : les actions sans risque de cette session passent seules désormais.
      if (live.autoMode === "off") await chat.setAutoMode(live, "smart");
    }
    const optionId = answer === "no" ? "deny" : answer === "always" && hasAlways ? "always" : "allow";
    await chat.answer(live, prompt.promptId, { optionId });
  }

  /** Continue une réponse interrompue par la personne. */
  private async continueAgent(): Promise<void> {
    const conversation = this.conversation(useVoiceStore.getState().session?.conversationId);
    if (!conversation || !this.chat) {
      this.say("Il n'y a rien à reprendre.", "high", "notice", "voice");
      return;
    }
    this.watch(conversation.id, conversation.timeline.length);
    useVoiceStore.getState().patch({ status: "thinking" });
    await this.chat.continueTurn(conversation);
  }

  /** Coupe la réponse de l'agent en cours (le processus s'arrête, la conversation reste). */
  private cancelBrain(): void {
    this.unwatch?.();
    this.unwatch = null;
    if (this.localChat) {
      void voiceApi.cancelLocalChat(this.localChat).catch(() => undefined);
      this.localChat = null;
    }
    const conversation = this.conversation(useVoiceStore.getState().session?.conversationId);
    if (conversation && this.chat && ["starting", "running", "awaiting"].includes(conversation.status)) {
      void this.chat.stop(conversation);
    }
  }

  private async askLocal(text: string): Promise<void> {
    const settings = this.settings;
    const session = useVoiceStore.getState().session;
    const history = (session?.turns ?? [])
      .filter((t) => t.role === "user" || t.role === "assistant")
      .slice(-10)
      .map((t) => ({ role: t.role, content: t.text }));
    const preamble = contextPreamble(currentContext(), this.moduleNames());
    const messages = [
      { role: "system", content: localSystemPrompt(settings.general.language, this.modules.map((m) => m.name)) },
      ...history.slice(0, -1),
      { role: "user", content: `${preamble}\n\n${text}` },
    ];
    const chatId = uid();
    this.localChat = chatId;
    this.chunker = new SentenceChunker();
    let answer = "";
    // « DELEGUER: … » n'est jamais lu : on attend d'être sûr que la réponse n'en est pas une.
    let decided: "speak" | "delegate" | null = null;
    const channel = new Channel<LocalChatEvent>();
    channel.onmessage = (event) => {
      if (this.localChat !== chatId || event.type !== "delta") return;
      answer += event.text;
      if (decided === null) {
        decided = delegationStart(answer);
        if (decided === "speak") this.speakChunks(this.chunker.push(answer));
        return;
      }
      if (decided === "speak") this.speakChunks(this.chunker.push(event.text));
    };
    await voiceApi.localChat(chatId, settings.agent.localModel, messages, channel);
    if (this.localChat !== chatId) return;
    this.localChat = null;
    const task = delegation(answer);
    if (task) {
      const adapter = session?.agent ?? settings.agent.adapter;
      this.say(`Je transmets à ${agentName(adapter)}.`, "normal", "notice", "voice");
      useVoiceStore.getState().patch({ status: "thinking" });
      await this.askCli(task);
      return;
    }
    if (decided === null) this.speakChunks(this.chunker.push(answer));
    this.speakChunks(this.chunker.flush());
    this.finishReply(answer);
  }

  // ── Parole ───────────────────────────────────────────────────────────────────────

  private speakChunks(chunks: string[]): void {
    for (const chunk of chunks) {
      const text = speakable(chunk, this.settings.general.language);
      if (text) this.say(text, "normal", "reply", "agent");
    }
  }

  /** Met une phrase dans la file ; les priorités décident de l'ordre (voir `SpeechQueue`). */
  say(text: string, priority: VoicePriority = "normal", kind: SpeechItem["kind"] = "notice", source?: string): void {
    const clean = speakable(text, this.settings.general.language);
    if (!clean) return;
    if (kind === "notice" && source !== "voice") {
      this.addTurn({ role: "notice", text: clean, source, priority });
    }
    const interrupt = this.queue.add({ id: uid(), text: clean, priority, kind, source, queuedAt: Date.now() });
    if (interrupt) this.tts?.stop();
    void this.pump();
  }

  private busy(): boolean {
    const status = useVoiceStore.getState().status;
    return status === "hearing" || status === "transcribing" || status === "thinking" || status === "tool" || this.queue.list().some((i) => i.kind === "reply");
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.speechPaused) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.speechPaused) break;
        const item = this.queue.next(this.busy());
        if (!item) break;
        this.current = item;
        const tts = (this.tts ??= createTts(this.settings, this.player));
        const next = this.queue.peek(false);
        if (next && next.kind === "reply") tts.prefetch(next.text);
        useVoiceStore.getState().patch({ status: "speaking", caption: item.text });
        bus.emit("voice.speaking", { text: item.text, priority: item.priority });
        this.stt?.setEchoGuard(tts.echoCancelled ? 1.3 : 2.6);
        this.lastSpoken = item.text;
        try {
          await tts.speak(item.text);
        } catch (e) {
          await this.speakWithFallback(item.text, (e as Error).message);
        }
        if (this.speechPaused) this.pausedItem = item;
        this.current = null;
      }
    } finally {
      this.pumping = false;
      this.current = null;
      this.stt?.setEchoGuard(1);
      useVoiceStore.getState().patch({ caption: "" });
      const status = useVoiceStore.getState().status;
      if (status === "speaking") this.status(this.idleStatus());
    }
  }

  private async speakWithFallback(text: string, reason: string): Promise<void> {
    const settings = this.settings;
    const fallback: TtsEngineId | null = settings.tts.fallback;
    if (fallback && fallback !== this.tts?.engine) {
      const engine = createTts(settings, this.player, fallback);
      if (engine.location === "local" || settings.privacy.allowCloudFallback) {
        if (!this.notifiedFallback) {
          this.notifiedFallback = true;
          useVoiceStore.getState().patch({ error: `Voix principale indisponible (${reason}) : voix de secours utilisée.` });
        }
        await engine.speak(text).catch(() => undefined);
        return;
      }
    }
    useVoiceStore.getState().patch({ error: `Voix indisponible : ${reason}` });
  }

  /** Coupe la parole de l'assistant. `user` : c'est la personne qui l'a interrompu. */
  interrupt(user: boolean): void {
    const current = this.current;
    this.queue.dropReplies();
    this.speechPaused = false;
    this.pausedItem = null;
    this.tts?.stop();
    this.chunker = new SentenceChunker();
    if (user && current) bus.emit("voice.interrupted", { text: current.text });
  }

  // ── Confirmations ────────────────────────────────────────────────────────────────

  /** Pose une question fermée (voix et boutons) ; « non » si personne ne répond. */
  confirm(question: string, source: string, allowAlways = false): Promise<Answer> {
    const id = uid();
    const spoken = this.settings.general.speakPermissions;
    // Question non lue : le panneau s'ouvre toujours, avec ses boutons.
    useVoiceStore.getState().patch({ confirmation: { id, question, always: allowAlways, source }, panelOpen: spoken ? !this.listening : true });
    if (spoken) this.say(question, "high", "notice", "voice");
    else this.signal();
    this.addTurn({ role: "system", text: question, source });
    return new Promise((resolve) => {
      this.resolvers.set(id, resolve);
      setTimeout(() => this.resolve(id, "no"), CONFIRM_TIMEOUT_MS);
    });
  }

  /**
   * Demande de permission hors confirmation (tâche en attente, question de l'agent) : dite à
   * voix haute, ou seulement signalée si « Dire les demandes de permission » est désactivé.
   */
  announcePermission(text: string, source: string): void {
    if (this.settings.general.speakPermissions) {
      this.say(text, "high", "notice", source);
      return;
    }
    this.addTurn({ role: "notice", text, source, priority: "high" });
    useVoiceStore.getState().patch({ panelOpen: true });
    this.signal();
  }

  /** Signal discret à la place de la voix : un son, et la barre des tâches si ARCHIMED est en arrière-plan. */
  private signal(): void {
    if (this.settings.general.sounds) earcon("notice");
    if (typeof document !== "undefined" && document.hasFocus()) return;
    try {
      void getCurrentWindow()
        .requestUserAttention(UserAttentionType.Informational)
        .catch(() => undefined);
    } catch {
      // Hors Tauri (aperçu navigateur) : pas de fenêtre à signaler.
    }
  }

  resolve(id: string, answer: Answer): void {
    const resolver = this.resolvers.get(id);
    if (!resolver) return;
    this.resolvers.delete(id);
    const store = useVoiceStore.getState();
    if (store.confirmation?.id === id) store.patch({ confirmation: null });
    resolver(answer);
  }

  // ── Tâches confiées ──────────────────────────────────────────────────────────────

  /**
   * Confie un travail à un agent dans une conversation du module Chat, suivie ici. Avec une
   * complexité et le réglage « Modèle selon la tâche », le modèle est choisi pour elle : léger
   * pour une tâche simple, le plus puissant pour une tâche complexe.
   */
  async startTask(
    prompt: string,
    options: { agent?: string; cwd?: string | null; title?: string; complexity?: Complexity } = {},
  ): Promise<VoiceTask & { route: Route | null }> {
    const chat = this.chat;
    if (!chat) throw new Error("Moteur des agents indisponible.");
    const settings = this.settings;
    const context = currentContext();
    const choice =
      options.complexity && settings.agent.routeByComplexity
        ? routeModel(await engineApi.listAdapters().catch(() => []), options.complexity, settings.agent.adapter, options.agent)
        : null;
    const adapter = choice?.adapter ?? options.agent ?? settings.agent.adapter;
    const cwd = options.cwd ?? context.modules[context.activeModule]?.project?.path ?? (await engineApi.defaultCwd().catch(() => null));
    const title = options.title ?? firstSentences(prompt, 1, 60);
    const conversationId = chat.createSession({
      adapter,
      model: choice?.model ?? (adapter === settings.agent.adapter ? settings.agent.model : null),
      cwd,
      autoMode: settings.agent.autoMode,
      origin: "chat",
      title,
      activate: false,
    });
    const conversation = this.conversation(conversationId);
    if (!conversation) throw new Error("Conversation introuvable.");
    const task: VoiceTask = { id: uid(), title, agent: adapter, conversationId, status: "running", startedAt: Date.now() };
    this.addTask(task);
    bus.emit("voice.task.started", { taskId: task.id, title, agent: adapter });
    void chat.send(conversation, prompt).catch((e: { message?: string }) => {
      this.finishTask(conversationId, false, e.message ?? "L'agent n'a pas démarré.");
    });
    return { ...task, route: choice };
  }

  private addTask(task: VoiceTask): void {
    const store = useVoiceStore.getState();
    if (!store.session) store.patch({ session: this.newSession() });
    useVoiceStore.getState().updateSession((s) => ({ ...s, tasks: [...s.tasks, task] }));
    this.persist();
  }

  tasks(): VoiceTask[] {
    return useVoiceStore.getState().session?.tasks ?? [];
  }

  /** Fin d'un tour dans une conversation suivie (événement `engine.turn.completed`). */
  finishTask(conversationId: string, ok: boolean, answer: string): void {
    const task = this.tasks().find((t) => t.conversationId === conversationId && t.status === "running");
    if (!task) return;
    const summary = firstSentences(answer || (ok ? "Terminé." : "Échec."), 2);
    useVoiceStore.getState().updateSession((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === task.id ? { ...t, status: ok ? "done" : "failed", endedAt: Date.now(), summary, activity: null } : t,
      ),
    }));
    this.persist();
    if (ok) bus.emit("voice.task.completed", { taskId: task.id, title: task.title, summary });
    else bus.emit("voice.task.failed", { taskId: task.id, title: task.title, error: summary });
    const priority: VoicePriority = ok ? (this.listening ? "normal" : "low") : "high";
    this.say(`${agentName(task.agent)} a ${ok ? "terminé" : "échoué sur"} « ${task.title} ». ${summary}`, priority, "notice", "task");
  }

  stopTask(taskId: string): boolean {
    const task = this.tasks().find((t) => t.id === taskId);
    const conversation = this.conversation(task?.conversationId);
    if (!task || !conversation || !this.chat) return false;
    void this.chat.stop(conversation);
    useVoiceStore.getState().updateSession((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: "stopped", endedAt: Date.now() } : t)),
    }));
    this.persist();
    return true;
  }

  /** Annonces pendant les tâches longues (réglage « Annonces »). */
  private announceProgress(): void {
    const mode = useVoiceStore.getState().settings.general.progress;
    for (const task of this.tasks().filter((t) => t.status === "running")) {
      const conversation = this.conversation(task.conversationId);
      const label = conversation?.activity?.label ?? null;
      if (label !== task.activity) {
        useVoiceStore.getState().updateSession((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, activity: label } : t)),
        }));
      }
      if (mode === "off" || !label) continue;
      const last = this.progressAt.get(task.id) ?? task.startedAt;
      const gap = mode === "detailed" ? 30_000 : 60_000;
      if (Date.now() - last < gap) continue;
      this.progressAt.set(task.id, Date.now());
      this.say(mode === "detailed" ? `${agentName(task.agent)} : ${label}.` : `Toujours en cours : ${task.title}.`, "low", "notice", "task");
    }
  }
}
