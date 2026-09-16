import { invoke } from "@tauri-apps/api/core";

/** Codes d'erreur backend (miroir de AppErrorCode en Rust). */
export type AppErrorCode =
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "CLI_NOT_INSTALLED"
  | "PROCESS_CRASHED"
  | "POLICY_BLOCKED"
  | "PROMPT_EXPIRED"
  | "INVALID_INPUT"
  | "IO"
  | "NETWORK"
  | "INTERNAL";

export type AppError = {
  code: AppErrorCode;
  message: string;
  details?: unknown;
};

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

function normalize(error: unknown): AppError {
  if (isAppError(error)) return error;
  return { code: "INTERNAL", message: String(error) };
}

/** Commande du core (`#[tauri::command]` global). */
export async function invokeCore<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalize(error);
  }
}

/** Commande d'un module (plugin Tauri inline) : `plugin:<id>|<command>`. */
export async function invokeModule<T>(
  plugin: string,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invokeCore<T>(`plugin:${plugin}|${command}`, args);
}
