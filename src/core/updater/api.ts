import { Channel, invokeCore } from "@/core/ipc";
import type { UpdateEvent } from "@/core/ipc/bindings/UpdateEvent";
import type { UpdateStatus } from "@/core/ipc/bindings/UpdateStatus";
import type { LocalStatus } from "@/core/ipc/bindings/LocalStatus";

export type { AvailableUpdate } from "@/core/ipc/bindings/AvailableUpdate";
export type { InstallKind } from "@/core/ipc/bindings/InstallKind";
export type { SourceBuild } from "@/core/ipc/bindings/SourceBuild";
export type { LocalModule } from "@/core/ipc/bindings/LocalModule";
export type { LocalStatus, UpdateEvent, UpdateStatus };

/** Mises à jour depuis les releases GitHub (core/updater.rs, ADR 0013). */
export const updaterApi = {
  check: () => invokeCore<UpdateStatus>("updater_check"),
  /**
   * `version` : celle que la personne a confirmée ; le backend relit la release.
   * `replaceSource` : version compilée depuis le code source remplacée par l'officielle (ses
   * modules en moins), sur confirmation explicite seulement.
   */
  install: (version: string, replaceSource: boolean, onEvent: Channel<UpdateEvent>) =>
    invokeCore<void>("updater_install", { version, replaceSource, onEvent }),
  /** Version compilée depuis le code source : fusion + recompilation dans PowerShell. */
  rebuild: (version: string) => invokeCore<void>("updater_rebuild", { version }),
  cancel: () => invokeCore<void>("updater_cancel"),
  /** Modules nouveaux ou modifiés dans le code source suivi, pas encore dans l'exécutable. */
  localStatus: () => invokeCore<LocalStatus>("updater_local_status"),
  /** Dossier du code source suivi (`null` : oublier). */
  setSourceDir: (dir: string | null) => invokeCore<LocalStatus>("updater_set_source_dir", { dir }),
  /** Recompile et réinstalle avec ces modules (fenêtre PowerShell). */
  localRebuild: () => invokeCore<void>("updater_local_rebuild"),
};
