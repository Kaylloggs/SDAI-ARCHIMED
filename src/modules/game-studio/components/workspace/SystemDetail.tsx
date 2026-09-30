import { useState } from "react";
import { AlertTriangle, Link2, Trash2, X } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, Select } from "@/design-system/primitives";
import type { GameEngine } from "@/core/ipc/bindings/GameEngine";
import type { GameNetMode } from "@/core/ipc/bindings/GameNetMode";
import type { GameSystem } from "@/core/ipc/bindings/GameSystem";
import type { GameSystemStatus } from "@/core/ipc/bindings/GameSystemStatus";
import { consumers, impact } from "../../lib/graph";
import { CATEGORY_LABEL, NET_MODE, SYSTEM_STATUS } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { Bullets, ConfirmButton, ErrorLine, focusRing, TextInput } from "../ui";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-border py-3">
      <p className="text-caption font-medium text-text-subtle">{title}</p>
      {children}
    </div>
  );
}

function Links({ systems, onSelect, empty }: { systems: GameSystem[]; onSelect: (id: string) => void; empty: string }) {
  if (systems.length === 0) return <p className="text-footnote text-text-subtle">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1">
      {systems.map((s) => (
        <button key={s.id} type="button" onClick={() => onSelect(s.id)} className={cn("cursor-pointer rounded-xs bg-surface-2 px-1.5 py-0.5 text-caption text-text-muted hover:text-text", focusRing)}>
          {s.name}
        </button>
      ))}
    </div>
  );
}

/** Exemple de chemin dans le projet, selon le moteur. */
function fileExample(engine: GameEngine | null, id: string): string {
  const pascal = id.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  if (engine === "godot") return `scripts/${id}.gd`;
  if (engine === "unity") return `Assets/Scripts/${pascal}.cs`;
  if (engine === "unreal") return `Source/…/${pascal}.cpp`;
  return "Chemin dans le projet";
}

/** Fiche d'un système : rôle, liens, fichiers, vérifications, et ce que sa modification touche. */
export function SystemDetail({ system, systems, onClose }: { system: GameSystem; systems: GameSystem[]; onClose: () => void }) {
  const apply = useGameStudioStore((s) => s.apply);
  const select = useGameStudioStore((s) => s.selectSystem);
  const multiplayer = useGameStudioStore((s) => (s.current?.graph.network?.topology ?? "none") !== "none");
  const engine = useGameStudioStore((s) => s.current?.project.engine ?? null);
  const [file, setFile] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deps = systems.filter((s) => system.dependencies.includes(s.id));
  const users = consumers(systems, system.id);
  const touched = impact(systems, system.id);

  const update = async (patch: Partial<GameSystem>) => setError(await apply({ op: "upsertSystem", system: { ...system, ...patch } }));

  return (
    <aside aria-label={`Système ${system.name}`} className="w-full shrink-0 space-y-1 rounded-lg border border-border bg-surface-1 p-4 xl:w-[340px]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-title-3 font-semibold">{system.name}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{CATEGORY_LABEL[system.category]}</Badge>
            {system.origin === "custom" && <Badge tone="accent">Propre au jeu</Badge>}
            {system.origin === "detected" && <Badge tone="info">Trouvé dans le code</Badge>}
            <span className="font-mono text-caption text-text-subtle">{system.id}</span>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer la fiche" className={cn("flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-subtle hover:bg-surface-2 hover:text-text", focusRing)}>
          <X size={14} />
        </button>
      </div>
      <p className="pb-2 text-body-sm text-text-muted">{system.role}</p>
      <ErrorLine message={error} onClose={() => setError(null)} />

      <div className="grid grid-cols-2 gap-2 pb-2">
        <Select
          label="État du système"
          value={system.status}
          onChange={(status) => void update({ status: status as GameSystemStatus })}
          options={(Object.keys(SYSTEM_STATUS) as GameSystemStatus[]).map((s) => ({ value: s, label: SYSTEM_STATUS[s].label }))}
        />
        <Select
          label="Mode réseau"
          value={system.network}
          disabled={!multiplayer}
          title={multiplayer ? undefined : "Jeu solo : rien à synchroniser"}
          onChange={(network) => void update({ network: network as GameNetMode })}
          options={(Object.keys(NET_MODE) as GameNetMode[]).map((n) => ({ value: n, label: NET_MODE[n] }))}
        />
      </div>

      {system.risk && (
        <p className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-footnote">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden /> {system.risk}
        </p>
      )}

      <Block title="Dépend de">
        <Links systems={deps} onSelect={select} empty="Aucune dépendance." />
      </Block>
      <Block title="Utilisé par">
        <Links systems={users} onSelect={select} empty="Aucun système ne l'utilise." />
      </Block>
      {touched.length > users.length && (
        <Block title={`À retester s'il change (${touched.length})`}>
          <Links systems={touched} onSelect={select} empty="" />
        </Block>
      )}
      {system.produces.length > 0 && (
        <Block title="Événements émis">
          <p className="font-mono text-caption text-text-muted">{system.produces.join(" · ")}</p>
        </Block>
      )}
      {system.data.length > 0 && (
        <Block title="Données">
          <p className="font-mono text-caption text-text-muted">{system.data.join(" · ")}</p>
        </Block>
      )}
      {system.interfaces.length > 0 && (
        <Block title="Interfaces">
          <p className="font-mono text-caption text-text-muted">{system.interfaces.join(" · ")}</p>
        </Block>
      )}
      <Block title="Fichiers">
        {system.files.length > 0 ? (
          <ul className="space-y-0.5">
            {system.files.map((f) => (
              <li key={f} className="truncate font-mono text-caption text-text-muted" title={f}>
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-footnote text-text-subtle">Aucun fichier rattaché : les agents les ajoutent en écrivant le code.</p>
        )}
        <form
          className="flex gap-1.5 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file.trim()) return;
            void apply({ op: "linkFiles", id: system.id, files: [file.trim()] }).then((message) => {
              setError(message);
              if (!message) setFile("");
            });
          }}
        >
          <TextInput value={file} onChange={(e) => setFile(e.target.value)} placeholder={fileExample(engine, system.id)} aria-label="Fichier à rattacher" className="min-w-0 flex-1 font-mono text-caption" />
          <Button size="sm" variant="secondary" icon={<Link2 size={13} />} type="submit" disabled={!file.trim()}>
            Rattacher
          </Button>
        </form>
      </Block>
      {system.tests.length > 0 && (
        <Block title="Vérifications attendues">
          <Bullets items={system.tests} />
        </Block>
      )}
      <div className="flex justify-end border-t border-border pt-3">
        <ConfirmButton
          label="Retirer du graphe"
          confirmLabel={users.length ? "Utilisé par d'autres" : "Confirmer le retrait"}
          icon={<Trash2 size={13} />}
          disabled={users.length > 0}
          onConfirm={() =>
            void apply({ op: "removeSystem", id: system.id }).then((message) => {
              setError(message);
              if (!message) onClose();
            })
          }
        />
      </div>
    </aside>
  );
}
