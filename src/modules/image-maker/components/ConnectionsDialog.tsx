import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { useEnabledModules } from "@/core/modules";
import { Badge, Button } from "@/design-system/primitives";
import type { HiggsfieldModelSpec } from "@/core/ipc/bindings/HiggsfieldModelSpec";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import { errorText, imageMakerApi } from "../api";
import { usable } from "../lib/capabilities";
import { PROVIDER_NAMES, PROVIDERS, stateLook } from "../lib/format";
import { useImageMaker } from "../store";
import { AccountLink } from "./AccountDialog";
import { Chip, Dialog, Label, Switch, focusRing, inputClass } from "./ui";

export function ConnectionsDialog() {
  const open = useImageMaker((s) => s.dialog === "connections");
  const set = useImageMaker((s) => s.set);
  const settings = useImageMaker((s) => s.settings);
  const [checking, setChecking] = useState(false);

  return (
    <Dialog
      open={open}
      title="Connexions"
      description="Clés d'API des fournisseurs d'images, ou connexion avec votre compte."
      width={640}
      onClose={() => set({ dialog: null })}
      footer={
        <>
          <p className="mr-auto flex items-center gap-1.5 text-footnote text-text-muted">
            <ShieldCheck size={14} className="shrink-0" />
            Clés rangées dans le Gestionnaire d'identifiants de Windows. Aucun mot de passe demandé.
          </p>
          <Button
            size="sm"
            icon={checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            disabled={checking}
            className="shrink-0 whitespace-nowrap"
            onClick={() => {
              setChecking(true);
              void useImageMaker.getState().refreshStatuses(true).finally(() => setChecking(false));
            }}
          >
            Tout vérifier
          </Button>
        </>
      }
    >
      <div className="divide-y divide-border">
        {PROVIDERS.map((provider) => (
          <ProviderRow key={provider} provider={provider} />
        ))}
      </div>
      {settings && (
        <div className="mt-2 space-y-2 border-t border-border pt-4">
          <Label>Demandes en même temps, par fournisseur</Label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <Chip
                key={n}
                active={settings.parallelPerProvider === n}
                onClick={() => void useImageMaker.getState().saveSettings({ ...settings, parallelPerProvider: n })}
              >
                {n}
              </Chip>
            ))}
          </div>
          <p className="text-footnote text-text-subtle">Les autres attendent leur tour dans la file.</p>
        </div>
      )}
    </Dialog>
  );
}

function ProviderRow({ provider }: { provider: ProviderId }) {
  const status = useImageMaker((s) => s.statuses[provider]);
  if (status?.access === "account") return <AccountRow provider={provider} />;
  return <KeyRow provider={provider} />;
}

/** Fournisseur sans clé : l'état du compte, et le chemin vers « Créer avec votre compte ». */
function AccountRow({ provider }: { provider: ProviderId }) {
  const status = useImageMaker((s) => s.statuses[provider]);
  const look = stateLook(status);
  return (
    <section className="flex items-start justify-between gap-3 py-4 first:pt-0" aria-label={PROVIDER_NAMES[provider]}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-body font-semibold text-text">{PROVIDER_NAMES[provider]}</h3>
          <Badge tone={look.tone}>{look.label}</Badge>
        </div>
        <p className="text-footnote text-text-muted">
          Votre compte et vos crédits, sans clé d'API : connexion dans votre navigateur.
          {status?.credits && <span> · {status.credits}</span>}
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0"
        icon={<UserRound size={14} />}
        onClick={() => useImageMaker.getState().set({ dialog: "account" })}
      >
        {usable(status?.state) ? "Gérer" : status?.state === "cliMissing" ? "Installer" : "Se connecter"}
      </Button>
    </section>
  );
}

function KeyRow({ provider }: { provider: ProviderId }) {
  const status = useImageMaker((s) => s.statuses[provider]);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const look = status ? stateLook(status) : null;
  const hasKey = status && status.state !== "apiKeyMissing";
  const modules = useEnabledModules();
  const sharedId = status?.keySource?.kind === "shared" ? status.keySource.module : null;
  const shared = sharedId ? (modules.find((m) => m.id === sharedId)?.name ?? sharedId) : null;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    act(async () => {
      await imageMakerApi.setKey(provider, key);
      setKey("");
      setEditing(false);
      await useImageMaker.getState().refreshStatuses(false);
      await useImageMaker.getState().loadModels(provider, true);
    });

  return (
    <section className="space-y-3 py-4 first:pt-0" aria-label={PROVIDER_NAMES[provider]}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-body font-semibold text-text">{PROVIDER_NAMES[provider]}</h3>
            {look ? <Badge tone={look.tone}>{look.label}</Badge> : <Loader2 size={12} className="animate-spin text-text-subtle" />}
          </div>
          <p className="text-footnote text-text-muted">
            {status?.maskedKey && <span className="font-mono">{status.maskedKey}</span>}
            {shared && <span> · clé de {shared}, relue sur place (jamais copiée)</span>}
            {status?.credits && <span> · {status.credits}</span>}
          </p>
          {status?.detail && <p className="text-footnote text-text-muted">{status.detail}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasKey && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {shared ? "Utiliser une autre clé" : "Remplacer"}
            </Button>
          )}
          {hasKey && !shared && !editing &&
            (confirmRemove ? (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await imageMakerApi.clearKey(provider);
                    setConfirmRemove(false);
                    await useImageMaker.getState().refreshStatuses(false);
                  })
                }
              >
                Confirmer le retrait
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmRemove(true)}>
                Retirer
              </Button>
            ))}
        </div>
      </div>

      {(!hasKey || editing) && status && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim()) void save();
          }}
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={status.keyHint}
                aria-label={`Clé ${PROVIDER_NAMES[provider]}`}
                className={cn(inputClass, "pl-8 font-mono")}
              />
            </div>
            <Button type="submit" variant="primary" disabled={busy || !key.trim()} icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              Vérifier et enregistrer
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => void openUrl(status.keyUrl)} className={cn("inline-flex items-center gap-1 text-footnote text-accent hover:underline", focusRing)}>
              Obtenir une clé <ExternalLink size={12} />
            </button>
            {editing && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Annuler
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}

      {!hasKey && <AccountLink site={provider} />}
      {provider === "higgsfield" && <HiggsfieldModels />}
    </section>
  );
}

const EMPTY_SPEC: HiggsfieldModelSpec = {
  id: "",
  name: "",
  aspectRatios: [],
  resolutions: [],
  seed: false,
  imageField: null,
  imageFieldList: false,
  extra: null,
  source: "user",
};

/** L'API Higgsfield ne liste pas ses modèles : on ajoute ceux de sa documentation, à la main. */
function HiggsfieldModels() {
  const settings = useImageMaker((s) => s.settings);
  const [draft, setDraft] = useState<HiggsfieldModelSpec | null>(null);
  const [ratios, setRatios] = useState("");
  const [resolutions, setResolutions] = useState("");
  if (!settings) return null;
  const list = settings.higgsfieldModels;
  const save = async (models: HiggsfieldModelSpec[]) => useImageMaker.getState().saveSettings({ ...settings, higgsfieldModels: models });
  const split = (text: string) => text.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="space-y-2">
      <Label
        aside={
          !draft && (
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setDraft({ ...EMPTY_SPEC })}>
              Ajouter un modèle
            </Button>
          )
        }
      >
        Modèles ajoutés
      </Label>
      <p className="text-footnote text-text-subtle">
        L'API ne publie pas la liste des modèles : trois exemples des SDK officiels sont proposés. Ajoutez un autre modèle avec
        l'identifiant et les arguments donnés par la documentation Higgsfield.
      </p>
      {list.map((m) => (
        <div key={m.id} className="flex items-center gap-2 text-footnote">
          <span className="min-w-0 flex-1 truncate">
            <span className="text-text">{m.name}</span> <span className="font-mono text-text-subtle">{m.id}</span>
          </span>
          <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`Retirer ${m.name}`} onClick={() => void save(list.filter((x) => x.id !== m.id))} />
        </div>
      ))}
      {draft && (
        <form
          className="space-y-2 rounded-md border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const spec = { ...draft, aspectRatios: split(ratios), resolutions: split(resolutions) };
            void save([...list.filter((m) => m.id !== spec.id), spec]).then((ok) => ok && setDraft(null));
          }}
        >
          <input className={cn(inputClass, "font-mono")} placeholder="Identifiant : bytedance/seedream/v4/text-to-image" aria-label="Identifiant de l'application" value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value.trim() })} />
          <input className={inputClass} placeholder="Nom affiché" aria-label="Nom affiché" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className={inputClass} placeholder="Formats acceptés (aspect_ratio) : 1:1, 16:9" aria-label="Formats acceptés" value={ratios} onChange={(e) => setRatios(e.target.value)} />
          <input className={inputClass} placeholder="Résolutions (resolution) : 2K, 4K" aria-label="Résolutions acceptées" value={resolutions} onChange={(e) => setResolutions(e.target.value)} />
          <input className={cn(inputClass, "font-mono")} placeholder="Argument des images d'entrée (facultatif) : image_urls" aria-label="Argument des images d'entrée" value={draft.imageField ?? ""} onChange={(e) => setDraft({ ...draft, imageField: e.target.value.trim() || null })} />
          <div className="flex flex-wrap gap-3">
            <Switch checked={draft.seed} onChange={(seed) => setDraft({ ...draft, seed })}>
              Accepte seed
            </Switch>
            <Switch checked={draft.imageFieldList} onChange={(imageFieldList) => setDraft({ ...draft, imageFieldList })} disabled={!draft.imageField}>
              Liste d'adresses
            </Switch>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Annuler
            </Button>
            <Button size="sm" type="submit" disabled={!draft.id}>
              Ajouter
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
