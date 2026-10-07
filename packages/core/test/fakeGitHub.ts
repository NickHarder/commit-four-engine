/** Minimal in-memory GitHub REST backend for the Git Data + Contents endpoints the ApiWriter uses. */

interface Commit {
  tree: string;
  parents: string[];
  author: { name: string; email: string; date: string };
  committer: { name: string; email: string; date: string };
  message: string;
}

export class FakeGitHub {
  readonly commits = new Map<string, Commit>();
  readonly trees = new Map<string, Map<string, string>>();
  readonly refs = new Map<string, string>();
  readonly requests: { method: string; path: string }[] = [];
  private seq = 0;

  constructor(
    readonly owner: string,
    readonly repo: string,
    files: Record<string, string>,
  ) {
    const tree = this.addTree(new Map(Object.entries(files)));
    const sha = this.addCommit({
      tree,
      parents: [],
      author: { name: "init", email: "engine@commit-four.invalid", date: "2026-10-07T00:00:00Z" },
      committer: { name: "init", email: "engine@commit-four.invalid", date: "2026-10-07T00:00:00Z" },
      message: "init",
    });
    this.refs.set("main", sha);
  }

  private id(prefix: string): string {
    return `${prefix}${(++this.seq).toString(16).padStart(39, "0")}`;
  }
  addTree(files: Map<string, string>): string {
    const sha = this.id("t");
    this.trees.set(sha, files);
    return sha;
  }
  addCommit(c: Commit): string {
    const sha = this.id("c");
    this.commits.set(sha, c);
    return sha;
  }

  /** Simulates someone else pushing a commit that changes `files`. */
  externalPush(files: Record<string, string>): void {
    const head = this.refs.get("main")!;
    const tree = new Map(this.trees.get(this.commits.get(head)!.tree)!);
    for (const [k, v] of Object.entries(files)) tree.set(k, v);
    const sha = this.addCommit({
      tree: this.addTree(tree),
      parents: [head],
      author: { name: "x", email: "x@example.com", date: "2026-10-07T00:00:00Z" },
      committer: { name: "x", email: "x@example.com", date: "2026-10-07T00:00:00Z" },
      message: "external",
    });
    this.refs.set("main", sha);
  }

  history(): Commit[] {
    const out: Commit[] = [];
    let sha: string | undefined = this.refs.get("main");
    while (sha) {
      const c = this.commits.get(sha)!;
      out.push(c);
      sha = c.parents[0];
    }
    return out.reverse();
  }

  file(path: string): string | undefined {
    return this.trees.get(this.commits.get(this.refs.get("main")!)!.tree)!.get(path);
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname;
    this.requests.push({ method, path });
    const base = `/repos/${this.owner}/${this.repo}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (!String(new Headers(init?.headers).get("Authorization")).startsWith("Bearer "))
      return json(401, { message: "auth" });

    if (method === "GET" && path === `${base}/git/ref/heads/main`)
      return json(200, { object: { sha: this.refs.get("main") } });
    if (method === "GET" && path.startsWith(`${base}/git/commits/`)) {
      const c = this.commits.get(path.split("/").pop()!);
      return c
        ? json(200, { sha: path.split("/").pop(), tree: { sha: c.tree } })
        : json(404, { message: "Not Found" });
    }
    if (method === "GET" && path.startsWith(`${base}/contents/`)) {
      const file = decodeURIComponent(path.slice(`${base}/contents/`.length));
      const ref = url.searchParams.get("ref")!;
      const content = this.trees.get(this.commits.get(ref)!.tree)!.get(file);
      if (content === undefined) return json(404, { message: "Not Found" });
      return json(200, {
        encoding: "base64",
        content: Buffer.from(content)
          .toString("base64")
          .replace(/(.{60})/g, "$1\n"),
      });
    }
    if (method === "POST" && path === `${base}/git/commits`) {
      if (!this.trees.has(body.tree)) return json(422, { message: "bad tree" });
      return json(201, { sha: this.addCommit(body) });
    }
    if (method === "POST" && path === `${base}/git/trees`) {
      const tree = new Map(this.trees.get(body.base_tree)!);
      for (const e of body.tree) tree.set(e.path, e.content);
      return json(201, { sha: this.addTree(tree) });
    }
    if (method === "PATCH" && path === `${base}/git/refs/heads/main`) {
      const head = this.refs.get("main")!;
      // fast-forward only
      let sha: string | undefined = body.sha;
      while (sha && sha !== head) sha = this.commits.get(sha)?.parents[0];
      if (sha !== head) return json(422, { message: "Update is not a fast forward" });
      this.refs.set("main", body.sha);
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: `no route ${method} ${path}` });
  };
}
