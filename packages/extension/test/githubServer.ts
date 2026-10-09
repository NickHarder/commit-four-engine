/**
 * A local HTTPS stand-in for github.com and api.github.com that Chrome reaches directly, through
 * `--host-resolver-rules`, instead of through Playwright routing. Routing turns Chrome's HTTP
 * cache off, and the cache is the part that broke live play. API GETs are marked cacheable for
 * 60 s, like GitHub's.
 */
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeGitHub } from "../../core/test/fakeGitHub";

export interface LocalGitHub {
  hostResolverRules: string;
  spkiHash: string;
  close(): Promise<void>;
}

export async function startLocalGitHub(
  api: FakeGitHub,
  page: (url: URL) => { status: number; body: string },
): Promise<LocalGitHub> {
  const dir = mkdtempSync(join(tmpdir(), "c4-cert-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
      "-days",
      "2",
      "-subj",
      "/CN=github.com",
      "-addext",
      "subjectAltName=DNS:github.com,DNS:api.github.com",
    ],
    { stdio: "ignore" },
  );
  const key = readFileSync(join(dir, "key.pem"));
  const cert = readFileSync(join(dir, "cert.pem"));
  rmSync(dir, { recursive: true, force: true });
  const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  const spkiHash = createHash("sha256").update(spki).digest("base64");

  const server = createServer({ key, cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const host = (req.headers.host ?? "").split(":")[0];
      const url = new URL(`https://${host}${req.url ?? "/"}`);
      if (host === "api.github.com") {
        const method = req.method ?? "GET";
        const r = await api.fetch(url.href, {
          method,
          headers: req.headers as Record<string, string>,
          ...(chunks.length ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
        });
        res.writeHead(r.status, {
          "Content-Type": "application/json; charset=utf-8",
          ...(method === "GET" && r.ok
            ? { "Cache-Control": "private, max-age=60, s-maxage=60", Vary: "Accept, Authorization" }
            : {}),
        });
        res.end(await r.text());
        return;
      }
      if (host === "github.com") {
        const r = page(url);
        res.writeHead(r.status, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "max-age=0, private, must-revalidate",
        });
        res.end(r.body);
        return;
      }
      // any other GitHub host: never answered for real
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    // every GitHub host goes to this server; every other host fails to resolve
    hostResolverRules: `MAP github.com 127.0.0.1:${port}, MAP *.github.com 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`,
    spkiHash,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
