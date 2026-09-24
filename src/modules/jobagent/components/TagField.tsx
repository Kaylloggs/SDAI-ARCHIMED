import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/core/lib/cn";

/**
 * Saisie à puces : un domaine, une ville, un mot-clé par étiquette.
 * Entrée ou virgule valide, Retour arrière sur un champ vide retire la dernière.
 */
export function TagField({
  values,
  onChange,
  placeholder,
  suggestions = [],
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  label?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const value = raw.trim().replace(/,$/, "");
    if (!value || values.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    }
    if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  const unused = suggestions.filter(
    (item) => !values.some((value) => value.toLowerCase() === item.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      {label ? <p className="text-footnote font-medium text-text-muted">{label}</p> : null}
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-bg hover:border-border-strong">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-xs border border-accent/25 bg-accent/15 px-2 py-0.5 text-caption font-medium text-accent"
          >
            {value}
            <button
              onClick={() => onChange(values.filter((item) => item !== value))}
              aria-label={`Retirer ${value}`}
              className="cursor-pointer opacity-70 transition-opacity hover:opacity-100"
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={values.length ? "" : placeholder}
          className="selectable min-w-24 flex-1 bg-transparent py-0.5 text-body-sm outline-none placeholder:text-text-subtle"
        />
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {unused.slice(0, 8).map((item) => (
            <button
              key={item}
              onClick={() => add(item)}
              className={cn(
                "cursor-pointer rounded-xs border border-border/80 bg-surface-1/40 px-2 py-0.5 text-caption text-text-subtle transition-colors",
                "hover:border-accent hover:bg-surface-2 hover:text-accent",
              )}
            >
              + {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
