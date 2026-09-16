import { useEffect, useMemo, useState } from "react";
import { MessagesSquare, Loader2 } from "lucide-react";
import { Slot } from "@/core/modules";
import { EmptyState } from "@/design-system/primitives";
import type { AutoMode, PromptAnswer } from "@/core/engine/types";
import { useAdapters, useChatSession } from "./hooks/useChatSession";
import { Composer } from "./components/Composer";
import { Timeline } from "./components/Timeline";
import { RawTerminalDrawer } from "./components/RawTerminalDrawer";

export default function ChatModule() {
  const { adapters, loading, error } = useAdapters();
  const { session, start, send, answer, setAutoMode } = useChatSession();
  const [adapterId, setAdapterId] = useState<string>("");
  const [model, setModel] = useState<string | null>(null);
  const [autoMode, setLocalAutoMode] = useState<AutoMode>("off");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const installed = useMemo(() => adapters.filter((a) => a.installed), [adapters]);

  useEffect(() => {
    if (!adapterId && installed.length > 0) {
      const first = installed[0];
      if (first) {
        setAdapterId(first.id);
        setModel(first.defaultModel);
      }
    }
  }, [installed, adapterId]);

  const adapter = adapters.find((a) => a.id === adapterId);
  const busy = session?.status === "starting" || starting;

  const handleSend = async (text: string) => {
    setStartError(null);
    try {
      let sessionId = session?.id;
      if (!sessionId || session?.status === "ended") {
        setStarting(true);
        sessionId = await start(adapterId, model, autoMode, null);
      }
      await send(sessionId, text);
    } catch (e) {
      setStartError((e as { message?: string }).message ?? "Impossible de démarrer la session");
    } finally {
      setStarting(false);
    }
  };

  const handleAnswer = (promptId: string, payload: PromptAnswer) => {
    if (!session) return;
    void answer(session.id, promptId, payload);
  };

  const handleAutoMode = (mode: AutoMode) => {
    setLocalAutoMode(mode);
    if (session) void setAutoMode(session.id, mode);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-subtle">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<MessagesSquare size={28} strokeWidth={1.5} />}
        title="Moteur indisponible"
        description={error}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="text-body-sm font-medium">
          {adapter?.name ?? "Chat"}
          {session ? "" : " · nouvelle conversation"}
        </span>
        {session && (
          <span className="text-footnote text-text-subtle">
            {session.usage.inputTokens + session.usage.outputTokens} tokens
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Slot name="chat.header.right" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {session && session.timeline.length > 0 ? (
          <Timeline session={session} agentName={adapter?.name ?? "Agent"} onAnswer={handleAnswer} />
        ) : (
          <EmptyState
            icon={<MessagesSquare size={28} strokeWidth={1.5} />}
            title={installed.length === 0 ? "Aucune CLI détectée" : "Démarrer une conversation"}
            description={
              installed.length === 0
                ? adapters.map((a) => a.hint).filter(Boolean).join(" · ") ||
                  "Installez Claude Code ou Antigravity CLI, puis relancez."
                : "Posez une question, demandez une modification de fichier, ou lancez une commande."
            }
          />
        )}
        {startError && (
          <p className="pb-4 text-center text-footnote text-danger">{startError}</p>
        )}
      </div>

      <RawTerminalDrawer raw={session?.raw ?? ""} />

      <Composer
        adapters={adapters}
        adapterId={adapterId}
        model={model}
        autoMode={autoMode}
        busy={busy || installed.length === 0}
        onAdapterChange={(id) => {
          setAdapterId(id);
          setModel(adapters.find((a) => a.id === id)?.defaultModel ?? null);
        }}
        onModelChange={setModel}
        onAutoModeChange={handleAutoMode}
        onSend={(text) => void handleSend(text)}
      />
    </div>
  );
}
