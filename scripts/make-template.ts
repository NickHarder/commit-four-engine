/**
 * Regenerates templates/board/ — the files of the public "Use this template" board repo — from
 * the same code `commit-four init` uses, with an unclaimed sentinel.
 * Usage: npx tsx scripts/make-template.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { boardFiles, UNCLAIMED_OWNER } from "../packages/core/src/index";

const out = resolve(process.cwd(), "templates/board");
for (const f of boardFiles(UNCLAIMED_OWNER, "template")) {
  const path = join(out, f.path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, f.content);
  console.log(`wrote ${path}`);
}
