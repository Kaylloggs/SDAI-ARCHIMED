import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CaseSensitive, ChevronRight, ChevronsDownUp, FileText, ListFilter, Loader2, Regex, RotateCw, Search, WholeWord, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Tooltip } from "@/design-system/primitives";
import { codeApi, type SearchFile, type SearchOptions, type SearchOutcome } from "../api";

type Props = {
  root: string;
  /** Visible (le panneau reste monté quand on revient aux fichiers : la recherche est gardée). */
  active: boolean;
  /** Demande de focus sur le champ (Ctrl+Maj+F) ; change à chaque demande. */
  focusNonce: number;
  onOpenMatch: (path: string, line: number) => void;
};

type State =
  | { phase: "idle" }
  | { phase: "searching"; previous: SearchOutcome | null }
  | { phase: "done"; outcome: SearchOutcome }
  | { phase: "error"; message: string };

const OPTIONS_KEY = "archimed.code.search.options";

function loadOptions(): SearchOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<SearchOptions> | null;
    return { caseSensitive: Boolean(stored?.caseSensitive), wholeWord: Boolean(stored?.wholeWord), regex: Boolean(stored?.regex) };
  } catch {
    return { caseSensitive: false, wholeWord: false, regex: false };
  }
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("fr-FR")} ${count > 1 ? many : one}`;

/**
 * Recherche d'un texte dans tout le projet : résultats groupés par fichier, un clic ouvre le
 * fichier à la ligne. La recherche part 300 ms après la dernière frappe (Entrée : tout de
 * suite) ; une nouvelle recherche interrompt la précédente côté backend.
 */
export function SearchPanel({ root, active, focusNonce, onOpenMatch }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>(loadOptions);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [runNonce, setRunNonce] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const lastRun = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // Stockage indisponible : les options valent pour cette fenêtre.
    }
  }, [options]);

  useEffect(() => {
    if (!active) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [active, focusNonce]);

  // Nouveau projet : on repart de zéro.
  useEffect(() => {
    setQuery("");
    setState({ phase: "idle" });
    setCollapsed(new Set());
  }, [root]);

  useEffect(() => {
    if (!query) {
      request.current += 1;
      setState({ phase: "idle" });
      return;
    }
    const id = ++request.current;
    // Entrée ou « Relancer » : tout de suite ; frappe : 300 ms après la dernière touche.
    const immediate = runNonce !== lastRun.current;
    lastRun.current = runNonce;
    const timer = setTimeout(
      () => {
        setState((current) => ({
          phase: "searching",
          previous: current.phase === "done" ? current.outcome : current.phase === "searching" ? current.previous : null,
        }));
        codeApi
          .searchText(root, query, options, include, exclude)
          .then((outcome) => {
            if (id !== request.current || outcome.cancelled) return;
            setCollapsed(new Set());
            setState({ phase: "done", outcome });
          })
          .catch((error: { message?: string }) => {
            if (id === request.current) setState({ phase: "error", message: error.message ?? "Recherche impossible" });
          });
      },
      immediate ? 0 : 300,
    );
    return () => clearTimeout(timer);
  }, [root, query, options, include, exclude, runNonce]);

  const outcome = state.phase === "done" ? state.outcome : state.phase === "searching" ? state.previous : null;
  const searching = state.phase === "searching";

  const toggle = (key: keyof SearchOptions) => setOptions((current) => ({ ...current, [key]: !current[key] }));

  /** ↑ / ↓ passent d'un résultat à l'autre. */
  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-result]") ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", !active && "hidden")}>
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <div className="flex h-8 items-center gap-1 rounded-md border border-border bg-surface-1 pl-2 pr-1 focus-within:border-border-strong">
          <Search size={14} strokeWidth={1.75} className="shrink-0 text-text-subtle" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setRunNonce((n) => n + 1);
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              } else if (event.key === "ArrowDown") {
                const first = listRef.current?.querySelector<HTMLElement>("[data-result]");
                if (first) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
            placeholder="Rechercher dans le projet"
            aria-label="Texte à rechercher dans le projet"
            spellCheck={false}
            className="selectable min-w-0 flex-1 bg-transparent font-mono text-body-sm text-text outline-none placeholder:font-sans placeholder:text-text-subtle"
          />
          <OptionToggle label="Respecter la casse" pressed={options.caseSensitive} onClick={() => toggle("caseSensitive")}>
            <CaseSensitive size={14} strokeWidth={1.75} />
          </OptionToggle>
          <OptionToggle label="Mot entier" pressed={options.wholeWord} onClick={() => toggle("wholeWord")}>
            <WholeWord size={14} strokeWidth={1.75} />
          </OptionToggle>
          <OptionToggle label="Expression régulière" pressed={options.regex} onClick={() => toggle("regex")}>
            <Regex size={14} strokeWidth={1.75} />
          </OptionToggle>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            title="Fichiers à inclure ou à exclure de la recherche"
            className={cn(
              "flex h-6 items-center gap-1 rounded-sm px-1.5 text-caption transition-colors",
              include || exclude ? "text-accent" : "text-text-subtle hover:text-text",
            )}
          >
            <ListFilter size={12} strokeWidth={1.75} aria-hidden />
            Filtres{include || exclude ? " actifs" : ""}
            <ChevronRight size={12} strokeWidth={1.75} aria-hidden className={cn("transition-transform", filtersOpen && "rotate-90")} />
          </button>
          {outcome && outcome.files.length > 0 && (
            <div className="ml-auto flex items-center">
              <IconButton label="Relancer la recherche" onClick={() => setRunNonce((n) => n + 1)}>
                <RotateCw size={13} strokeWidth={1.75} />
              </IconButton>
              <IconButton
                label="Tout replier"
                onClick={() => setCollapsed(new Set(outcome.files.map((file) => file.path)))}
              >
                <ChevronsDownUp size={13} strokeWidth={1.75} />
              </IconButton>
            </div>
          )}
        </div>

        {filtersOpen && (
          <div className="space-y-1.5">
            <FilterField label="Inclure" value={include} onChange={setInclude} placeholder="ex. src/, *.ts" />
            <FilterField label="Exclure" value={exclude} onChange={setExclude} placeholder="ex. *.test.ts, docs/" />
            <p className="px-0.5 text-caption text-text-subtle">
              Séparés par des virgules. `node_modules`, `target`, `.git` et les fichiers binaires sont toujours ignorés.
            </p>
          </div>
        )}
      </div>

      <Summary state={state} outcome={outcome} query={query} />

      <div ref={listRef} onKeyDown={onListKeyDown} className="min-h-0 flex-1 overflow-y-auto pb-2" aria-busy={searching}>
        {outcome?.files.map((file) => (
          <FileResults
            key={file.path}
            file={file}
            collapsed={collapsed.has(file.path)}
            onToggle={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(file.path)) next.delete(file.path);
                else next.add(file.path);
                return next;
              })
            }
            onOpen={(line) => onOpenMatch(file.path, line)}
          />
        ))}
      </div>
    </div>
  );
}

function Summary({ state, outcome, query }: { state: State; outcome: SearchOutcome | null; query: string }) {
  if (state.phase === "error") {
    return (
      <p role="alert" className="shrink-0 px-3 py-2 text-footnote text-danger">
        {state.message}
      </p>
    );
  }
  if (state.phase === "idle") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Search size={20} strokeWidth={1.5} className="text-text-subtle" aria-hidden />
        <p className="text-footnote text-text-muted">Tapez un mot pour le trouver dans tous les fichiers du projet.</p>
        <p className="text-caption text-text-subtle">Ctrl+Maj+F depuis n'importe où dans Code.</p>
      </div>
    );
  }
  if (!outcome) {
    return (
      <p className="flex shrink-0 items-center gap-2 px-3 py-2 text-footnote text-text-muted" role="status">
        <Loader2 size={13} className="animate-spin" aria-hidden />
        Recherche dans le projet…
      </p>
    );
  }
  const searching = state.phase === "searching";
  if (outcome.files.length === 0 && !searching) {
    return (
      <div className="px-3 py-3" role="status">
        <p className="text-footnote text-text-muted">
          Aucun résultat pour « <span className="font-mono text-text">{query}</span> » dans{" "}
          {plural(outcome.filesSearched, "fichier", "fichiers")}.
        </p>
        <p className="mt-1 text-caption text-text-subtle">Vérifiez l'orthographe, les options (casse, mot entier) ou les filtres.</p>
      </div>
    );
  }
  return (
    <div className="shrink-0 space-y-1 px-3 py-2" role="status">
      <p className="flex items-center gap-1.5 text-caption text-text-subtle">
        {searching && <Loader2 size={12} className="animate-spin" aria-hidden />}
        <span className="tabular-nums">
          {plural(outcome.totalMatches, "résultat", "résultats")} dans {plural(outcome.files.length, "fichier", "fichiers")}
        </span>
      </p>
      {outcome.truncated && (
        <p className="text-caption text-warning">Recherche arrêtée avant la fin (trop de résultats) : précisez le texte ou filtrez les fichiers.</p>
      )}
    </div>
  );
}

function FileResults({
  file,
  collapsed,
  onToggle,
  onOpen,
}: {
  file: SearchFile;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (line: number) => void;
}) {
  const [name, dir] = useMemo(() => {
    const parts = file.relative.split("/");
    return [parts.at(-1) ?? file.relative, parts.slice(0, -1).join("/")];
  }, [file.relative]);

  return (
    <div role="group" aria-label={file.relative}>
      <button
        type="button"
        data-result
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={file.relative}
        className="flex w-full items-center gap-1 px-2 py-1 text-left text-footnote outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.75}
          aria-hidden
          className={cn("shrink-0 text-text-subtle transition-transform", !collapsed && "rotate-90")}
        />
        <FileText size={13} strokeWidth={1.75} aria-hidden className="shrink-0 text-text-subtle" />
        <span className="shrink-0 font-medium text-text">{name}</span>
        {dir && <span className="min-w-0 truncate text-caption text-text-subtle">{dir}</span>}
        <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 text-caption tabular-nums text-text-muted">
          {file.matches}
        </span>
      </button>
      {!collapsed && (
        <ul>
          {file.lines.map((line) => (
            <li key={line.line}>
              <button
                type="button"
                data-result
                onClick={() => onOpen(line.line)}
                aria-label={`${file.relative}, ligne ${line.line}`}
                className="flex w-full items-baseline gap-2 py-0.5 pl-5 pr-2 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
              >
                <span className="w-7 shrink-0 text-right font-mono text-caption tabular-nums text-text-subtle">{line.line}</span>
                <span className="min-w-0 truncate font-mono text-footnote text-text-muted">
                  {line.segments.map((segment, index) =>
                    segment.hit ? (
                      <mark key={index} className="rounded-xs bg-accent-soft px-px text-text">
                        {segment.text}
                      </mark>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </span>
              </button>
            </li>
          ))}
          {file.hiddenLines > 0 && (
            <li className="py-0.5 pl-14 text-caption text-text-subtle">
              et {plural(file.hiddenLines, "autre ligne", "autres lignes")} (ouvrez le fichier)
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function OptionToggle({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip side="bottom" label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-xs transition-colors",
          pressed ? "bg-accent-soft text-accent" : "text-text-subtle hover:bg-surface-2 hover:text-text",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip side="bottom" label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-sm text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function FilterField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-7 items-center gap-2 rounded-sm border border-border bg-surface-1 px-2 focus-within:border-border-strong">
      <span className="w-12 shrink-0 text-caption text-text-subtle">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="selectable min-w-0 flex-1 bg-transparent font-mono text-footnote text-text outline-none placeholder:font-sans placeholder:text-text-subtle"
      />
      {value && (
        <button type="button" aria-label={`Vider « ${label} »`} onClick={() => onChange("")} className="text-text-subtle hover:text-text">
          <X size={12} strokeWidth={1.75} />
        </button>
      )}
    </label>
  );
}
