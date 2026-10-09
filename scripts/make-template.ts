/**
 * Writes the unclaimed board files:
 * - at the repo root, so a "Use this template" copy of this repo can become its owner's board
 *   (the sentinel names this repo as `upstream`, so the original itself can never be claimed)
 * - in templates/board/, the contents of a dedicated board repo (adds a README)
 * Usage: npx tsx scripts/make-template.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { boardFiles, boardStateFiles, UNCLAIMED_OWNER } from "../packages/core/src/index";

const UPSTREAM = "NickHarder/commit-four-engine";

function write(root: string, files: { path: string; content: string }[]): void {
  for (const f of files) {
    const path = join(root, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.content);
    console.log(`wrote ${path}`);
  }
}

write(process.cwd(), boardStateFiles(UNCLAIMED_OWNER, "template", undefined, UPSTREAM));
write(resolve(process.cwd(), "templates/board"), boardFiles(UNCLAIMED_OWNER, "template"));
