import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import { jobagentApi } from "../api";
import { useJobAgentStore } from "../store";
import { CV_LANGUAGES, type CvLanguage, type MailSettings } from "../types";
import { Field, focusRing, inputClass, PanelBody, Section, Switch } from "./Panel";

const CV_TITLES: Record<CvLanguage, string> = {
  fr: "CV français",
  en: "CV anglais",
};

const CV_HINTS: Record<CvLanguage, string> = {
  fr: "Joint pour la France, la Belgique, la Suisse, le Luxembourg et Monaco.",
  en: "Joint partout ailleurs. Sans lui, les candidatures à l'étranger partent avec le CV français.",
};

/**
 * Profil : le CV et les quelques informations qui servent aux candidatures, le compte
 * qui les envoie, et l'interrupteur qui donne la recherche d'offres aux agents.
 */
export function ProfilePanel() {
  const { profile, saveProfile, importCv, clearCv, status, refreshStatus } = useJobAgentStore();
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState<CvLanguage | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setDraft(profile), [profile]);

  const pickCv = async (language: CvLanguage) => {
    const path = await open({
      multiple: false,
      filters: [{ name: "CV", extensions: ["pdf", "docx", "txt", "md"] }],
    });
    if (typeof path !== "string") return;
    setBusy(language);
    setError(null);
    try {
      await importCv(path, language);
    } catch (problem) {
      setError((problem as { message?: string }).message ?? "Import impossible");
    } finally {
      setBusy(null);
    }
  };

  const toggleTools = async (enabled: boolean) => {
    setMcpBusy(true);
    setError(null);
    try {
      const result = await jobagentApi.setMcp(enabled);
      setCommand(result.command);
      await refreshStatus();
    } catch (problem) {
      setError((problem as { message?: string }).message ?? "Impossible de changer ce réglage");
    } finally {
      setMcpBusy(false);
    }
  };

  const fields = [
    { key: "name" as const, label: "Nom", placeholder: "Prénom Nom" },
    { key: "email" as const, label: "E-mail", placeholder: "prenom@exemple.fr" },
    { key: "phone" as const, label: "Téléphone", placeholder: "06 12 34 56 78" },
    { key: "city" as const, label: "Ville", placeholder: "Paris" },
    { key: "links" as const, label: "Liens", placeholder: "portfolio, LinkedIn…" },
  ];

  return (
    <PanelBody>
      <Section title="CV" description="Un par langue : ARCHIMED joint celui du pays de l'annonce.">
        {CV_LANGUAGES.map((language) => {
          const cv = profile.cvs?.[language];
          return (
            <div
              key={language}
              className="flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4"
            >
              <div className="flex items-start gap-3">
                <FileText
                  size={16}
                  strokeWidth={1.75}
                  className={cn("mt-0.5 shrink-0", cv ? "text-accent" : "text-text-subtle")}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-body-sm font-medium text-text">{CV_TITLES[language]}</p>
                  {cv ? (
                    <p className="truncate text-caption tabular-nums text-text-subtle">
                      {cv.name}
                      {cv.pages ? ` · ${cv.pages} page${cv.pages > 1 ? "s" : ""}` : ""}
                    </p>
                  ) : (
                    <p className="text-caption leading-relaxed text-text-subtle">
                      {CV_HINTS[language]}
                    </p>
                  )}
                </div>
                {cv ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void clearCv(language)}
                    aria-label={`Retirer le ${CV_TITLES[language]}`}
                    className="hover:text-danger"
                  >
                    <Trash2 size={14} strokeWidth={1.75} />
                  </Button>
                ) : null}
              </div>

              <Button
                size="md"
                variant={cv ? "secondary" : "primary"}
                onClick={() => void pickCv(language)}
                disabled={busy !== null}
                className="w-full"
              >
                {busy === language ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} strokeWidth={1.75} />
                )}
                {cv ? "Remplacer" : "Importer un CV"}
              </Button>
            </div>
          );
        })}
      </Section>

      <Section title="Coordonnées" description="Reprises telles quelles dans les candidatures.">
        {fields.map((field) => (
          <Field key={field.key} label={field.label} htmlFor={`jobagent-${field.key}`}>
            <input
              id={`jobagent-${field.key}`}
              value={draft[field.key] ?? ""}
              onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
              onBlur={() => void saveProfile(draft)}
              placeholder={field.placeholder}
              className={inputClass}
            />
          </Field>
        ))}

        <Field label="À dire dans chaque candidature" htmlFor="jobagent-notes">
          <textarea
            id="jobagent-notes"
            value={draft.notes ?? ""}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            onBlur={() => void saveProfile(draft)}
            rows={3}
            placeholder="Disponibilité, mobilité, ton souhaité…"
            className={cn(
              inputClass,
              "h-auto min-h-20 resize-none py-2 leading-relaxed",
            )}
          />
        </Field>
      </Section>

      <MailAccount />

      <Section
        title="Assistant"
        description="L'agent du Chat peut alors chercher des offres, lire une annonce et consulter votre CV tout seul."
        aside={
          <Switch
            checked={status?.mcp_enabled ?? false}
            onChange={(value) => void toggleTools(value)}
            label="Donner la recherche à l'assistant"
            busy={mcpBusy}
          />
        }
      >
        {status?.mcp_enabled && command ? (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm text-caption text-text-subtle transition-colors hover:text-text",
              focusRing,
            )}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.75} className="text-success" />
            ) : (
              <Copy size={14} strokeWidth={1.75} />
            )}
            {copied ? "Commande copiée" : "Copier la commande pour un terminal"}
          </button>
        ) : null}

        {status && !status.mcp ? (
          <p className="text-caption text-warning">
            Bibliothèque MCP absente du moteur : relancez l'installation.
          </p>
        ) : null}
      </Section>

      {error ? <p className="text-footnote text-danger">{error}</p> : null}
    </PanelBody>
  );
}

/**
 * Compte d'envoi des candidatures.
 *
 * Le mot de passe est chiffré par Windows dès qu'il est enregistré (DPAPI) : il n'est
 * jamais relu par l'interface, seulement déchiffré au moment d'un envoi. Avec Gmail ou
 * Outlook, il faut un **mot de passe d'application**, pas celui du compte.
 */
function MailAccount() {
  const mail = useJobAgentStore((state) => state.mail);
  const saveMail = useJobAgentStore((state) => state.saveMail);
  const [draft, setDraft] = useState<MailSettings>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setDraft(mail ?? {}), [mail]);

  /** Serveur et port déduits de l'adresse : rien à chercher pour les boîtes courantes. */
  const fillFromAddress = async (address: string) => {
    if (!address.includes("@") || draft.host) return;
    const hint = await jobagentApi.smtpHint(address).catch(() => null);
    if (hint) setDraft((current) => ({ ...current, ...hint, user: current.user || address }));
  };

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await saveMail({ ...draft, password: password || undefined });
      setPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (error) {
      setProblem((error as { message?: string }).message ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof MailSettings, label: string, placeholder: string, type = "text") => (
    <Field key={key} label={label} htmlFor={`jobagent-mail-${key}`}>
      <input
        id={`jobagent-mail-${key}`}
        type={type}
        value={(draft[key] as string | number | undefined) ?? ""}
        onChange={(event) =>
          setDraft({
            ...draft,
            [key]: type === "number" ? Number(event.target.value) : event.target.value,
          })
        }
        onBlur={() => key === "from" && void fillFromAddress(String(draft.from ?? ""))}
        placeholder={placeholder}
        className={inputClass}
      />
    </Field>
  );

  return (
    <Section
      title="Compte d'envoi"
      description="Sert aux candidatures envoyées en lot. Gmail et Outlook demandent un mot de passe d'application ; il est chiffré par Windows et ne quitte pas cette machine."
      aside={
        mail?.has_password ? (
          <span className="shrink-0 text-caption font-medium text-success">configuré</span>
        ) : null
      }
    >
      {field("from", "Votre adresse", "prenom@exemple.fr")}
      {field("host", "Serveur d'envoi", "smtp.exemple.fr")}
      <div className="grid grid-cols-2 gap-3">
        {field("port", "Port", "587", "number")}
        {field("user", "Identifiant", "prenom@exemple.fr")}
      </div>

      <Field
        label="Mot de passe d'application"
        hint={mail?.has_password ? "Laisser vide pour garder celui enregistré." : undefined}
        htmlFor="jobagent-mail-password"
      >
        <input
          id="jobagent-mail-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={mail?.has_password ? "••••••••" : "mot de passe d'application"}
          className={inputClass}
        />
      </Field>

      {problem ? <p className="text-caption text-danger">{problem}</p> : null}

      <div>
        <Button size="md" onClick={() => void save()} disabled={busy}>
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : saved ? (
            <Check size={14} strokeWidth={1.75} />
          ) : null}
          {saved ? "Enregistré" : "Enregistrer le compte"}
        </Button>
      </div>
    </Section>
  );
}
