import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Copy,
  ExternalLink,
  FileDown,
  Loader2,
  Mail,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { Badge, Button } from "@/design-system/primitives";
import { useUiStore } from "@/core/stores/ui.store";
import { cn } from "@/core/lib/cn";
import { jobagentApi } from "../api";
import { directEmail, offerEmail } from "../lib/batch";
import { cvFor, LANGUAGE_LABELS } from "../lib/cv";
import { useJobAgentStore } from "../store";
import type { CvLanguage, LetterKind, Offer } from "../types";
import { Field, inputClass, Segmented } from "./Panel";

const KINDS: Array<{ value: LetterKind; label: string }> = [
  { value: "letter", label: "Lettre" },
  { value: "email", label: "E-mail" },
  { value: "answer", label: "Réponse" },
];

/**
 * Préparation d'une candidature : lettre, e-mail ou réponse de formulaire, rédigés par
 * Antigravity avec le CV et l'annonce sous les yeux.
 *
 * Rien ne part d'ici : ARCHIMED écrit, la personne relit, puis choisit d'ouvrir son
 * client mail ou le formulaire de l'annonce. L'envoi automatique, lui, vit dans le
 * panneau de lot, où la liste complète est confirmée d'un bloc.
 */
export function ApplyPanel({ offer }: { offer: Offer }) {
  const { profile, applications, upsertApplication } = useJobAgentStore();
  const openModule = useUiStore((state) => state.openModule);
  const [kind, setKind] = useState<LetterKind>("letter");
  const [question, setQuestion] = useState("");
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<{ input: number; output: number } | null>(null);
  const [copied, setCopied] = useState(false);
  /** Langue forcée à la main ; sinon celle qu'appelle le pays de l'annonce. */
  const [forced, setForced] = useState<CvLanguage | null>(null);
  /** Destinataire : l'adresse de l'annonce, ou le contact trouvé dans l'entreprise. */
  const [target, setTarget] = useState<"offer" | "direct">("offer");

  const existing = applications.find((application) => application.offerId === offer.id);
  const auto = cvFor(offer, profile);
  const language = forced ?? auto.language;
  const cv = profile.cvs?.[language] ?? auto.cv;
  const adEmail = offerEmail(offer);
  const direct = directEmail(offer);
  const toDirect = target === "direct" && Boolean(direct);
  const applied = existing?.status === "sent" || existing?.status === "answered";

  const generate = async () => {
    setWriting(true);
    setError(null);
    try {
      const result = await jobagentApi.writeLetter({
        kind,
        offer,
        cv: cv?.text ?? null,
        notes: notes.trim() || profile.notes || null,
        language,
        question: kind === "answer" ? question : null,
        direct_contact: toDirect,
        already_applied: toDirect && applied,
      });
      setText(result.text);
      setCost({ input: result.input_tokens, output: result.output_tokens });
    } catch (problem) {
      setError((problem as { message?: string }).message ?? "Rédaction impossible");
    } finally {
      setWriting(false);
    }
  };

  const remember = (status: "draft" | "sent") => {
    upsertApplication({
      offerId: offer.id,
      title: offer.title,
      company: offer.company,
      url: offer.url,
      status,
      letter: kind === "letter" ? text : existing?.letter,
      email: kind === "email" ? text : existing?.email,
      directSentAt: existing?.directSentAt,
      updatedAt: new Date().toISOString(),
    });
  };

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    remember("draft");
    setTimeout(() => setCopied(false), 1500);
  };

  const download = async () => {
    const name = `${kind === "email" ? "mail" : "lettre"}-${slug(offer.company ?? offer.title)}.md`;
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Texte", extensions: ["md", "txt"] }],
    });
    if (!path) return;
    await jobagentApi.saveText(path, text);
    remember("draft");
  };

  /** Ouvre le client mail avec l'objet et le corps déjà écrits — l'envoi reste manuel. */
  const openMail = async () => {
    const [subject = "Candidature", ...body] = text.split("\n");
    const to = (toDirect ? direct : adEmail) ?? "";
    const url = `mailto:${to}?subject=${encodeURIComponent(
      subject.replace(/^objet\s*:\s*/i, ""),
    )}&body=${encodeURIComponent(body.join("\n").trim())}`;
    await openUrl(url).catch(() => setError("Aucun client mail configuré sur cette machine."));
    remember("draft");
  };

  /** Confie la suite à l'assistant : il a l'annonce, le CV et le texte sous la main. */
  const handToAssistant = () => {
    const brief = [
      `Aide-moi à postuler à cette offre.`,
      ``,
      `Poste : ${offer.title}`,
      `Entreprise : ${offer.company ?? "—"}`,
      `Lieu : ${offer.location ?? "—"}`,
      `Annonce : ${offer.apply_url ?? offer.url}`,
      ``,
      text ? `Texte préparé :\n${text}` : `Rédige d'abord une lettre de motivation.`,
      ``,
      `Ouvre le formulaire de candidature, remplis-le avec mes informations, et montre-moi`,
      `le récapitulatif avant tout envoi. N'envoie rien sans mon accord explicite.`,
      cv?.file ? `\nMon CV (${LANGUAGE_LABELS[language]}) : ${cv.file}` : "",
    ].join("\n");
    remember("draft");
    openModule("chat", { prompt: brief });
  };

  return (
    <section className="space-y-5 border-t border-border px-5 py-5">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold text-text">Préparer la candidature</h3>
        {applied ? (
          <Badge tone="success">
            <Check size={14} strokeWidth={2} /> envoyée
          </Badge>
        ) : (
          // Candidature déposée sur le site ou depuis le client mail : ARCHIMED ne peut pas
          // le voir. Ce bouton la range dans « Candidatures » et la sort des favoris.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => remember("sent")}
            title="À utiliser après avoir postulé sur le site ou depuis votre messagerie"
          >
            <Check size={14} strokeWidth={1.75} /> Marquer comme envoyée
          </Button>
        )}
      </header>

      <Field label="Type de message">
        <Segmented value={kind} options={KINDS} onChange={setKind} label="Type de message" />
      </Field>

      {kind === "answer" ? (
        <Field label="Question du formulaire">
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Pourquoi souhaitez-vous nous rejoindre ?"
            className={inputClass}
          />
        </Field>
      ) : null}

      <Field label="À mettre en avant" hint="Facultatif : une phrase suffit.">
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="Disponible en janvier, mobilité Lyon…"
          className={cn(inputClass, "h-auto min-h-16 resize-none py-2 leading-relaxed")}
        />
      </Field>

      <div className="flex flex-col gap-4">
        <Field
          label="Langue"
          hint={
            cv?.name
              ? `CV joint : ${cv.name}`
              : "Aucun CV importé : la lettre s'écrira sans lui."
          }
        >
          <Segmented
            value={language}
            options={[
              { value: "fr" as CvLanguage, label: LANGUAGE_LABELS.fr },
              { value: "en" as CvLanguage, label: LANGUAGE_LABELS.en },
            ]}
            onChange={(option) => setForced(option === auto.language ? null : option)}
            label="Langue de la candidature"
          />
        </Field>

        {direct ? (
          <Field
            label="Destinataire"
            hint={
              toDirect
                ? applied
                  ? `${direct} — le message dira que la candidature est déjà partie.`
                  : `${direct} — le message dira que la candidature part par l'annonce.`
                : (adEmail ?? "L'annonce ne donne pas d'adresse : dépôt sur le site.")
            }
          >
            <Segmented
              value={target}
              options={[
                { value: "offer" as const, label: "L'annonce" },
                { value: "direct" as const, label: "Contact direct" },
              ]}
              onChange={setTarget}
              label="Destinataire du message"
            />
          </Field>
        ) : null}
      </div>

      {auto.fallback && !forced ? (
        <p className="text-caption text-warning">
          Pas de CV {LANGUAGE_LABELS[auto.language === "fr" ? "en" : "fr"]} : celui en{" "}
          {LANGUAGE_LABELS[auto.language]} sera joint.
        </p>
      ) : null}

      <Button
        size="lg"
        variant="primary"
        onClick={() => void generate()}
        disabled={writing}
        className="w-full"
      >
        {writing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} strokeWidth={1.75} />
        )}
        {writing ? "Rédaction par Antigravity…" : "Rédiger"}
      </Button>

      {error ? <p className="text-footnote text-danger">{error}</p> : null}

      {text ? (
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            aria-label="Texte de la candidature"
            className={cn(inputClass, "h-auto resize-y p-3 leading-relaxed")}
          />
          {cost ? (
            <p className="text-caption tabular-nums text-text-subtle">
              Antigravity : {cost.input.toLocaleString("fr-FR")} tokens d'entrée,{" "}
              {cost.output.toLocaleString("fr-FR")} générés.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="md" onClick={() => void copy()}>
              {copied ? (
                <Check size={14} strokeWidth={1.75} />
              ) : (
                <Copy size={14} strokeWidth={1.75} />
              )}
              Copier
            </Button>
            <Button size="md" onClick={() => void download()}>
              <FileDown size={14} strokeWidth={1.75} /> Enregistrer
            </Button>
            {kind === "email" ? (
              <Button size="md" onClick={() => void openMail()}>
                <Mail size={14} strokeWidth={1.75} /> Ouvrir dans le client mail
              </Button>
            ) : null}
            <Button size="md" onClick={() => void openUrl(offer.apply_url ?? offer.url)}>
              <ExternalLink size={14} strokeWidth={1.75} /> Ouvrir l'annonce
            </Button>
            <Button size="md" variant="ghost" onClick={handToAssistant}>
              <MessageSquare size={14} strokeWidth={1.75} /> Confier à l'assistant
            </Button>
          </div>
          <p className="text-caption leading-relaxed text-text-subtle">
            Rien ne part d'ici : vous gardez la main sur l'envoi.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
