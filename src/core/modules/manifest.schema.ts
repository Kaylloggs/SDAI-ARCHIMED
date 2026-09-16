import { z } from "zod";
import { MODULE_CATEGORIES } from "./types";

/**
 * Validation défensive des manifests : un module invalide est ignoré,
 * il ne doit jamais faire planter le shell (guidelines.md §4.3).
 */
export const manifestSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "id en kebab-case (ex: image-gen)")
    .max(32),
  name: z.string().min(1).max(20),
  description: z.string().min(1).max(160),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "semver attendu"),
  icon: z.custom<unknown>((v) => typeof v === "function" || typeof v === "object", {
    message: "icon: composant lucide attendu",
  }),
  category: z.enum(MODULE_CATEGORIES),
  order: z.number().int().min(0).max(999),
  enabledByDefault: z.boolean(),
  required: z.boolean().optional(),
  page: z.custom<unknown>((v) => typeof v === "object" && v !== null, {
    message: "page: composant lazy attendu",
  }),
  launchpad: z
    .union([z.object({ size: z.enum(["sm", "md", "lg"]), accent: z.boolean().optional() }), z.literal(false)])
    .optional(),
  backend: z.object({ plugin: z.string().regex(/^[a-z][a-z0-9-]*$/) }).optional(),
  provides: z.record(z.string(), z.custom<unknown>((v) => typeof v === "function")).optional(),
  consumes: z.array(z.string()).optional(),
  slots: z.record(z.string(), z.custom<unknown>((v) => typeof v === "object")).optional(),
  cards: z.record(z.string(), z.custom<unknown>((v) => typeof v === "object")).optional(),
  commands: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        shortcut: z.string().optional(),
        run: z.union([z.literal("navigate"), z.custom<unknown>((v) => typeof v === "function")]),
      }),
    )
    .optional(),
  settings: z.custom<unknown>((v) => typeof v === "object").optional(),
});

export type ManifestIssue = { source: string; message: string };
