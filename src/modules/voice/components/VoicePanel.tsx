import { Settings2, X } from "lucide-react";
import { useUiStore } from "@/core/stores/ui.store";
import { Button } from "@/design-system/primitives";
import { statusSentence, waveMode } from "../lib/status";
import { useVoiceStore } from "../store";
import { ConfirmCard, PrivacyStrip, TaskList } from "./SessionParts";
import { Transcript } from "./Transcript";
import { VoiceControls } from "./VoiceControls";
import { VoiceWave } from "./VoiceWave";

const EXAMPLES = ["Ouvre le Planner", "Qu'est-ce que tu fais ?", "Explique-moi le fichier ouvert"];

/** Contenu du panneau de la pastille : conversation en direct, confirmations, tâches, contrôles. */
export function VoicePanel({ onClose }: { onClose: () => void }) {
  const status = useVoiceStore((s) => s.status);
  const micOn = useVoiceStore((s) => s.micOn);
  const session = useVoiceStore((s) => s.session);
  const settings = useVoiceStore((s) => s.settings);
  const partial = useVoiceStore((s) => s.partial);
  const caption = useVoiceStore((s) => s.caption);
  const tools = useVoiceStore((s) => s.tools);
  const error = useVoiceStore((s) => s.error);
  const confirmation = useVoiceStore((s) => s.confirmation);
  const tool = tools.at(-1) ?? null;
  const agent = session?.agent ?? settings.agent.adapter;

  const openSettings = () => {
    useUiStore.getState().navigate("voice");
    onClose();
  };

  return (
    <div className="flex max-h-[calc(100vh-72px)] flex-col">
      <header className="flex items-center gap-2.5 pb-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted">
          <VoiceWave mode={waveMode(status)} animate={settings.overlay.animations} className={micOn ? "text-accent" : undefined} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold">{session?.title ?? "Parlez à ARCHIMED"}</p>
          <p className="truncate text-footnote text-text-muted">{statusSentence(status, tool)}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={openSettings} aria-label="Réglages de la voix" className="px-1.5">
          <Settings2 size={14} strokeWidth={1.75} />
        </Button>
      </header>

      <div className="-mx-3 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-sm bg-danger-soft px-2.5 py-2 text-footnote text-text">
            <p className="min-w-0 flex-1">{error}</p>
            <button
              type="button"
              aria-label="Masquer l'erreur"
              onClick={() => useVoiceStore.getState().patch({ error: null })}
              className="-m-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-text-muted hover:bg-surface-2 hover:text-text"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        )}

        {confirmation && <ConfirmCard confirmation={confirmation} />}

        {session ? (
          session.turns.length > 0 || partial || caption || tools.length > 0 ? (
            <Transcript turns={session.turns.slice(-40)} partial={partial} caption={caption} tools={status === "tool" || status === "thinking" ? tools : []} className="max-h-72" />
          ) : (
            <p className="py-4 text-center text-footnote text-text-subtle">
              {micOn ? "Parlez : la conversation s'affiche ici." : "Micro coupé. Ouvrez-le pour parler."}
            </p>
          )
        ) : (
          <div className="space-y-3 py-2">
            <div>
              <p className="text-footnote text-text-muted">
                L'assistant répond à voix haute, agit dans vos modules et confie les longues tâches aux agents. Il demande votre accord avant
                toute action sensible.
              </p>
            </div>
            <ul className="space-y-1" aria-label="Exemples">
              {EXAMPLES.map((example) => (
                <li key={example} className="text-footnote text-text-subtle">
                  « {example} »
                </li>
              ))}
            </ul>
          </div>
        )}

        {session && session.tasks.length > 0 && (
          <section className="space-y-1.5" aria-label="Tâches">
            <p className="text-footnote font-medium text-text-muted">Tâches confiées</p>
            <TaskList tasks={session.tasks.slice(-5)} compact />
          </section>
        )}

        <section className="space-y-1.5 border-t border-border pt-3" aria-label="Confidentialité">
          <p className="text-footnote font-medium text-text-muted">Où passent vos données</p>
          <PrivacyStrip settings={settings} agent={agent} />
        </section>
      </div>

      <footer className="-mx-3 mt-3 border-t border-border px-3 pt-3">
        <VoiceControls />
      </footer>
    </div>
  );
}
