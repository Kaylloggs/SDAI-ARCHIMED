import { useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  ExternalLink,
  Home,
  ImageDown,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Button } from "@/design-system/primitives";
import type { AccountSite } from "@/core/ipc/bindings/AccountSite";
import type { BrowserAction } from "@/core/ipc/bindings/BrowserAction";
import type { BrowserBounds } from "@/core/ipc/bindings/BrowserBounds";
import { errorText, imageMakerApi } from "../api";
import { copyPrompt, currentPrompt } from "../actions";
import { copyImage } from "../clipboard";
import { ACCOUNT_SITES, SITE_INFO, ago } from "../lib/format";
import { currentNode, useImageMaker } from "../store";
import { Label, Segmented, Switch, focusRing } from "./ui";

/**
 * Une fenêtre modale, un menu ou une liste passe au-dessus de l'application : la vue web
 * native, toujours au premier plan, doit s'effacer le temps qu'ils soient ouverts.
 */
function overlayOpen(): boolean {
  if (document.querySelector(".bg-scrim")) return true;
  for (const el of Array.from(document.body.children)) {
    if (el.id === "root" || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    if (el.matches('[role="tooltip"]') || el.querySelector('[role="tooltip"]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }
  return false;
}

function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(overlayOpen);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setOpen(overlayOpen()));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return open;
}

/**
 * Pose la vue web native sur l'élément : elle suit sa taille et sa place, se cache quand
 * l'élément disparaît, qu'une fenêtre passe au-dessus, ou que le studio est quitté.
 */
function useNativeView(site: AccountSite, onError: (message: string) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const covered = useOverlayOpen();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let shown = false;
    const bounds = (): BrowserBounds => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const hide = () => {
      if (!shown) return;
      shown = false;
      void imageMakerApi.browserHide().catch(() => undefined);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const b = bounds();
        if (covered || b.width < 1 || b.height < 1 || document.visibilityState !== "visible") return hide();
        if (!shown) {
          shown = true;
          imageMakerApi.browserOpen(site, b).catch((e) => {
            shown = false;
            onError(errorText(e));
          });
        } else {
          void imageMakerApi.browserBounds(b).catch(() => undefined);
        }
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", sync);
      cancelAnimationFrame(frame);
      hide();
    };
  }, [site, covered, onError]);
  return ref;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Le site officiel dans le studio, à la place de l'image, avec sa barre de navigation. */
export function BrowserView({ site }: { site: AccountSite }) {
  const page = useImageMaker((s) => s.browserPage);
  const [error, setError] = useState<string | null>(null);
  const ref = useNativeView(site, setError);
  const info = SITE_INFO[site];
  const host = page?.url ? hostOf(page.url) : info.host;
  const secure = page?.url ? page.url.startsWith("https://") : true;
  const act = (action: BrowserAction) => void imageMakerApi.browserAction(action).catch((e) => setError(errorText(e)));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-2">
        <Segmented
          label="Site"
          value={site}
          onChange={(next) => void useImageMaker.getState().openBrowser(next)}
          options={ACCOUNT_SITES.map((id) => ({ value: id, label: SITE_INFO[id].name }))}
        />
        <div className="flex shrink-0 items-center">
          <NavButton label="Page précédente" onClick={() => act("back")}>
            <ArrowLeft size={15} />
          </NavButton>
          <NavButton label="Page suivante" onClick={() => act("forward")}>
            <ArrowRight size={15} />
          </NavButton>
          <NavButton label="Recharger" onClick={() => act("reload")}>
            {page?.loading ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={15} />}
          </NavButton>
          <NavButton label={`Accueil de ${info.name}`} onClick={() => act("home")}>
            <Home size={15} />
          </NavButton>
        </div>
        {/* L'adresse reste visible : on sait toujours sur quel site on tape. */}
        <div
          className="flex h-7 min-w-24 flex-1 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-footnote text-text-muted"
          title={page?.url ?? info.url}
        >
          <Lock size={12} className={cn("shrink-0", secure ? "text-success" : "text-warning")} aria-label={secure ? "Connexion chiffrée" : "Connexion non chiffrée"} />
          <span className="truncate text-text">{host}</span>
          {page?.title && <span className="hidden truncate text-text-subtle xl:inline">· {page.title}</span>}
        </div>
        <div className="flex shrink-0 items-center">
          <NavButton label="Ouvrir cette page dans votre navigateur" onClick={() => void openUrl(page?.url || info.url)}>
            <ExternalLink size={15} />
          </NavButton>
          <NavButton label="Fermer le site et revenir à l'image" onClick={() => useImageMaker.getState().closeBrowser()}>
            <X size={15} />
          </NavButton>
        </div>
      </div>
      <div ref={ref} className="relative min-h-0 flex-1 bg-surface-1">
        {/* Visible seulement tant que la vue web n'est pas posée (chargement, fenêtre au-dessus). */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-body-sm text-text-muted">
          {error ? (
            <>
              <p className="text-danger">{error}</p>
              <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => void openUrl(info.url)}>
                Ouvrir {info.host} dans le navigateur
              </Button>
            </>
          ) : (
            <p className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> {info.host}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text",
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/** Panneau de droite en mode site : préparer la demande, puis importer ce qui a été téléchargé. */
export function BrowserSide() {
  const site = useImageMaker((s) => s.browser);
  const received = useImageMaker((s) => s.received);
  const node = useImageMaker((s) => currentNode(s));
  const [attach, setAttach] = useState(true);
  const prompt = currentPrompt();
  const images = received.filter((r) => r.image);
  const info = SITE_INFO[site ?? "gemini"];

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border" aria-label="Depuis le site">
      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <Label>Préparer</Label>
          <div className="flex flex-col items-start gap-1">
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} disabled={!prompt} onClick={() => void copyPrompt(prompt)}>
              Copier la demande
            </Button>
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} disabled={!node} onClick={() => node && void copyImage(node)}>
              Copier l'image affichée
            </Button>
          </div>
          <p className="text-footnote text-text-subtle">
            Collez-les dans {info.name}. L'image ne part sur le site que si vous l'y collez vous-même.
          </p>
        </section>

        <section className="space-y-2" aria-labelledby="im-received">
          <Label>
            <span id="im-received">Images reçues</span>
          </Label>
          {node && (
            <Switch checked={attach} onChange={setAttach}>
              Nouvelle version de l'image affichée
            </Switch>
          )}
          {images.length === 0 ? (
            <p className="flex items-start gap-2 text-footnote text-text-muted">
              <ImageDown size={16} className="mt-0.5 shrink-0 text-text-subtle" />
              Téléchargez l'image sur le site : elle arrive ici. Vous pouvez aussi la copier sur le site puis la coller avec Ctrl+V.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {images.map((file) => (
                <li key={file.path} className="flex items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-footnote">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-text" title={file.path}>
                      {file.name}
                    </p>
                    <p className="text-caption text-text-subtle">{file.imported ? "Importée" : ago(file.at)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={file.imported ? "ghost" : "primary"}
                    icon={<Plus size={14} />}
                    onClick={() => void useImageMaker.getState().importReceived(file.path, attach)}
                  >
                    Importer
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="flex items-start gap-1.5 text-footnote text-text-subtle">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          Le site s'affiche dans une vue séparée : il n'a aucun accès à ARCHIMED, et ARCHIMED ne lit rien de ce que vous y tapez.
          Si le site refuse la connexion ici, ouvrez-le dans votre navigateur (bouton à droite de l'adresse).
        </p>
      </div>
    </aside>
  );
}
