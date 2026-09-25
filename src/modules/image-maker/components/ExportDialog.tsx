import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { pictureDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Download, FolderOpen, Loader2, Save } from "lucide-react";
import { Button, Select } from "@/design-system/primitives";
import type { ImageExportFormat } from "@/core/ipc/bindings/ImageExportFormat";
import type { ImageExportResult } from "@/core/ipc/bindings/ImageExportResult";
import { errorText, imageMakerApi } from "../api";
import { useImageMaker } from "../store";
import { Chip, Dialog, Label, NumberField, Slider, inputClass } from "./ui";

const FORMATS: { value: ImageExportFormat; label: string; hint: string }[] = [
  { value: "png", label: "PNG", hint: "Sans perte, transparence" },
  { value: "jpeg", label: "JPEG", hint: "Léger, photos" },
  { value: "webp", label: "WebP", hint: "Sans perte, transparence" },
  { value: "tiff", label: "TIFF", hint: "Impression, archives" },
  { value: "gif", label: "GIF", hint: "256 couleurs" },
  { value: "bmp", label: "BMP", hint: "Sans compression" },
];

const SIDES = [null, 4096, 2048, 1080] as const;
const LAST_DIR = "image-maker.export-dir";

function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_DIR);
  } catch {
    return null;
  }
}

export function ExportDialog() {
  const open = useImageMaker((s) => s.dialog === "export");
  const nodes = useImageMaker((s) => s.exportNodes);
  const project = useImageMaker((s) => s.project);
  const settings = useImageMaker((s) => s.settings);
  const set = useImageMaker((s) => s.set);
  const [format, setFormat] = useState<ImageExportFormat>("png");
  const [quality, setQuality] = useState(90);
  const [maxSide, setMaxSide] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [naming, setNaming] = useState("{projet}-{n}");
  const [matte, setMatte] = useState<[number, number, number]>([255, 255, 255]);
  const [directory, setDirectory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImageExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    const last = remembered();
    if (last) setDirectory(last);
    else void pictureDir().then(setDirectory).catch(() => undefined);
  }, [open]);

  const images = (project?.nodes ?? []).filter((n) => nodes.includes(n.id));
  const flattens = format === "jpeg" || format === "bmp";

  const applyPreset = (id: string) => {
    const preset = settings?.exportPresets.find((p) => p.id === id);
    if (!preset) return;
    setFormat(preset.format);
    setQuality(preset.quality);
    setMaxSide(preset.maxSide);
    setCustom(preset.maxSide !== null && !SIDES.includes(preset.maxSide as (typeof SIDES)[number]));
    setNaming(preset.naming);
  };

  const savePreset = async () => {
    if (!settings || !presetName?.trim()) return;
    const id = `p-${Date.now().toString(36)}`;
    const ok = await useImageMaker.getState().saveSettings({
      ...settings,
      exportPresets: [...settings.exportPresets, { id, name: presetName.trim(), format, quality, maxSide, naming }],
    });
    if (ok) setPresetName(null);
  };

  const run = async () => {
    if (!project || !directory) return;
    setBusy(true);
    setError(null);
    try {
      const done = await imageMakerApi.exportImages({
        projectId: project.id,
        nodes: images.map((n) => n.id),
        directory,
        format,
        quality,
        maxSide,
        naming,
        matte,
      });
      setResult(done);
      try {
        localStorage.setItem(LAST_DIR, directory);
      } catch {
        // Préférence de confort seulement.
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={images.length > 1 ? `Exporter ${images.length} images` : "Exporter l'image"}
      description="Une copie est écrite dans le dossier choisi ; le projet ne change pas."
      width={560}
      onClose={() => set({ dialog: null })}
      footer={
        result ? (
          <>
            <Button variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void revealItemInDir(result.files[0] ?? directory ?? "")}>
              Afficher dans l'Explorateur
            </Button>
            <Button variant="primary" onClick={() => set({ dialog: null })}>
              Terminer
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => set({ dialog: null })}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={busy || !directory || images.length === 0}
              icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              onClick={() => void run()}
            >
              Exporter
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-body text-text">
            <CheckCircle2 size={18} className="text-success" />
            {result.files.length > 1 ? `${result.files.length} fichiers enregistrés.` : "Fichier enregistré."}
          </p>
          <ul className="space-y-1 font-mono text-footnote text-text-muted">
            {result.files.slice(0, 8).map((file) => (
              <li key={file} className="truncate">
                {file}
              </li>
            ))}
          </ul>
          {result.notes.map((note) => (
            <p key={note} className="text-footnote text-text-muted">
              {note}
            </p>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {images.slice(0, 8).map((n) => (
              <img key={n.id} src={convertFileSrc(n.thumb)} alt={n.label} className="size-12 shrink-0 rounded-sm border border-border object-cover" />
            ))}
          </div>

          {settings && settings.exportPresets.length > 0 && (
            <div className="space-y-1.5">
              <Label>Préréglage</Label>
              <Select
                label="Préréglage d'export"
                value=""
                placeholder="Choisir un préréglage…"
                options={settings.exportPresets.map((p) => ({ value: p.id, label: p.name }))}
                onChange={applyPreset}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Format</Label>
            <div className="flex flex-wrap gap-1.5">
              {FORMATS.map((f) => (
                <Chip key={f.value} active={format === f.value} onClick={() => setFormat(f.value)} title={`${f.label} : ${f.hint}`}>
                  {f.label}
                </Chip>
              ))}
            </div>
            <p className="text-footnote text-text-subtle">{FORMATS.find((f) => f.value === format)?.hint}</p>
          </div>

          {format === "jpeg" && <Slider label="Qualité" value={quality} min={40} max={100} onChange={setQuality} format={(v) => `${v} %`} />}

          {flattens && (
            <div className="space-y-1.5">
              <Label>Fond des zones transparentes</Label>
              <div className="flex gap-1.5">
                <Chip active={matte[0] === 255} onClick={() => setMatte([255, 255, 255])}>
                  Blanc
                </Chip>
                <Chip active={matte[0] === 0} onClick={() => setMatte([0, 0, 0])}>
                  Noir
                </Chip>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Taille (plus grand côté)</Label>
            <div className="flex flex-wrap items-end gap-1.5">
              {SIDES.map((side) => (
                <Chip
                  key={String(side)}
                  active={!custom && maxSide === side}
                  onClick={() => {
                    setCustom(false);
                    setMaxSide(side);
                  }}
                >
                  {side === null ? "D'origine" : `${side} px`}
                </Chip>
              ))}
              <Chip active={custom} onClick={() => setCustom(true)}>
                Autre
              </Chip>
              {custom && (
                <NumberField label="Plus grand côté" suffix="px" value={maxSide} min={16} max={16384} onChange={setMaxSide} className="w-32" />
              )}
            </div>
            <p className="text-footnote text-text-subtle">Réduction seulement : une image plus petite garde sa taille.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="im-naming">Nom des fichiers</Label>
            <input id="im-naming" value={naming} onChange={(e) => setNaming(e.target.value)} className={inputClass} />
            <p className="text-footnote text-text-subtle">
              {"{projet}"}, {"{version}"}, {"{n}"} (numéro), {"{date}"}. Un fichier existant n'est jamais remplacé.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Dossier</Label>
            <div className="flex gap-2">
              <p className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-1 px-3 py-1.5 font-mono text-footnote text-text-muted">
                {directory ?? "Choisissez un dossier"}
              </p>
              <Button
                icon={<FolderOpen size={14} />}
                onClick={() =>
                  void openDialog({ directory: true, title: "Dossier d'export", defaultPath: directory ?? undefined }).then(
                    (dir) => typeof dir === "string" && setDirectory(dir),
                  )
                }
              >
                Choisir
              </Button>
            </div>
          </div>

          {presetName === null ? (
            <Button size="sm" variant="ghost" icon={<Save size={14} />} onClick={() => setPresetName("")}>
              Enregistrer ces réglages comme préréglage
            </Button>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void savePreset();
              }}
            >
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Nom du préréglage"
                aria-label="Nom du préréglage"
                className={inputClass}
              />
              <Button type="submit" size="md" disabled={!presetName.trim()}>
                Enregistrer
              </Button>
            </form>
          )}

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
