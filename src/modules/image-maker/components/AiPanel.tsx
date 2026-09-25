import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Brush,
  Dice5,
  Expand,
  Eraser,
  ImagePlus,
  Layers,
  Loader2,
  Palette,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Wand2,
  WandSparkles,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { ProviderId } from "@/core/ipc/bindings/ProviderId";
import type { PromptSuggestion } from "@/core/ipc/bindings/PromptSuggestion";
import { errorText, imageMakerApi } from "../api";
import { prepareCreate, prepareEdit, run } from "../actions";
import { usable } from "../lib/capabilities";
import { PROVIDER_NAMES, priceText, usageText } from "../lib/format";
import { STRUCTURE, parseStructure } from "../lib/prompt";
import { RATIOS, extendToRatio, parseRatio, type Anchor } from "../lib/ratio";
import { currentNode, findModel, resolveModel, useImageMaker, type EditTask } from "../store";
import { ImagePanel } from "./ImagePanel";
import { Chip, Label, NumberField, Segmented, Switch, focusRing, inputClass, textareaClass } from "./ui";

/** Panneau de droite : créer, retoucher avec l'IA, ou traiter l'image sur la machine. */
export function AiPanel() {
  const panel = useImageMaker((s) => s.panel);
  const setPanel = useImageMaker((s) => s.setPanel);
  const hasImage = useImageMaker((s) => Boolean(currentNode(s)));
  return (
    <aside aria-label="Panneau IA et propriétés" className="flex w-[clamp(288px,27%,368px)] shrink-0 flex-col border-l border-border">
      <div className="border-b border-border p-3">
        <Segmented
          label="Panneau"
          stretch
          value={panel}
          onChange={setPanel}
          options={[
            { value: "create", label: "Créer" },
            { value: "edit", label: "Retoucher", disabled: !hasImage },
            { value: "image", label: "Image", disabled: !hasImage },
          ]}
        />
      </div>
      {panel === "create" || !hasImage ? <CreatePanel /> : panel === "edit" ? <EditPanel /> : <ImagePanel />}
    </aside>
  );
}

/** Fournisseur qui a un modèle de texte pour améliorer la consigne. */
function textProvider(): ProviderId | null {
  const s = useImageMaker.getState();
  const order: ProviderId[] = [s.provider, "openrouter", "gemini"];
  return order.find((p) => p !== "higgsfield" && usable(s.statuses[p]?.state)) ?? null;
}

function PromptAssistant({ structured }: { structured: boolean }) {
  const draft = useImageMaker((s) => s.draft);
  const setDraft = useImageMaker((s) => s.setDraft);
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<(PromptSuggestion & { provider: ProviderId }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = useImageMaker(() => textProvider());
  const source = structured ? STRUCTURE.map((f) => draft.structure[f.key]).filter(Boolean).join(". ") || draft.prompt : draft.prompt;

  const improve = async () => {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const result = await imageMakerApi.improvePrompt(provider, source, structured);
      if (structured) {
        setDraft({ structure: parseStructure(result.prompt) });
        setSuggestion(null);
      } else {
        setSuggestion({ ...result, provider });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          disabled={busy || !provider || !source.trim()}
          onClick={() => void improve()}
        >
          {structured ? "Remplir avec l'IA" : "Améliorer"}
        </Button>
        <span className="min-w-0 truncate text-caption text-text-subtle">
          {provider ? `Texte envoyé à ${PROVIDER_NAMES[provider]}` : "Clé OpenRouter ou Google nécessaire"}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-footnote text-danger">
          {error}
        </p>
      )}
      {suggestion && (
        <div className="space-y-2 rounded-md border border-border-strong bg-surface-2 p-2.5">
          <textarea
            aria-label="Consigne proposée (modifiable)"
            value={suggestion.prompt}
            onChange={(e) => setSuggestion({ ...suggestion, prompt: e.target.value })}
            rows={5}
            className={textareaClass}
          />
          <p className="text-caption text-text-subtle">
            {suggestion.model} · {usageText(suggestion.usage) ?? ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
              Garder la mienne
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDraft({ prompt: suggestion.prompt });
                setSuggestion(null);
              }}
            >
              Utiliser
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function References() {
  const references = useImageMaker((s) => s.draft.references);
  const nodes = useImageMaker((s) => s.project?.nodes);
  const current = useImageMaker((s) => currentNode(s));
  const { toggleReference, setReferenceRole } = useImageMaker.getState();
  const canAdd = current && !references.some((r) => r.node === current.id);
  return (
    <div className="space-y-2">
      <Label
        aside={
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={!canAdd} onClick={() => current && toggleReference(current.id)}>
            Image affichée
          </Button>
        }
      >
        Images de référence
      </Label>
      {references.length === 0 ? (
        <p className="text-footnote text-text-subtle">
          Personnage, vêtement, décor ou style à reprendre : ajoutez l'image affichée, ou clic droit sur une version.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {references.map((ref) => {
            const node = nodes?.find((n) => n.id === ref.node);
            if (!node) return null;
            return (
              <li key={ref.node} className="flex items-center gap-2">
                <img src={convertFileSrc(node.thumb)} alt="" className="size-9 shrink-0 rounded-sm border border-border object-cover" />
                <input
                  value={ref.role}
                  onChange={(e) => setReferenceRole(ref.node, e.target.value)}
                  placeholder="Rôle : personnage, style, décor…"
                  aria-label={`Rôle de la référence ${node.label}`}
                  className={cn(inputClass, "h-7 text-footnote")}
                />
                <button
                  type="button"
                  aria-label={`Retirer la référence ${node.label}`}
                  onClick={() => toggleReference(ref.node)}
                  className={cn("rounded-sm p-1 text-text-subtle hover:bg-surface-2 hover:text-text", focusRing)}
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CountPicker({ value, onChange, max = 8 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="space-y-1.5">
      <Label>Nombre de résultats</Label>
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 6, 8].filter((n) => n <= max).map((n) => (
          <Chip key={n} active={value === n} onClick={() => onChange(n)}>
            {n}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function CreatePanel() {
  const draft = useImageMaker((s) => s.draft);
  const setDraft = useImageMaker((s) => s.setDraft);
  const focus = useImageMaker((s) => s.focusPrompt);
  const auto = useImageMaker((s) => s.auto);
  const model = useImageMaker((s) => (s.auto ? undefined : findModel(s, s.provider, s.model)));
  const prompt = useRef<HTMLTextAreaElement>(null);
  const caps = model?.capabilities;

  useEffect(() => {
    if (focus > 0) prompt.current?.focus();
  }, [focus]);

  const ratios = caps ? caps.aspectRatios : [...RATIOS];
  const showReferences = auto || Boolean(caps?.imageInput);

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <div className="space-y-2">
          <Label
            htmlFor="im-prompt"
            aside={
              <Switch checked={draft.structured} onChange={(structured) => setDraft({ structured })}>
                Structurer
              </Switch>
            }
          >
            Décrivez l'image
          </Label>
          {draft.structured ? (
            <div className="space-y-2">
              {STRUCTURE.map((field) => (
                <div key={field.key} className="grid grid-cols-[96px_1fr] items-center gap-2">
                  <label htmlFor={`im-${field.key}`} className="text-footnote text-text-muted">
                    {field.label}
                  </label>
                  <input
                    id={`im-${field.key}`}
                    value={draft.structure[field.key] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(e) => setDraft({ structure: { ...draft.structure, [field.key]: e.target.value } })}
                    className={cn(inputClass, "h-7 text-footnote")}
                  />
                </div>
              ))}
            </div>
          ) : (
            <textarea
              id="im-prompt"
              ref={prompt}
              value={draft.prompt}
              onChange={(e) => setDraft({ prompt: e.target.value })}
              rows={5}
              placeholder="Un phare sur une falaise au lever du jour, brume légère, photographie argentique"
              className={textareaClass}
            />
          )}
          <PromptAssistant structured={draft.structured} />
        </div>

        {caps?.negativePrompt && (
          <div className="space-y-1.5">
            <Label htmlFor="im-negative">À éviter</Label>
            <input
              id="im-negative"
              value={draft.negative}
              onChange={(e) => setDraft({ negative: e.target.value })}
              placeholder="Texte, filigrane, flou"
              className={inputClass}
            />
          </div>
        )}

        {showReferences && <References />}

        <div className="space-y-1.5">
          <Label>Format</Label>
          {ratios.length === 0 ? (
            <p className="text-footnote text-text-subtle">Format fixé par ce modèle.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ratios.map((ratio) => (
                <Chip key={ratio} active={draft.ratio === ratio} onClick={() => setDraft({ ratio })}>
                  {ratio}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {caps && caps.resolutions.length > 0 && (
          <div className="space-y-1.5">
            <Label>Résolution</Label>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={draft.resolution === null} onClick={() => setDraft({ resolution: null })}>
                Par défaut
              </Chip>
              {caps.resolutions.map((r) => (
                <Chip key={r} active={draft.resolution === r} onClick={() => setDraft({ resolution: r })}>
                  {r}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <CountPicker value={draft.count} onChange={(count) => setDraft({ count })} />

        {caps && caps.qualities.length > 0 && (
          <div className="space-y-1.5">
            <Label>Qualité</Label>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={draft.quality === null} onClick={() => setDraft({ quality: null })}>
                Par défaut
              </Chip>
              {caps.qualities.map((q) => (
                <Chip key={q} active={draft.quality === q} onClick={() => setDraft({ quality: q })}>
                  {q}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {caps?.seed && (
          <div className="flex items-end gap-2">
            <NumberField
              label="Graine (même graine, même tirage)"
              value={draft.seed}
              onChange={(seed) => setDraft({ seed })}
              placeholder="Aléatoire"
              className="flex-1"
            />
            <Button
              size="md"
              variant="ghost"
              aria-label="Tirer une graine au hasard"
              icon={<Dice5 size={14} />}
              onClick={() => setDraft({ seed: Math.floor(Math.random() * 2 ** 31) })}
            />
          </div>
        )}

        {(auto || caps?.transparentBackground) && (
          <Switch checked={draft.transparent} onChange={(transparent) => setDraft({ transparent })}>
            Fond transparent{auto ? " (si le modèle le propose)" : ""}
          </Switch>
        )}
      </div>
      <PanelFooter kind="create" />
    </>
  );
}

const TASKS: { id: EditTask; label: string; hint: string; Icon: typeof Brush }[] = [
  { id: "inpaint", label: "Zone", hint: "Remplacer, effacer, ajouter ou modifier ce qui est sélectionné. Le reste ne bouge pas d'un pixel.", Icon: ScanLine },
  { id: "edit", label: "Toute l'image", hint: "Décrivez le changement : l'IA reprend l'image entière.", Icon: WandSparkles },
  { id: "outpaint", label: "Étendre", hint: "Agrandit la toile à un autre format ; l'original est replacé tel quel.", Icon: Expand },
  { id: "variation", label: "Variantes", hint: "D'autres versions : dites ce qu'il faut garder.", Icon: Layers },
  { id: "restyle", label: "Style", hint: "Même composition, autre style, décrit librement.", Icon: Palette },
  { id: "background", label: "Fond", hint: "Retirer le fond (transparence) ou le remplacer.", Icon: Eraser },
  { id: "upscale", label: "Améliorer", hint: "Régénère plus net à la plus haute résolution du modèle ; de petits détails peuvent changer.", Icon: Sparkles },
  { id: "restore", label: "Restaurer", hint: "Photo ancienne ou abîmée : bruit, rayures, couleurs passées.", Icon: RotateCcw },
];

const KEEP_SUGGESTIONS = ["le visage", "la pose", "la composition", "les couleurs", "le décor", "la tenue"];
const STYLE_SUGGESTIONS = ["Aquarelle", "Peinture à l'huile", "Croquis au crayon", "Photographie argentique", "Pixel art", "Rendu 3D", "Bande dessinée"];
const ANCHORS: { anchor: Anchor; label: string }[] = [0, 0.5, 1].flatMap((y) =>
  [0, 0.5, 1].map((x) => ({
    anchor: { x, y } as Anchor,
    label: `${y === 0 ? "Haut" : y === 1 ? "Bas" : "Milieu"} ${x === 0 ? "gauche" : x === 1 ? "droite" : "centre"}`,
  })),
);

function EditPanel() {
  const draft = useImageMaker((s) => s.draft);
  const setDraft = useImageMaker((s) => s.setDraft);
  const node = useImageMaker((s) => currentNode(s));
  const mask = useImageMaker((s) => s.mask);
  const maskRevision = useImageMaker((s) => s.maskRevision);
  const focus = useImageMaker((s) => s.focusPrompt);
  const instruction = useRef<HTMLTextAreaElement>(null);
  const task = TASKS.find((t) => t.id === draft.task) ?? TASKS[0]!;
  // Le parcours du masque ne se refait que lorsque la sélection change.
  const bounds = useMemo(
    () => (draft.task === "inpaint" && mask && !mask.isEmpty ? mask.bounds() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.task, mask, maskRevision],
  );

  useEffect(() => {
    if (focus > 0) instruction.current?.focus();
  }, [focus]);

  if (!node) return null;
  const canvas = draft.task === "outpaint" ? extendToRatio(node.width, node.height, parseRatio(draft.extendRatio) ?? 1, draft.anchor) : null;

  const placeholder: Record<EditTask, string> = {
    inpaint:
      draft.inpaintMode === "remove"
        ? "Ce qui doit apparaître à la place (facultatif)"
        : draft.inpaintMode === "add"
          ? "Un chat roux endormi"
          : draft.inpaintMode === "modify"
            ? "En cuir rouge vieilli"
            : "Un dragon aux ailes déployées",
    edit: "Rendre la scène nocturne, avec des lampadaires allumés",
    outpaint: "Ce qui apparaît dans les nouvelles zones (facultatif)",
    variation: "Ce qui change (facultatif) : l'heure, la saison…",
    restyle: "Précision (facultatif)",
    background: draft.backgroundAction === "replace" ? "Une plage au coucher du soleil" : "",
    upscale: "",
    restore: "Précision (facultatif)",
  };
  const needsText = draft.task !== "upscale" && !(draft.task === "background" && draft.backgroundAction === "remove");

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <div className="space-y-2">
          <div role="radiogroup" aria-label="Opération" className="grid grid-cols-4 gap-1">
            {TASKS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={draft.task === id}
                onClick={() => setDraft({ task: id, editCount: id === "variation" ? Math.max(draft.editCount, 4) : draft.editCount })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-caption transition-colors",
                  draft.task === id
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-transparent text-text-muted hover:bg-surface-2 hover:text-text",
                  focusRing,
                )}
              >
                <Icon size={16} strokeWidth={1.75} />
                <span className="w-full truncate text-center">{label}</span>
              </button>
            ))}
          </div>
          <p className="text-footnote text-text-muted">{task.hint}</p>
        </div>

        {draft.task === "inpaint" && (
          <div className="space-y-3">
            <Segmented
              label="Dans la zone"
              stretch
              value={draft.inpaintMode}
              onChange={(inpaintMode) => setDraft({ inpaintMode })}
              options={[
                { value: "replace", label: "Remplacer" },
                { value: "remove", label: "Effacer" },
                { value: "add", label: "Ajouter" },
                { value: "modify", label: "Modifier" },
              ]}
            />
            {bounds ? (
              <p className="flex items-center gap-1.5 text-footnote text-text-muted">
                <ScanLine size={14} className="text-accent" /> Zone de {bounds.width} × {bounds.height} px
              </p>
            ) : (
              <div className="space-y-2 rounded-md border border-dashed border-border-strong p-2.5">
                <p className="text-footnote text-text-muted">
                  Sélectionnez la zone avec le rectangle (M), l'ellipse (O), le lasso (L) ou le pinceau (B).
                </p>
                <Button size="sm" icon={<Brush size={14} />} onClick={() => useImageMaker.getState().setTool("lasso")}>
                  Prendre le lasso
                </Button>
              </div>
            )}
            {draft.inpaintMode === "modify" && (
              <div className="flex flex-wrap gap-1.5">
                {["Changer la couleur en ", "Changer la matière en ", "Rendre plus "].map((start) => (
                  <Chip key={start} active={false} onClick={() => setDraft({ instruction: start })}>
                    {start.trim()}…
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}

        {draft.task === "outpaint" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nouveau format</Label>
              <div className="flex flex-wrap gap-1.5">
                {["16:9", "21:9", "4:3", "3:2", "1:1", "9:16", "3:4", "2:3"].map((ratio) => (
                  <Chip key={ratio} active={draft.extendRatio === ratio} onClick={() => setDraft({ extendRatio: ratio })}>
                    {ratio}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div role="radiogroup" aria-label="Place de l'image d'origine" className="grid grid-cols-3 gap-1">
                {ANCHORS.map(({ anchor, label }) => {
                  const active = draft.anchor.x === anchor.x && draft.anchor.y === anchor.y;
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={label}
                      onClick={() => setDraft({ anchor })}
                      className={cn(
                        "size-6 rounded-xs border transition-colors",
                        active ? "border-accent bg-accent" : "border-border-strong hover:bg-surface-2",
                        focusRing,
                      )}
                    />
                  );
                })}
              </div>
              <p className="text-footnote text-text-muted">
                {canvas
                  ? `${node.width} × ${node.height} → ${canvas.width} × ${canvas.height}. La case pleine place l'image d'origine.`
                  : `L'image est déjà au format ${draft.extendRatio}.`}
              </p>
            </div>
          </div>
        )}

        {draft.task === "variation" && (
          <div className="space-y-1.5">
            <Label htmlFor="im-keep">À garder</Label>
            <input
              id="im-keep"
              value={draft.keep}
              onChange={(e) => setDraft({ keep: e.target.value })}
              placeholder="le visage, la pose"
              className={inputClass}
            />
            <div className="flex flex-wrap gap-1.5">
              {KEEP_SUGGESTIONS.map((item) => {
                const list = draft.keep.split(",").map((k) => k.trim()).filter(Boolean);
                const active = list.includes(item);
                return (
                  <Chip
                    key={item}
                    active={active}
                    onClick={() =>
                      setDraft({ keep: (active ? list.filter((k) => k !== item) : [...list, item]).join(", ") })
                    }
                  >
                    {item}
                  </Chip>
                );
              })}
            </div>
          </div>
        )}

        {draft.task === "restyle" && (
          <div className="space-y-1.5">
            <Label htmlFor="im-style">Style voulu</Label>
            <input
              id="im-style"
              value={draft.style}
              onChange={(e) => setDraft({ style: e.target.value })}
              placeholder="Gravure sur bois, encre noire"
              className={inputClass}
            />
            <div className="flex flex-wrap gap-1.5">
              {STYLE_SUGGESTIONS.map((style) => (
                <Chip key={style} active={draft.style === style} onClick={() => setDraft({ style })}>
                  {style}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {draft.task === "background" && (
          <div className="space-y-2">
            <Segmented
              label="Fond"
              stretch
              value={draft.backgroundAction}
              onChange={(backgroundAction) => setDraft({ backgroundAction })}
              options={[
                { value: "remove", label: "Retirer" },
                { value: "replace", label: "Remplacer" },
              ]}
            />
            {draft.backgroundAction === "remove" && (
              <p className="text-footnote text-text-muted">
                Transparence du modèle s'il la propose ; sinon il pose un fond uni, rendu transparent ici, sur cet ordinateur.
                Pour un fond déjà uni, « Image › Fond » le fait sans IA.
              </p>
            )}
          </div>
        )}

        {draft.task === "upscale" && (
          <p className="rounded-md border border-border bg-surface-1 p-2.5 text-footnote text-text-muted">
            Sans IA et sans rien envoyer : « Image › Agrandir » double ou quadruple la taille sur cet ordinateur.
          </p>
        )}

        {needsText && (
          <div className="space-y-1.5">
            <Label htmlFor="im-instruction">
              {draft.task === "inpaint" && draft.inpaintMode === "remove" ? "À la place" : "Consigne"}
            </Label>
            <textarea
              id="im-instruction"
              ref={instruction}
              value={draft.instruction}
              onChange={(e) => setDraft({ instruction: e.target.value })}
              rows={3}
              placeholder={placeholder[draft.task]}
              className={textareaClass}
            />
          </div>
        )}

        {draft.task === "edit" && <References />}

        {!["upscale", "restore"].includes(draft.task) && !(draft.task === "background" && draft.backgroundAction === "remove") && (
          <CountPicker value={draft.editCount} onChange={(editCount) => setDraft({ editCount })} />
        )}
      </div>
      <PanelFooter kind="edit" />
    </>
  );
}

/** Pied du panneau : ce qui part où, prix publiés, choix Auto, et le bouton qui lance. */
function PanelFooter({ kind }: { kind: "create" | "edit" }) {
  const state = useImageMaker();
  const prepared = kind === "create" ? prepareCreate(state) : prepareEdit(state);
  const task = "task" in prepared ? prepared.task : kind === "create" ? "generate" : state.draft.task;
  const references = "operation" in prepared && "references" in prepared.operation ? prepared.operation.references.length : 0;
  const resolved = resolveModel(state, task, references);
  const running = state.jobs.filter((j) => j.projectId === state.project?.id && (j.status === "running" || j.status === "waiting")).length;
  const [sending, setSending] = useState(false);
  const count = kind === "create" ? state.draft.count : state.draft.editCount;

  const label =
    kind === "create"
      ? count > 1
        ? `Générer ${count} images`
        : "Générer"
      : {
          inpaint: { replace: "Remplacer la zone", remove: "Effacer la zone", add: "Ajouter dans la zone", modify: "Modifier la zone" }[
            state.draft.inpaintMode
          ],
          edit: "Modifier l'image",
          outpaint: `Étendre en ${state.draft.extendRatio}`,
          variation: `Créer ${count} variante${count > 1 ? "s" : ""}`,
          restyle: "Appliquer le style",
          background: state.draft.backgroundAction === "remove" ? "Retirer le fond" : "Remplacer le fond",
          upscale: "Améliorer",
          restore: "Restaurer",
        }[state.draft.task];

  const [sends, plural] =
    kind === "create"
      ? references > 0
        ? ["La consigne et les images de référence", true]
        : ["La consigne", false]
      : task === "inpaint"
        ? ["L'image (autour de la zone) et la sélection", true]
        : task === "outpaint"
          ? ["L'image et les zones à remplir", true]
          : ["L'image", false];

  const price = "model" in resolved ? resolved.model.pricing : [];
  const problem = "problem" in prepared ? prepared.problem : "error" in resolved ? resolved.error : null;

  // Le panneau affiche déjà comment sélectionner une zone : pas de doublon ici.
  const shownProblem = problem && !problem.startsWith("Sélectionnez") ? problem : null;

  return (
    <footer className="space-y-2 border-t border-border p-3">
      {"model" in resolved && (
        <p className="flex items-start gap-1.5 text-footnote text-text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-text-subtle" />
          <span>
            {sends} {plural ? "seront envoyées" : "sera envoyée"} à{" "}
            <span className="text-text">{PROVIDER_NAMES[resolved.provider]}</span> pour traitement
            {state.auto ? (
              <>
                {" "}
                ({resolved.model.name}, choisi par Auto : il {resolved.reasons.join(", ")}).
              </>
            ) : (
              "."
            )}
          </span>
        </p>
      )}
      {"shortfalls" in resolved && resolved.shortfalls.length > 0 && (
        <p className="text-footnote text-warning">Ignoré par ce modèle : {resolved.shortfalls.join(", ")}.</p>
      )}
      {"model" in resolved && (
        <p className="text-caption text-text-subtle">
          {price.length > 0
            ? `Prix publié : ${price.slice(0, 2).map(priceText).join(" · ")}`
            : resolved.model.free
              ? `Sans frais selon ${PROVIDER_NAMES[resolved.provider]}.`
              : `Facturé par ${PROVIDER_NAMES[resolved.provider]} ; prix non publié par son API.`}
        </p>
      )}
      {shownProblem && <p className="text-footnote text-text-muted">{shownProblem}</p>}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={Boolean(problem) || sending}
        icon={sending ? <Loader2 size={16} className="animate-spin" /> : kind === "create" ? <ImagePlus size={16} /> : <Wand2 size={16} />}
        onClick={() => {
          setSending(true);
          void run(kind).finally(() => setSending(false));
        }}
      >
        {label}
      </Button>
      <p className="flex items-center justify-between text-caption text-text-subtle">
        <span>Ctrl + Entrée</span>
        {running > 0 && <span>{running} en cours dans la file</span>}
      </p>
    </footer>
  );
}
