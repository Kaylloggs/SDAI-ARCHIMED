import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { Badge, Button, EmptyState } from "@/design-system/primitives";
import type { GameMcpServer } from "@/core/ipc/bindings/GameMcpServer";
import { errorText, gameStudioApi } from "../../api";
import { ago, ENGINE_LABEL, MCP_SOURCE, MCP_STATE, splitCommand } from "../../lib/labels";
import { useGameStudioStore } from "../../store";
import { ConfirmButton, ErrorLine, focusRing, Segmented, TextInput, ToneBadge } from "../ui";

const TARGET_LABEL: Record<string, string> = { ...ENGINE_LABEL, blender: "Blender" };

function ServerRow({ server, projectId, onChange }: { server: GameMcpServer; projectId: string | null; onChange: (servers: GameMcpServer[] | null) => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = server.health;
  const where = server.command ? [server.command, ...server.args].join(" ") : (server.url ?? "");

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      await gameStudioApi.checkMcp(server.key, projectId);
      onChange(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-body-sm font-medium">{server.name}</p>
        {server.target && <Badge tone="accent">{TARGET_LABEL[server.target] ?? server.target}</Badge>}
        <span className="text-caption text-text-subtle">{server.transport === "stdio" ? "Local" : server.transport === "http" ? "HTTP" : "HTTP+SSE"}</span>
        {health && <ToneBadge tone={MCP_STATE[health.state].tone}>{MCP_STATE[health.state].label}</ToneBadge>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="secondary" icon={checking ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} disabled={checking} onClick={() => void check()}>
            {checking ? "Test…" : health ? "Tester à nouveau" : "Tester"}
          </Button>
          {server.removable && (
            <ConfirmButton
              label="Retirer"
              ariaLabel={`Retirer ${server.name}`}
              icon={<Trash2 size={13} />}
              confirmLabel="Confirmer le retrait"
              onConfirm={() =>
                void gameStudioApi
                  .removeMcp(server.name)
                  .then(onChange)
                  .catch((e) => setError(errorText(e)))
              }
            />
          )}
        </div>
      </div>
      <p className="truncate font-mono text-caption text-text-muted" title={where}>
        {where}
      </p>
      <p className="text-caption text-text-subtle">
        Pour : {server.agents.join(", ")}
        {server.envKeys.length > 0 && ` · variables : ${server.envKeys.join(", ")}`}
        {server.headerKeys.length > 0 && ` · en-têtes : ${server.headerKeys.join(", ")}`}
      </p>
      {health && (
        <div className="space-y-1">
          <p className="text-footnote text-text-muted">
            {health.message}
            {health.server && ` ${health.server}${health.version ? ` ${health.version}` : ""}.`} <span className="text-text-subtle">{ago(health.checkedAt)}</span>
          </p>
          {health.tools.length > 0 && (
            <details>
              <summary className={cn("cursor-pointer text-caption text-text-subtle hover:text-text", focusRing)}>Outils ({health.tools.length})</summary>
              <ul className="space-y-0.5 pt-1">
                {health.tools.map((tool) => (
                  <li key={tool.name} className="text-caption">
                    <span className="font-mono text-text">{tool.name}</span>
                    {tool.description && <span className="text-text-subtle"> · {tool.description}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <ErrorLine message={error} onClose={() => setError(null)} />
    </li>
  );
}

function AddServer({ onAdded }: { onAdded: (servers: GameMcpServer[]) => void }) {
  const [kind, setKind] = useState<"command" | "url">("command");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parts = splitCommand(value);
      const servers = await gameStudioApi.addMcp(
        kind === "command" ? { name, command: parts[0] ?? null, args: parts.slice(1), url: null } : { name, command: null, args: [], url: value.trim() },
      );
      setName("");
      setValue("");
      onAdded(servers);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Ajouter un serveur" className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
      <div className="space-y-0.5">
        <h3 className="text-body font-semibold">Ajouter un serveur pour les agents d'ARCHIMED</h3>
        <p className="text-footnote text-text-muted">
          La commande ou l'adresse donnée par l'auteur du serveur. Il sera proposé à Claude Code et Antigravity lancés par ARCHIMED. Pas de clé ici : gardez les secrets dans la configuration du serveur.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          label="Type de serveur"
          value={kind}
          onChange={setKind}
          options={[
            { value: "command", label: "Commande locale" },
            { value: "url", label: "Adresse HTTP" },
          ]}
        />
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom (ex. godot)" aria-label="Nom du serveur" className="w-40" />
        <TextInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={kind === "command" ? "ex. node C:\\outils\\serveur-mcp\\index.js" : "ex. http://127.0.0.1:8080/mcp"}
          aria-label={kind === "command" ? "Commande" : "Adresse"}
          className="min-w-[16rem] flex-1 font-mono text-caption"
        />
        <Button variant="primary" icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} disabled={busy || !name.trim() || !value.trim()} onClick={() => void submit()}>
          Ajouter
        </Button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
    </section>
  );
}

/** Intégrations : les serveurs MCP connus de la machine, testés pour de vrai, et ceux ajoutés ici. */
export function IntegrationsSection() {
  const projectId = useGameStudioStore((s) => s.openId);
  const engine = useGameStudioStore((s) => s.current?.project.engine ?? null);
  const reload = useGameStudioStore((s) => s.reload);
  const [servers, setServers] = useState<GameMcpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setServers(await gameStudioApi.mcpServers(projectId));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = (next: GameMcpServer[] | null) => {
    if (next) setServers(next);
    else void load();
    // Les capacités « via MCP » du projet dépendent des tests.
    void reload();
  };

  if (servers === null) {
    return error ? <ErrorLine message={error} onClose={() => setError(null)} /> : <p className="text-footnote text-text-subtle">Lecture des configurations…</p>;
  }

  const forEngine = engine ? servers.filter((s) => s.target === engine) : [];
  const groups = [...new Set(servers.map((s) => s.source))];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
      <div className="space-y-2 rounded-lg border border-border bg-surface-1 px-4 py-3 text-footnote text-text-muted">
        <p>
          Les commandes de Game Studio (vérifier, tester, exporter, systèmes, tâches…) sont déjà proposées aux agents par le serveur MCP d'ARCHIMED (module Voix) : rien à configurer.
        </p>
        <p>
          Ici, les serveurs MCP de vos outils. Un serveur pour{engine ? ` ${ENGINE_LABEL[engine]}` : " votre moteur"} permet à un agent de piloter l'éditeur (scènes, objets) ; il n'est considéré comme prêt qu'après un test réussi. Tester lance le programme configuré.
        </p>
        {engine && forEngine.length === 0 && <p className="text-text">Aucun serveur MCP pour {ENGINE_LABEL[engine]} n'est configuré sur cette machine. Game Studio passe alors par la ligne de commande et les fichiers du projet.</p>}
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void load()}>
          Relire les configurations
        </Button>
      </div>
      <ErrorLine message={error} onClose={() => setError(null)} />
      </div>

      {servers.length === 0 ? (
        <EmptyState icon={<Plug size={28} />} title="Aucun serveur MCP configuré" description="Ni Claude Code, ni Claude Desktop, ni Cursor, ni Codex, ni Gemini, ni Antigravity n'en déclare sur cette machine. Ajoutez-en un ci-dessous." />
      ) : (
        groups.map((source) => (
          <section key={source} aria-label={MCP_SOURCE[source]} className="space-y-2">
            <h3 className="text-title-3 font-semibold">{MCP_SOURCE[source]}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
              {servers
                .filter((s) => s.source === source)
                .map((server) => (
                  <ServerRow key={server.key} server={server} projectId={projectId} onChange={changed} />
                ))}
            </ul>
          </section>
        ))
      )}

      <AddServer onAdded={(next) => changed(next)} />
    </div>
  );
}
