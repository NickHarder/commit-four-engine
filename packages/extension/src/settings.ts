/** Extension settings (chrome.storage.local). Only the service worker and options page read them. */

import type { Identity } from "@commit-four/core";
import type { Mode } from "./messages";

export interface Settings {
  mode: Mode;
  owner: string;
  repo: string;
  branch: string;
  helperPort: number;
  helperToken: string;
  /** Browser-only mode token: from "Sign in with GitHub" (oauth) or a fine-grained PAT (pat). */
  pat: string;
  authKind?: "oauth" | "pat";
  author?: Identity;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "companion",
  owner: "",
  repo: "",
  branch: "main",
  helperPort: 47474,
  helperToken: "",
  pat: "",
};

export async function loadSettings(): Promise<Settings | null> {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings || typeof settings !== "object") return null;
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings>) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}

export function isConfigured(s: Settings | null): s is Settings {
  if (!s?.owner || !s.repo) return false;
  return s.mode === "companion" ? s.helperToken.length > 0 : s.pat.length > 0 && !!s.author;
}
