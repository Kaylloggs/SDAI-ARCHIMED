import { bus } from "@/core/bus/event-bus";
import { engineApi } from "@/core/engine/engine.api";
import { CAVEMAN_LEVELS, EFFORT_LEVELS, useTokenSaverStore } from "@/core/engine/tokenSaver";
import { allModules, defineActions, findByName, removeModule, restoreModule } from "@/core/modules";
import { isModuleEnabled, useModulesStore } from "@/core/stores/modules.store";
import { useThemeStore } from "@/core/stores/theme.store";
import { useUpdaterStore } from "@/core/updater/store";
import { THEMES, type ThemeId } from "@/design-system/themes";

const SECTIONS = ["theme", "agents", "tokens", "modules", "updates", "data"];

function module(ref: unknown) {
  return findByName([...allModules], String(ref ?? ""), (m) => m.name, (m) => m.id);
}

const noModule = (ref: unknown) => ({ ok: false, message: `Module inconnu : « ${String(ref)} ». Appelle list_app_modules.` });

/** Commandes des Réglages : thème, modules, assistants IA, économie de tokens, mises à jour. */
export default defineActions([
  {
    name: "open_section",
    description: "Affiche une section des réglages (theme, agents, tokens, modules, updates, data).",
    params: { section: { type: "string", enum: SECTIONS, description: "Section.", required: true } },
    risk: "read",
    run: async (args) => ({ ok: true, message: "Réglages affichés.", open: { module: "settings", params: { section: String(args.section) } } }),
  },
  {
    name: "set_theme",
    description: `Change le thème de l'application : ${THEMES.map((t) => `${t.id} (${t.name}, ${t.mode === "dark" ? "sombre" : "clair"})`).join(", ")}.`,
    params: { theme: { type: "string", description: "Identifiant ou nom du thème ; « clair » ou « sombre » choisit le premier de ce mode.", required: true } },
    risk: "write",
    run: async (args) => {
      const wanted = String(args.theme).trim().toLowerCase();
      const mode = ["clair", "light mode", "mode clair"].includes(wanted) ? "light" : ["sombre", "dark", "mode sombre"].includes(wanted) ? "dark" : null;
      const theme = mode ? THEMES.find((t) => t.mode === mode) : findByName(THEMES, wanted, (t) => t.name, (t) => t.id);
      if (!theme) return { ok: false, message: `Thème inconnu. Thèmes : ${THEMES.map((t) => t.name).join(", ")}.` };
      useThemeStore.getState().setTheme(theme.id as ThemeId);
      return { ok: true, message: `Thème ${theme.name} appliqué.` };
    },
  },
  {
    name: "list_app_modules",
    description: "Tous les modules de l'application, activés ou non, supprimés, et ceux qu'on ne peut pas désactiver.",
    risk: "read",
    run: async () => {
      const { overrides, removed } = useModulesStore.getState();
      const list = allModules.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        enabled: isModuleEnabled(overrides, m),
        required: Boolean(m.required),
        removed: removed.includes(m.id),
      }));
      const active = list.filter((m) => m.enabled).length;
      return { ok: true, message: `${active} module${active > 1 ? "s" : ""} actif${active > 1 ? "s" : ""} sur ${list.length}.`, data: { modules: list } };
    },
  },
  {
    name: "set_module_enabled",
    description: "Active ou désactive un module (ses commandes disparaissent tant qu'il est désactivé).",
    params: {
      module: { type: "string", description: "Nom ou identifiant du module.", required: true },
      enabled: { type: "boolean", description: "true : activer ; false : désactiver.", required: true },
    },
    risk: "write",
    run: async (args) => {
      const target = module(args.module);
      if (!target) return noModule(args.module);
      if (target.required) return { ok: false, message: `${target.name} fait partie du socle : il reste toujours actif.` };
      const enabled = args.enabled === true;
      if (enabled && useModulesStore.getState().removed.includes(target.id)) restoreModule(target.id);
      useModulesStore.getState().setOverride(target.id, enabled);
      bus.emit("modules.changed", { id: target.id, enabled });
      return { ok: true, message: `${target.name} ${enabled ? "activé" : "désactivé"}.${!enabled && target.id === "voice" ? " La voix s'arrête." : ""}` };
    },
  },
  {
    name: "remove_module",
    description: "Supprime un module : il disparaît et ses données sur la machine vont à la Corbeille (outils des agents, clés, réglages). Réversible avec restore_module, sans les données.",
    params: { module: { type: "string", description: "Nom ou identifiant du module.", required: true } },
    risk: "destructive",
    confirm: (args) => `Supprimer le module « ${String(args.module)} » et mettre ses données à la Corbeille ?`,
    run: async (args) => {
      const target = module(args.module);
      if (!target) return noModule(args.module);
      if (target.required) return { ok: false, message: `${target.name} fait partie du socle : il ne peut pas être supprimé.` };
      const removal = await removeModule(target.id);
      return {
        ok: true,
        message: `${target.name} supprimé.${removal.credentialsLeft.length ? ` Clés à retirer à la main : ${removal.credentialsLeft.join(", ")}.` : ""}`,
      };
    },
  },
  {
    name: "restore_module",
    description: "Remet un module supprimé (vide : ses anciennes données sont à la Corbeille).",
    params: { module: { type: "string", description: "Nom ou identifiant du module.", required: true } },
    risk: "write",
    run: async (args) => {
      const target = module(args.module);
      if (!target) return noModule(args.module);
      restoreModule(target.id);
      useModulesStore.getState().setOverride(target.id, true);
      return { ok: true, message: `${target.name} est de retour.` };
    },
  },
  {
    name: "list_ai_agents",
    description: "Assistants IA (CLI) : installés ou non, version, modèles disponibles.",
    risk: "read",
    run: async () => {
      const adapters = await engineApi.listAdapters();
      return {
        ok: true,
        message: adapters.map((a) => `${a.name} ${a.installed ? "installé" : "absent"}`).join(", ") + ".",
        data: { agents: adapters.map((a) => ({ id: a.id, name: a.name, installed: a.installed, version: a.version, models: a.models.map((m) => m.label) })) },
      };
    },
  },
  {
    name: "install_ai_agent",
    description: "Installe un assistant IA (claude, codex…) sur la machine ; la connexion au compte se fait ensuite dans son propre terminal (connect_ai_agent).",
    params: { agent: { type: "string", description: "Identifiant : claude, codex, antigravity.", required: true } },
    risk: "write",
    run: async (args) => {
      const id = String(args.agent).trim().toLowerCase();
      const result = await engineApi.installCli(id);
      return { ok: true, message: result || `${id} installé.` };
    },
  },
  {
    name: "connect_ai_agent",
    description: "Ouvre le terminal de connexion d'un assistant IA : la personne s'y connecte à son compte (ARCHIMED ne voit jamais les identifiants).",
    params: { agent: { type: "string", description: "Identifiant : claude, codex, antigravity.", required: true } },
    risk: "write",
    run: async (args) => {
      const id = String(args.agent).trim().toLowerCase();
      await engineApi.openCliTerminal(id);
      return { ok: true, message: "Terminal ouvert : connecte-toi à ton compte dans cette fenêtre." };
    },
  },
  {
    name: "set_token_saver",
    description: `Économie de tokens des agents : activée ou non, niveau (${CAVEMAN_LEVELS.map((l) => l.id).join(", ")}), effort de réflexion (${EFFORT_LEVELS.map((l) => l.id).join(", ")}), reprise automatique d'un agent arrêté en route.`,
    params: {
      enabled: { type: "boolean" },
      level: { type: "string", enum: CAVEMAN_LEVELS.map((l) => l.id) },
      effort: { type: "string", enum: EFFORT_LEVELS.map((l) => l.id) },
      auto_continue: { type: "boolean" },
      disable_skills: { type: "boolean", description: "Ne pas charger les skills (moins de contexte)." },
    },
    risk: "write",
    run: async (args) => {
      const store = useTokenSaverStore.getState();
      const changed: string[] = [];
      if (typeof args.enabled === "boolean") {
        store.setEnabled(args.enabled);
        changed.push(args.enabled ? "activée" : "désactivée");
      }
      if (typeof args.level === "string") {
        store.setLevel(args.level as (typeof CAVEMAN_LEVELS)[number]["id"]);
        changed.push(`niveau ${args.level}`);
      }
      const patch: Parameters<typeof store.setOption>[0] = {};
      if (typeof args.effort === "string") patch.effort = args.effort as (typeof EFFORT_LEVELS)[number]["id"];
      if (typeof args.auto_continue === "boolean") patch.autoContinue = args.auto_continue;
      if (typeof args.disable_skills === "boolean") patch.disableSkills = args.disable_skills;
      if (Object.keys(patch).length > 0) {
        store.setOption(patch);
        changed.push(...Object.keys(patch));
      }
      if (changed.length === 0) return { ok: false, message: "Rien à changer." };
      return { ok: true, message: `Économie de tokens : ${changed.join(", ")}.` };
    },
  },
  {
    name: "check_updates",
    description: "Cherche une nouvelle version d'ARCHIMED.",
    risk: "read",
    run: async () => {
      await useUpdaterStore.getState().check();
      const { status, checkError } = useUpdaterStore.getState();
      if (checkError) return { ok: false, message: checkError };
      const available = status?.available ?? null;
      return {
        ok: true,
        message: available ? `Version ${available.version} disponible.` : "ARCHIMED est à jour.",
        data: { status },
      };
    },
  },
  {
    name: "install_update",
    description: "Télécharge et installe la nouvelle version d'ARCHIMED (l'application redémarre).",
    risk: "destructive",
    confirm: () => "Installer la mise à jour ? ARCHIMED va redémarrer.",
    run: async () => {
      const store = useUpdaterStore.getState();
      if (!store.status) await store.check();
      await useUpdaterStore.getState().install();
      const { installError } = useUpdaterStore.getState();
      return installError ? { ok: false, message: installError } : { ok: true, message: "Mise à jour en cours d'installation." };
    },
  },
]);
