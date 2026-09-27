import { useEffect, useState } from "react";
import { errorText, skillsApi, type DraftFile, type DraftInfo, type DraftReport } from "../../api";
import { fixMessage } from "../../lib/maker";
import { ChangesTab } from "./ChangesTab";
import { CheckTab } from "./CheckTab";
import { FilesTab, type FileFocus } from "./FilesTab";
import { SaveBar } from "./SaveBar";
import { TestsTab, type Agent } from "./TestsTab";
import { Segmented } from "./ui";

type Tab = "files" | "check" | "tests" | "changes";

type Props = {
  draft: DraftInfo;
  /** Change à chaque fin de tour de l'IA ou retouche : tout est relu. */
  revision: number;
  agent: Agent;
  /** Dépose un message dans la saisie de l'atelier (jamais envoyé seul). */
  onPrefill: (text: string) => void;
  onChanged: () => void;
  onSaved: (info: DraftInfo) => void;
};

/** Colonne droite de l'atelier : fichiers, vérification, essais, différences, enregistrement. */
export function Inspector({ draft, revision, agent, onPrefill, onChanged, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [report, setReport] = useState<DraftReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FileFocus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([skillsApi.draftFiles(draft.id), skillsApi.draftCheck(draft.id)])
      .then(([list, checked]) => {
        if (cancelled) return;
        setFiles(list);
        setReport(checked);
        setReportError(null);
      })
      .catch((e) => !cancelled && setReportError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [draft.id, revision]);

  useEffect(() => {
    setReport(null);
    setFocus(null);
    if (draft.kind !== "edit") setTab((current) => (current === "changes" ? "files" : current));
  }, [draft.id, draft.kind]);

  const problems = report?.issues.filter((issue) => issue.level !== "info").length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <Segmented<Tab>
          label="Inspecteur du skill"
          value={tab}
          onChange={setTab}
          options={[
            { value: "files", label: "Fichiers", count: files.length },
            { value: "check", label: "Vérification", count: problems },
            { value: "tests", label: "Tests" },
            ...(draft.kind === "edit" ? [{ value: "changes" as const, label: "Modifications" }] : []),
          ]}
        />
      </div>

      <div className={tab === "files" ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-y-auto overflow-x-hidden"}>
        {tab === "files" && <FilesTab draft={draft} files={files} revision={revision} focus={focus} onChanged={onChanged} />}
        {tab === "check" && (
          <CheckTab
            report={report}
            error={reportError}
            onReveal={(file, line) => {
              setFocus({ path: file, line, nonce: Date.now() });
              setTab("files");
            }}
            onFix={() => report && onPrefill(fixMessage(report.issues))}
          />
        )}
        {tab === "tests" && <TestsTab draft={draft} revision={revision} agent={agent} onPrefill={onPrefill} />}
        {tab === "changes" && draft.kind === "edit" && <ChangesTab draft={draft} revision={revision} />}
      </div>

      <SaveBar draft={draft} report={report} onSaved={onSaved} />
    </div>
  );
}
