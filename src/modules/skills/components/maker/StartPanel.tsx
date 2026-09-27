import { useId, useMemo, useState } from "react";
import { FileText, Loader2, MessagesSquare, Paperclip, PenLine, Sparkles, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { baseName } from "@/core/chat";
import { useSessionStore } from "@/core/engine/session.store";
import type { AdapterInfo } from "@/core/engine/types";
import { Button, Select } from "@/design-system/primitives";
import { briefMessage, fromConversationMessage, transcriptMarkdown, type SkillLanguage } from "../../lib/maker";
import { ORIGIN_SKILLS } from "./origin";
import { Label, Segmented, textareaClass } from "./ui";

export type StartRequest = {
  /** Premier message envoyé à l'IA de l'atelier. */
  message: string;
  attachments: string[];
  /** Conversation à transformer en skill, écrite dans `source/conversation.md`. */
  transcript?: string;
};

type Mode = "describe" | "conversation";

type Props = {
  /** CLI installées. */
  adapters: AdapterInfo[];
  adapter: string;
  onAdapter: (id: string) => void;
  language: SkillLanguage;
  onLanguage: (language: SkillLanguage) => void;
  busy: boolean;
  onStart: (request: StartRequest) => void;
};

const EXAMPLES = [
  "Rédiger le compte rendu d'une réunion à partir de notes en vrac",
  "Relire un contrat et lister les clauses à risque",
  "Préparer un rapport hebdomadaire à partir d'un export CSV",
];

/**
 * Départ d'un nouveau skill : le décrire en quelques champs, ou partir d'une conversation
 * déjà menée avec une IA (la façon de faire devient le skill).
 */
export function StartPanel({ adapters, adapter, onAdapter, language, onLanguage, busy, onStart }: Props) {
  const [mode, setMode] = useState<Mode>("describe");
  const [what, setWhat] = useState("");
  const [when, setWhen] = useState("");
  const [output, setOutput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const ids = { what: useId(), when: useId(), output: useId() };

  const sessions = useSessionStore((s) => s.sessions);
  const conversations = useMemo(
    () =>
      sessions
        .filter((s) => s.origin !== ORIGIN_SKILLS && s.timeline.some((item) => item.kind === "user"))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 50),
    [sessions],
  );
  const conversation = conversations.find((s) => s.id === conversationId) ?? null;

  const pickFiles = async () => {
    const selected = await open({ multiple: true, title: "Exemples pour le skill (documents, modèles, résultats attendus)" });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length > 0) setAttachments((current) => [...current, ...paths.filter((p) => !current.includes(p))]);
  };

  const agentName = (id: string) => adapters.find((a) => a.id === id)?.name ?? id;

  const canStart = !busy && adapter !== "" && (mode === "describe" ? what.trim().length > 0 : conversation !== null);

  const submit = () => {
    if (!canStart) return;
    if (mode === "describe") {
      onStart({ message: briefMessage({ what, when, output, language }, attachments), attachments });
    } else if (conversation) {
      onStart({
        message: fromConversationMessage(conversation.title, agentName(conversation.adapter), language),
        attachments: [],
        transcript: transcriptMarkdown(conversation),
      });
    }
  };

  return (
    <form
      className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-6 py-8"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-title-2 font-semibold tracking-[-0.01em]">
          <Sparkles size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
          Créer un skill
        </h2>
        <p className="text-body text-text-muted">
          Un skill apprend une façon de faire à vos IA : elles le chargent d'elles-mêmes quand une demande lui correspond. Décrivez-le,
          l'IA de l'atelier l'écrit, vous le vérifiez et l'essayez, puis vous l'enregistrez.
        </p>
      </div>

      <Segmented<Mode>
        label="Point de départ"
        value={mode}
        onChange={setMode}
        options={[
          { value: "describe", label: "Décrire", icon: <PenLine size={13} strokeWidth={1.75} /> },
          { value: "conversation", label: "Depuis une conversation", icon: <MessagesSquare size={13} strokeWidth={1.75} /> },
        ]}
      />

      {mode === "describe" ? (
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={ids.what}>Ce que le skill doit faire</Label>
            <textarea
              id={ids.what}
              value={what}
              onChange={(event) => setWhat(event.target.value)}
              rows={3}
              autoFocus
              placeholder={`Par exemple : ${EXAMPLES[0]}`}
              className={textareaClass}
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.slice(1).map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setWhat(example)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-caption text-text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.when} aside={<span className="text-caption text-text-subtle">facultatif</span>}>
              Quand s'en servir
            </Label>
            <textarea
              id={ids.when}
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              rows={2}
              placeholder="Les phrases que vous diriez : « fais le CR de la réunion », « résume ces notes »…"
              className={textareaClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.output} aside={<span className="text-caption text-text-subtle">facultatif</span>}>
              Résultat attendu
            </Label>
            <textarea
              id={ids.output}
              value={output}
              onChange={(event) => setOutput(event.target.value)}
              rows={2}
              placeholder="Format, plan, ton, longueur, fichier produit…"
              className={textareaClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label aside={<span className="text-caption text-text-subtle">facultatif</span>}>Exemples</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {attachments.map((path) => (
                <span
                  key={path}
                  title={path}
                  className="inline-flex max-w-56 items-center gap-1 rounded-sm border border-border bg-surface-1 py-0.5 pl-2 pr-1 text-footnote"
                >
                  <FileText size={12} strokeWidth={1.75} className="shrink-0 text-text-subtle" aria-hidden />
                  <span className="truncate">{baseName(path)}</span>
                  <button
                    type="button"
                    aria-label={`Retirer ${baseName(path)}`}
                    onClick={() => setAttachments((current) => current.filter((p) => p !== path))}
                    className="rounded-xs p-0.5 text-text-subtle hover:bg-surface-2 hover:text-text"
                  >
                    <X size={12} strokeWidth={1.75} />
                  </button>
                </span>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => void pickFiles()} icon={<Paperclip size={13} strokeWidth={1.75} />}>
                Joindre un exemple
              </Button>
            </div>
          </div>
        </div>
      ) : conversations.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-body-sm text-text-muted">
          Aucune conversation pour l'instant. Menez une tâche avec une IA dans Chat ou Code, puis revenez ici pour en faire un skill.
        </p>
      ) : (
        <div className="space-y-2">
          <Label>Conversation à transformer en skill</Label>
          <Select
            label="Conversation"
            value={conversationId}
            onChange={setConversationId}
            placeholder="Choisir une conversation…"
            className="w-full"
            options={conversations.map((s) => ({
              value: s.id,
              label: s.title || "Conversation sans titre",
              hint: `${agentName(s.adapter)} · ${new Date(s.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`,
            }))}
          />
          <p className="text-footnote text-text-subtle">
            La conversation est copiée dans le brouillon ; l'IA en tire les étapes, les outils et vos corrections, sans les détails propres
            à ce cas.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <div className="space-y-1.5">
          <Label>IA de l'atelier</Label>
          <Select
            label="IA de l'atelier"
            value={adapter}
            onChange={onAdapter}
            options={adapters.map((a) => ({ value: a.id, label: a.name }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Langue du skill</Label>
          <Segmented<SkillLanguage>
            label="Langue du skill"
            value={language}
            onChange={onLanguage}
            stretch={false}
            options={[
              { value: "fr", label: "Français" },
              { value: "en", label: "Anglais" },
            ]}
          />
        </div>
        <span className="ml-auto" />
        <Button type="submit" variant="primary" disabled={!canStart}
          icon={busy ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" /> : <Sparkles size={14} strokeWidth={1.75} />}
        >
          Lancer l'atelier
        </Button>
      </div>
    </form>
  );
}
