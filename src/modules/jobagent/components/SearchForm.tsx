import { useMemo, useState } from "react";
import { ChevronRight, Search, Square } from "lucide-react";
import { Button, Select } from "@/design-system/primitives";
import { cn } from "@/core/lib/cn";
import { useJobAgentStore } from "../store";
import type { EducationLevel } from "../types";
import { MultiPicker, type PickerOption } from "./MultiPicker";
import { CheckRow, Field, focusRing, inputClass, PanelBody, Section } from "./Panel";
import { TagField } from "./TagField";

/** Métiers proposés tant que la personne n'a rien tapé. */
const DOMAIN_HINTS = ["communication", "design graphique", "marketing", "développeur"];
/** Villes proposées : les plus demandées côté francophone et européen. */
const CITY_HINTS = ["Paris", "Lyon", "Bordeaux", "Amsterdam", "Bruxelles"];

//: Pas de virgule dans ces libellés : le résumé du sélecteur les enchaîne.
const CONTRACTS: PickerOption[] = [
  { value: "fulltime", label: "CDI / temps plein" },
  { value: "contract", label: "CDD / freelance" },
  { value: "temporary", label: "Intérim" },
  { value: "internship", label: "Stage / alternance" },
  { value: "parttime", label: "Temps partiel" },
];

const FRESHNESS = [
  { value: "24", label: "Dernières 24 h" },
  { value: "72", label: "3 derniers jours" },
  { value: "168", label: "7 derniers jours" },
  { value: "336", label: "14 derniers jours" },
  { value: "720", label: "30 derniers jours" },
  { value: "", label: "Sans limite de date" },
];

const SORTS = [
  { value: "date", label: "Les plus récentes" },
  { value: "company", label: "Par entreprise" },
  { value: "domain", label: "Par métier" },
  { value: "education", label: "Par niveau d'études" },
];

/** Nom du pays dans la langue de l'interface, à partir de son indicatif. */
const REGIONS =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["fr"], { type: "region" })
    : null;

export function countryLabel(id: string, code: string): string {
  // `Intl.DisplayNames.of` lève sur tout ce qui n'est pas un indicatif ISO (une source
  // peut en renvoyer un approximatif) : la traduction ne doit jamais casser la page.
  if (/^[A-Za-z]{2}$/.test(code)) {
    try {
      const translated = REGIONS?.of(code.toUpperCase());
      if (translated && translated.toUpperCase() !== code.toUpperCase()) return translated;
    } catch {
      // indicatif inconnu du système : on garde le nom d'origine
    }
  }
  return id.charAt(0).toUpperCase() + id.slice(1);
}

const SELECT_CLASS = cn(
  "h-8 w-full justify-between rounded-md border border-border bg-surface-1 px-3 text-body-sm",
  "transition-colors hover:border-border-strong",
  focusRing,
);

export function SearchForm() {
  const { request, setRequest, runSearch, cancelSearch, searching, progress, sources, error } =
    useJobAgentStore();
  const [refining, setRefining] = useState(false);

  const countryOptions: PickerOption[] = useMemo(
    () =>
      (sources?.countries ?? [])
        .map((country) => ({
          value: country.id,
          label: countryLabel(country.id, country.code),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [sources],
  );

  const siteOptions: PickerOption[] = useMemo(
    () =>
      (sources?.sites ?? []).map((site) => ({
        value: site.id,
        label: site.label,
        hint: site.countries === "all" ? undefined : "zone limitée",
      })),
    [sources],
  );

  const levelOptions: PickerOption[] = useMemo(
    () => (sources?.education ?? []).map((level) => ({ value: level.id, label: level.label })),
    [sources],
  );

  const advanced =
    request.sites.length !== 4 ||
    request.education.length > 0 ||
    request.remote ||
    request.fetch_description ||
    request.sort !== "date";

  return (
    <div className="flex h-full flex-col">
      <PanelBody>
        <Section title="Le poste">
          <TagField
            label="Métiers cherchés"
            values={request.domains}
            onChange={(domains) => setRequest({ domains })}
            placeholder="communication, design…"
            suggestions={request.domains.length ? [] : DOMAIN_HINTS}
          />

          <MultiPicker
            label="Contrats"
            options={CONTRACTS}
            values={request.contracts}
            onChange={(contracts) => setRequest({ contracts })}
            placeholder="Tous les contrats"
            unit="contrats"
          />

          <Field label="Date de publication">
            <Select
              label="Date de publication"
              className={SELECT_CLASS}
              value={request.hours_old ? String(request.hours_old) : ""}
              options={FRESHNESS}
              onChange={(value) => setRequest({ hours_old: value ? Number(value) : null })}
            />
          </Field>
        </Section>

        <Section title="Où chercher">
          <MultiPicker
            label="Pays"
            options={countryOptions}
            values={request.countries}
            onChange={(countries) => setRequest({ countries })}
            placeholder="Choisir un pays"
            searchPlaceholder="Rechercher un pays"
            unit="pays"
          />

          <TagField
            label="Villes"
            values={request.cities}
            onChange={(cities) => setRequest({ cities })}
            placeholder="Tout le pays"
            suggestions={request.cities.length ? [] : CITY_HINTS}
          />
        </Section>

        <Section
          title="Contact direct"
          description="Pendant la recherche, ARCHIMED visite le site de chaque entreprise pour y trouver une adresse de recrutement."
        >
          <CheckRow
            checked={request.find_recruiter}
            onChange={(find_recruiter) => setRequest({ find_recruiter })}
            hint="Compte une à deux secondes par entreprise. Rien n'est envoyé : l'adresse s'affiche sur l'annonce, et un message direct ne part qu'avec votre accord."
          >
            Chercher une adresse chez l'entreprise
          </CheckRow>
        </Section>

        <div className="border-t border-border pt-6">
          <button
            onClick={() => setRefining((current) => !current)}
            aria-expanded={refining}
            className={cn(
              "flex w-full cursor-pointer items-center justify-between rounded-sm py-1",
              "text-body-sm font-medium text-text-muted transition-colors hover:text-text",
              focusRing,
            )}
          >
            <span className="flex items-center gap-2">
              <ChevronRight
                size={14}
                strokeWidth={1.75}
                className={cn("transition-transform duration-150", refining && "rotate-90")}
              />
              Affiner la recherche
            </span>
            {!refining && advanced ? (
              <span className="size-1.5 rounded-full bg-accent" aria-label="réglages modifiés" />
            ) : null}
          </button>

          {refining ? (
            <div className="flex flex-col gap-6 pt-6">
              <MultiPicker
                label="Plateformes"
                options={siteOptions}
                values={request.sites}
                onChange={(sites) => setRequest({ sites })}
                placeholder="Aucune"
                unit="plateformes"
              />

              <MultiPicker
                label="Niveau d'études"
                options={levelOptions}
                values={request.education}
                onChange={(education) => setRequest({ education: education as EducationLevel[] })}
                placeholder="Tous les niveaux"
                unit="niveaux"
              />

              {request.education.length > 0 ? (
                <CheckRow
                  checked={request.include_unknown_education}
                  onChange={(include_unknown_education) =>
                    setRequest({ include_unknown_education })
                  }
                >
                  Garder les annonces qui ne précisent pas le niveau
                </CheckRow>
              ) : null}

              <Field label="Trier par">
                <Select
                  label="Trier par"
                  className={SELECT_CLASS}
                  value={request.sort}
                  options={SORTS}
                  onChange={(value) => setRequest({ sort: value as typeof request.sort })}
                />
              </Field>

              <div className="flex flex-col gap-4">
                <CheckRow checked={request.remote} onChange={(remote) => setRequest({ remote })}>
                  Télétravail uniquement
                </CheckRow>
                <CheckRow
                  checked={request.fetch_description}
                  onChange={(fetch_description) => setRequest({ fetch_description })}
                  hint="Plus lent, mais les lettres tombent plus juste."
                >
                  Lire le texte complet des annonces
                </CheckRow>
              </div>

              <Field label="Résultats par plateforme">
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={request.results_per_query}
                  onChange={(event) =>
                    setRequest({ results_per_query: Math.max(5, Number(event.target.value) || 20) })
                  }
                  className={cn(inputClass, "w-24 tabular-nums")}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </PanelBody>

      <footer className="shrink-0 space-y-3 border-t border-border bg-surface-1/70 px-5 py-4">
        {error ? <p className="text-footnote text-danger">{error}</p> : null}

        {searching ? (
          <>
            <Button size="lg" onClick={() => void cancelSearch()} className="w-full">
              <Square size={16} strokeWidth={1.75} /> Arrêter
            </Button>
            <div className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full bg-accent transition-[width] duration-300 ease-standard"
                style={{ width: `${progress?.total ? (progress.done / progress.total) * 100 : 8}%` }}
              />
            </div>
            <p className="truncate text-caption text-text-subtle" title={progress?.message}>
              {progress?.message || "Interrogation des plateformes…"}
            </p>
          </>
        ) : (
          <>
            <Button
              size="lg"
              variant="primary"
              onClick={() => void runSearch()}
              className="w-full"
              disabled={request.domains.length === 0}
            >
              <Search size={16} strokeWidth={1.75} /> Chercher
            </Button>
            {request.domains.length === 0 ? (
              <p className="text-caption text-text-subtle">
                Ajoutez au moins un métier pour lancer la recherche.
              </p>
            ) : null}
          </>
        )}
      </footer>
    </div>
  );
}
