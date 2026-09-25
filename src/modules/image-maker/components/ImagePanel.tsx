import { useEffect, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  HardDrive,
  Link2,
  Link2Off,
  Maximize2,
  RotateCcw,
  RotateCw,
  Scaling,
  SunMedium,
} from "lucide-react";
import { Button, Select } from "@/design-system/primitives";
import { MAX_SIDE } from "../lib/ratio";
import { currentNode, useImageMaker } from "../store";
import { Chip, IconButton, NumberField, Slider, Switch } from "./ui";

const NO_PRESETS: never[] = [];

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-body-sm font-medium text-text">
        <span className="text-text-subtle">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Couleur la plus fréquente sur le bord de l'image (fond uni à rendre transparent). */
async function borderColor(src: string): Promise<[number, number, number]> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = `${src}?sample`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [255, 255, 255];
  ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const counts = new Map<string, { n: number; rgb: [number, number, number] }>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    // Couleurs regroupées par pas de 8 : le bruit de compression ne disperse pas le vote.
    const rgb: [number, number, number] = [data[i]!, data[i + 1]!, data[i + 2]!];
    const key = rgb.map((v) => v >> 3).join(",");
    const entry = counts.get(key) ?? { n: 0, rgb };
    entry.n++;
    counts.set(key, entry);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    add(0, y);
    add(width - 1, y);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rgb ?? [255, 255, 255];
}

/** Traitements faits sur cet ordinateur : rien n'est envoyé, chaque résultat est une version. */
export function ImagePanel() {
  const node = useImageMaker((s) => currentNode(s));
  const presets = useImageMaker((s) => s.settings?.formatPresets) ?? NO_PRESETS;
  const mask = useImageMaker((s) => s.mask);
  useImageMaker((s) => s.maskRevision);
  const busy = useImageMaker((s) => Boolean(s.busy));
  const { local, set, setTool } = useImageMaker.getState();
  const [size, setSize] = useState<{ width: number | null; height: number | null }>({ width: null, height: null });
  const [linked, setLinked] = useState(true);
  const [factor, setFactor] = useState(2);
  const [sharpen, setSharpen] = useState(true);
  const [angle, setAngle] = useState(0);
  const [adjust, setAdjust] = useState({ brightness: 0, contrast: 0, hue: 0 });
  const [blur, setBlur] = useState(8);
  const [tolerance, setTolerance] = useState(40);
  const [color, setColor] = useState<[number, number, number] | null>(null);

  useEffect(() => {
    if (node) setSize({ width: node.width, height: node.height });
    setColor(null);
  }, [node?.id, node?.width, node?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!node) return null;
  const ratio = node.width / node.height;
  const upscaled = { width: Math.round(node.width * factor), height: Math.round(node.height * factor) };
  const tooBig = upscaled.width > MAX_SIDE || upscaled.height > MAX_SIDE;
  const hasSelection = Boolean(mask && !mask.isEmpty);
  const adjusted = adjust.brightness !== 0 || adjust.contrast !== 0 || adjust.hue !== 0;

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-3">
      <p className="flex items-center gap-1.5 text-footnote text-text-muted">
        <HardDrive size={14} className="text-text-subtle" />
        Traité sur cet ordinateur : rien n'est envoyé.
      </p>

      <Section title="Recadrage" icon={<Crop size={14} />}>
        <Button size="sm" icon={<Crop size={14} />} onClick={() => setTool("crop")}>
          Outil Recadrer (C)
        </Button>
        {hasSelection && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              const b = mask?.bounds();
              if (b) void local({ type: "crop", x: b.x, y: b.y, width: b.width, height: b.height });
            }}
          >
            Recadrer sur la sélection
          </Button>
        )}
      </Section>

      <Section title="Taille" icon={<Scaling size={14} />}>
        <div className="flex items-end gap-2">
          <NumberField
            label="Largeur"
            suffix="px"
            value={size.width}
            max={MAX_SIDE}
            onChange={(width) =>
              setSize({ width, height: linked && width ? Math.max(1, Math.round(width / ratio)) : size.height })
            }
          />
          <IconButton
            size="sm"
            label={linked ? "Proportions liées" : "Proportions libres"}
            active={linked}
            onClick={() => setLinked(!linked)}
            className="mb-0.5"
          >
            {linked ? <Link2 size={14} /> : <Link2Off size={14} />}
          </IconButton>
          <NumberField
            label="Hauteur"
            suffix="px"
            value={size.height}
            max={MAX_SIDE}
            onChange={(height) =>
              setSize({ height, width: linked && height ? Math.max(1, Math.round(height * ratio)) : size.width })
            }
          />
        </div>
        {presets.length > 0 && (
          <Select
            label="Taille d'un format"
            value=""
            placeholder="Formats enregistrés…"
            options={presets.map((p) => ({ value: p.id, label: p.name, hint: `${p.width} × ${p.height}` }))}
            onChange={(id) => {
              const preset = presets.find((p) => p.id === id);
              if (preset) {
                setLinked(false);
                setSize({ width: preset.width, height: preset.height });
              }
            }}
          />
        )}
        <Button
          size="sm"
          disabled={busy || !size.width || !size.height || (size.width === node.width && size.height === node.height)}
          onClick={() => size.width && size.height && void local({ type: "resize", width: size.width, height: size.height })}
        >
          Redimensionner
        </Button>
        {!linked && size.width && size.height && Math.abs(size.width / size.height - ratio) > 0.01 && (
          <p className="text-footnote text-text-muted">
            Proportions différentes : l'image sera déformée. Pour changer de format sans déformer, recadrez ou « Retoucher › Étendre ».
          </p>
        )}
      </Section>

      <Section title="Agrandir sans IA" icon={<Maximize2 size={14} />}>
        <div className="flex gap-1.5">
          {[1.5, 2, 3, 4].map((f) => (
            <Chip key={f} active={factor === f} onClick={() => setFactor(f)}>
              ×{String(f).replace(".", ",")}
            </Chip>
          ))}
        </div>
        <Switch checked={sharpen} onChange={setSharpen}>
          Renforcer les détails
        </Switch>
        <p className="text-footnote text-text-muted">
          {tooBig ? `Trop grand (${MAX_SIDE} px de côté au plus).` : `${node.width} × ${node.height} → ${upscaled.width} × ${upscaled.height}`}
        </p>
        <Button size="sm" disabled={busy || tooBig} onClick={() => void local({ type: "upscale", factor, sharpen })}>
          Agrandir
        </Button>
      </Section>

      <Section title="Rotation et miroir" icon={<RotateCw size={14} />}>
        <div className="flex flex-wrap gap-1">
          <IconButton label="Tourner à gauche" disabled={busy} onClick={() => void local({ type: "rotate", degrees: -90 })}>
            <RotateCcw size={16} />
          </IconButton>
          <IconButton label="Tourner à droite" disabled={busy} onClick={() => void local({ type: "rotate", degrees: 90 })}>
            <RotateCw size={16} />
          </IconButton>
          <IconButton label="Miroir horizontal" disabled={busy} onClick={() => void local({ type: "flip", horizontal: true })}>
            <FlipHorizontal2 size={16} />
          </IconButton>
          <IconButton label="Miroir vertical" disabled={busy} onClick={() => void local({ type: "flip", horizontal: false })}>
            <FlipVertical2 size={16} />
          </IconButton>
        </div>
        <Slider label="Angle libre" value={angle} min={-45} max={45} onChange={setAngle} format={(v) => `${v}°`} />
        <Button size="sm" disabled={busy || angle === 0} onClick={() => void local({ type: "rotate", degrees: angle }).then(() => setAngle(0))}>
          Tourner de {angle}°
        </Button>
        {angle !== 0 && <p className="text-footnote text-text-muted">Les coins libérés deviennent transparents.</p>}
      </Section>

      <Section title="Réglages" icon={<SunMedium size={14} />}>
        <Slider label="Luminosité" value={adjust.brightness} min={-100} max={100} onChange={(brightness) => setAdjust({ ...adjust, brightness })} />
        <Slider label="Contraste" value={adjust.contrast} min={-100} max={100} onChange={(contrast) => setAdjust({ ...adjust, contrast })} />
        <Slider label="Teinte" value={adjust.hue} min={-180} max={180} onChange={(hue) => setAdjust({ ...adjust, hue })} format={(v) => `${v}°`} />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={!adjusted} onClick={() => setAdjust({ brightness: 0, contrast: 0, hue: 0 })}>
            Réinitialiser
          </Button>
          <Button
            size="sm"
            disabled={busy || !adjusted}
            onClick={() => void local({ type: "adjust", ...adjust }).then((done) => done && setAdjust({ brightness: 0, contrast: 0, hue: 0 }))}
          >
            Appliquer
          </Button>
        </div>
      </Section>

      <Section title="Fond" icon={<Eraser size={14} />}>
        <div className="space-y-2">
          <p className="text-footnote text-text-muted">Fond d'une seule couleur : il devient transparent.</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void borderColor(convertFileSrc(node.thumb)).then(setColor).catch(() => setColor([255, 255, 255]))}
            >
              Lire la couleur du bord
            </Button>
            {color && (
              <span
                aria-label={`Couleur ${color.join(", ")}`}
                className="size-5 rounded-full border border-border-strong"
                style={{ background: `rgb(${color.join(",")})` }}
              />
            )}
          </div>
          <Slider label="Tolérance" value={tolerance} min={5} max={120} onChange={setTolerance} />
          <Button size="sm" disabled={busy || !color} onClick={() => color && void local({ type: "chromaKey", color, tolerance })}>
            Rendre transparent
          </Button>
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-footnote text-text-muted">
            {hasSelection ? "Flou appliqué autour ou dans la sélection." : "Sélectionnez le sujet pour flouter seulement le fond."}
          </p>
          <Slider label="Intensité du flou" value={blur} min={1} max={40} onChange={setBlur} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !hasSelection}
              onClick={() => void local({ type: "blur", sigma: blur, mask_png: mask!.toDataUrl(), inside: false })}
            >
              Flouter le fond
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void local({ type: "blur", sigma: blur, mask_png: hasSelection ? mask!.toDataUrl() : null, inside: true })}
            >
              {hasSelection ? "Flouter la sélection" : "Flouter l'image"}
            </Button>
          </div>
        </div>
      </Section>

      <p className="pb-2 text-caption text-text-subtle">
        Chaque traitement crée une version : « Annuler » (Ctrl+Z) revient à la précédente.
        <button type="button" className="ml-1 text-accent hover:underline" onClick={() => set({ dock: "history", dockOpen: true })}>
          Voir l'historique
        </button>
      </p>
    </div>
  );
}
