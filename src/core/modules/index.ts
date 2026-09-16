export { defineModule } from "./define-module";
export { allModules, manifestIssues, modulesByCategory, getModule } from "./registry";
export { useEnabledModules, useModule } from "./useModules";
export { useService, useServiceAvailable } from "./services";
export { Slot, SLOT_NAMES, type SlotName } from "./slots";
export {
  MODULE_CATEGORIES,
  CATEGORY_LABELS,
  type ModuleManifest,
  type LoadedModule,
  type ModuleCategory,
  type SlotContext,
} from "./types";
