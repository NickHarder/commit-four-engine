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
  /** Fine-grained PAT for browser-only mode (single repo, Contents: read & write). */
  pat: string;
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
