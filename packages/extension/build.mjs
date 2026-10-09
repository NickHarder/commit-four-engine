// Builds the extension into ./build (and optionally a store zip) and draws its PNG icons.
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const outIdx = process.argv.indexOf("--out");
const out = outIdx > 0 ? process.argv[outIdx + 1] : join(here, "build");
await rm(out, { recursive: true, force: true });
await mkdir(join(out, "icons"), { recursive: true });

await build({
  absWorkingDir: here,
  entryPoints: {
    content: "src/content.ts",
    sw: "src/sw.ts",
    offscreen: "src/offscreen.ts",
    "ai-worker": "src/ai-worker.ts",
    options: "src/options.ts",
  },
  bundle: true,
  format: "iife",
  target: "chrome123",
  outdir: out,
  legalComments: "none",
  define: { __C4_CLIENT_ID__: JSON.stringify(process.env.COMMIT_FOUR_CLIENT_ID ?? "") },
  logLevel: "warning",
});
await cp(join(here, "static"), out, { recursive: true });
for (const size of [16, 48, 128]) await writeFile(join(out, "icons", `icon-${size}.png`), icon(size));

if (process.argv.includes("--zip")) {
  const { version } = JSON.parse(
    await (await import("node:fs/promises")).readFile(join(out, "manifest.json"), "utf8"),
  );
  const zip = join(here, `commit-four-extension-v${version}.zip`);
  await rm(zip, { force: true });
  execFileSync("zip", ["-qr", zip, "."], { cwd: out });
  console.log(`packaged ${zip}`);
}

/**
 * A 4x4 corner of a board drawn as contribution squares: your winning diagonal in dark green, the
 * AI's pieces in light green, empty squares grey. Transparent background, with the store's
 * padding (16 px of 128), and anti-aliased rounded corners so it reads on light and dark toolbars.
 */
function icon(size) {
  const px = new Uint8Array(size * size * 4);
  const pad = size / 8;
  const gap = Math.max(1, size / 32);
  const cell = (size - 2 * pad - 3 * gap) / 4;
  const radius = cell * 0.22;
  const colors = { y: [0x21, 0x6e, 0x39], a: [0x9b, 0xe9, 0xa8], e: [0xc8, 0xd1, 0xda] };
  const rows = ["eeey", "eeya", "eyaa", "yaya"]; // top to bottom
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const rgb = colors[rows[gy][gx]];
      const x0 = pad + gx * (cell + gap);
      const y0 = pad + gy * (cell + gap);
      for (let y = Math.floor(y0); y < Math.ceil(y0 + cell); y++) {
        for (let x = Math.floor(x0); x < Math.ceil(x0 + cell); x++) {
          // coverage of this pixel by the rounded square (distance to the rounded edge, AA'd)
          const cx = Math.min(Math.max(x + 0.5, x0 + radius), x0 + cell - radius);
          const cy = Math.min(Math.max(y + 0.5, y0 + radius), y0 + cell - radius);
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const edge = Math.min(x + 0.5 - x0, x0 + cell - (x + 0.5), y + 0.5 - y0, y0 + cell - (y + 0.5));
          const cover = Math.max(0, Math.min(1, d > 0 ? radius + 0.5 - d : edge + 0.5));
          if (cover <= 0) continue;
          const i = (y * size + x) * 4;
          px.set([...rgb, Math.round(255 * cover)], i);
        }
      }
    }
  }
  return png(size, size, px);
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
