import { useCallback, useEffect, useState } from "react";
import { Check, Settings2, Sparkles } from "lucide-react";
import { Badge, Button } from "@/design-system/primitives";
import { voiceApi, type VoiceProviderStatus } from "../api";
import { Group, Row } from "../components/controls";
import { isWindows } from "../engines/stt";
import { ProviderRow } from "./ConnectionsSection";
import { installAndUse, isActive, message, recommended, size, useModelCatalog } from "./install";
import { AgentRows, ToolRows } from "./InstallParts";
import { ModelsSection } from "./ModelsSection";
import { useVoiceSettings } from "./useVoiceSettings";

/** « Tout installer » : reconnaissance et voix locales conseillées pour cette machine et cette langue. */
function LocalSetup() {
  const { settings } = useVoiceSettings();
  const { models, progress } = useModelCatalog();
  const [error, setError] = useState<string | null>(null);
  if (!models) return null;
  const picks = [recommended(models, "stt", settings.general.language), recommended(models, "tts", settings.general.language)].filter(
    (m): m is NonNullable<typeof m> => m !== null,
  );
  if (picks.length === 0) return null;
  const done = picks.every((m) => isActive(m, settings));
  const running = picks.some((m) => ["downloading", "verifying", "installing"].includes(progress[m.id]?.status ?? m.status));
  const toDownload = picks.filter((m) => m.status !== "installed" && m.status !== "updateAvailable");
  const total = toDownload.reduce((sum, m) => sum + m.sizeMb, 0);

  const run = async () => {
    setError(null);
    try {
      for (const model of picks) await installAndUse(model);
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <section className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border bg-surface-1 p-4" aria-label="Mode local en un clic">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" aria-hidden>
        <Sparkles size={16} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1 basis-72">
        <p className="text-body-sm font-semibold">Voix entièrement locale, en un clic</p>
        <p className="text-footnote text-text-muted">
          {picks.map((m) => m.name).join(" et ")} : choisis pour cette machine et cette langue, puis mis en service. Rien de ce que vous
          dites ne quitte l'ordinateur.
        </p>
        {error && (
          <p role="alert" className="pt-1 text-footnote text-danger">
            {error}
          </p>
        )}
      </div>
      {done ? (
        <Badge tone="success">
          <Check size={11} strokeWidth={2} /> En service
        </Badge>
      ) : (
        <Button size="md" variant="primary" disabled={running} onClick={() => void run()}>
          {running ? "Installation…" : toDownload.length > 0 ? `Tout installer (${size(total)})` : "Utiliser"}
        </Button>
      )}
    </section>
  );
}

export function InstallsSection() {
  const [providers, setProviders] = useState<VoiceProviderStatus[] | null>(null);
  const refreshProviders = useCallback(() => void voiceApi.providers().then(setProviders).catch(() => setProviders([])), []);
  useEffect(refreshProviders, [refreshProviders]);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <LocalSetup />

      <Group title="Agents d'IA" description="Ils répondent et agissent quand vous parlez. L'installation passe par la voie officielle de chaque éditeur ; la connexion se fait dans leur propre fenêtre.">
        <AgentRows />
      </Group>

      <Group title="Outils sur cet ordinateur">
        <ToolRows />
      </Group>

      {(isWindows() || /Mac/i.test(navigator.userAgent)) && (
        <Group title="Voix du système">
          <Row
            label="Langues de reconnaissance et voix"
            hint="Pour la reconnaissance Windows et les voix du système : ajoutez une langue ou une voix (Voix naturelles comprises) dans les réglages du système."
          >
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void voiceApi.openSystemSpeech().catch((e) => setError(message(e)))}
              icon={<Settings2 size={13} strokeWidth={1.75} />}
            >
              Ouvrir les réglages
            </Button>
          </Row>
          {error && (
            <p role="alert" className="py-2 text-footnote text-danger">
              {error}
            </p>
          )}
        </Group>
      )}

      <Group
        title="Services en ligne"
        description="Facultatifs. Chaque clé est vérifiée auprès du fournisseur, puis gardée dans le coffre du système, jamais dans un fichier."
      >
        {providers === null ? (
          <p className="py-3 text-footnote text-text-subtle">Chargement…</p>
        ) : (
          providers.map((provider) => <ProviderRow key={provider.id} provider={provider} onChanged={refreshProviders} />)
        )}
      </Group>

      <h2 className="pb-2 pt-2 text-title-3 font-semibold">Tous les modèles locaux</h2>
      <ModelsSection />
    </>
  );
}

