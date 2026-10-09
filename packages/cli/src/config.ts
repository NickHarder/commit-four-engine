/** ~/.commit-four/config.json — boards known to this machine and the helper's pairing secret. */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Identity } from "@commit-four/core";

export interface BoardConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Bare clone used by the GitWriter. */
  dir: string;
  author: Identity;
}

export interface Config {
  version: 1;
  current?: string;
  boards: Record<string, BoardConfig>;
  helper: {
    port: number;
    /** Shared secret the extension sends as a Bearer token. */
    token: string;
    /** Extension origin bound at first successful pairing (chrome-extension://<id>). */
    extensionOrigin?: string;
  };
}

export const DEFAULT_PORT = 47474;

export function homeDir(): string {
  return process.env.COMMIT_FOUR_HOME ?? join(homedir(), ".commit-four");
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function loadConfig(): Promise<Config> {
  try {
    const raw = JSON.parse(await readFile(join(homeDir(), "config.json"), "utf8")) as Config;
    if (raw.version !== 1) throw new Error("unsupported config version");
    return raw;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return { version: 1, boards: {}, helper: { port: DEFAULT_PORT, token: newToken() } };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(homeDir(), { recursive: true, mode: 0o700 });
  const path = join(homeDir(), "config.json");
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function currentBoard(config: Config, name?: string): BoardConfig {
  const key = name ?? config.current;
  const board = key ? config.boards[key] : undefined;
  if (!board) throw new Error("no board configured; run `commit-four init <owner>/<repo>` first");
  return board;
}
