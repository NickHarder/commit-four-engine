/**
 * A fake GitHub account: /user, repo creation, per-repo routing to FakeGitHub instances, and the
 * OAuth device flow on github.com/login. Good enough to test sign-in -> create board -> play.
 */
import { FakeGitHub } from "./fakeGitHub";

export class FakeAccount {
  readonly repos = new Map<string, FakeGitHub>();
  readonly token = "gho_fake_token_for_tests";
  deviceCodeRequests = 0;
  tokenPolls = 0;
  /** Number of polls that answer authorization_pending before the token is granted. */
  pendingPolls = 1;
  grantedScope = "public_repo";

  constructor(
    readonly login: string,
    readonly id: number,
    readonly clientId = "test-client-id",
  ) {}

  repo(name: string): FakeGitHub | undefined {
    return this.repos.get(name.toLowerCase());
  }

  addRepo(name: string, files: Record<string, string> | null, meta: { fork?: boolean } = {}): FakeGitHub {
    const r = new FakeGitHub(this.login, name, files, meta);
    this.repos.set(name.toLowerCase(), r);
    return r;
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    const form = () => new URLSearchParams(typeof init?.body === "string" ? init.body : "");

    if (url.host === "github.com" && url.pathname === "/login/device/code" && method === "POST") {
      this.deviceCodeRequests++;
      if (form().get("client_id") !== this.clientId)
        return json(200, { error: "incorrect_client_credentials" });
      return json(200, {
        device_code: "dc-123",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      });
    }
    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token" && method === "POST") {
      this.tokenPolls++;
      const f = form();
      if (
        f.get("device_code") !== "dc-123" ||
        f.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code"
      ) {
        return json(200, { error: "bad_verification_code" });
      }
      if (this.tokenPolls <= this.pendingPolls) return json(200, { error: "authorization_pending" });
      return json(200, { access_token: this.token, token_type: "bearer", scope: this.grantedScope });
    }

    if (url.host !== "api.github.com") return json(404, { message: "unknown host" });
    if (new Headers(init?.headers).get("Authorization") !== `Bearer ${this.token}`)
      return json(401, { message: "Bad credentials" });
    if (method === "GET" && url.pathname === "/user")
      return json(200, { login: this.login, id: this.id, name: "Nick Harder" });
    if (method === "POST" && url.pathname === "/user/repos") {
      const body = JSON.parse(String(init?.body));
      if (this.repo(body.name)) return json(422, { message: "name already exists on this account" });
      this.addRepo(body.name, null);
      return json(201, {
        owner: { login: this.login },
        name: body.name,
        default_branch: "main",
        private: !!body.private,
      });
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)/.exec(url.pathname);
    if (m && m[1]!.toLowerCase() === this.login.toLowerCase()) {
      const r = this.repo(m[2]!);
      if (!r) return json(404, { message: "Not Found" });
      return r.fetch(input, init);
    }
    return json(404, { message: "Not Found" });
  };
}
