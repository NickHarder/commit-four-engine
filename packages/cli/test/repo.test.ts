import { describe, expect, it } from "vitest";
import { parseGitHubRemote, repoInfo } from "../src/repo";

describe("GitHub remotes", () => {
  it("parses https, ssh and scp-style URLs", () => {
    const want = { owner: "alice", repo: "my-c4" };
    expect(parseGitHubRemote("https://github.com/alice/my-c4.git")).toEqual(want);
    expect(parseGitHubRemote("https://github.com/alice/my-c4")).toEqual(want);
    expect(parseGitHubRemote("https://x-access-token:abc@github.com/alice/my-c4.git")).toEqual(want);
    expect(parseGitHubRemote("git@github.com:alice/my-c4.git")).toEqual(want);
    expect(parseGitHubRemote("ssh://git@github.com/alice/my-c4.git\n")).toEqual(want);
    expect(parseGitHubRemote("https://github.com/alice/commit.four.git")).toEqual({
      owner: "alice",
      repo: "commit.four",
    });
    expect(parseGitHubRemote("https://gitlab.com/alice/my-c4.git")).toBeNull();
    expect(parseGitHubRemote("/local/path")).toBeNull();
  });

  it("reports forks and treats lookup failures as unknown", async () => {
    const fork = (async () =>
      new Response(
        JSON.stringify({
          fork: true,
          private: false,
          parent: { full_name: "NickHarder/commit-four-engine" },
        }),
        {
          status: 200,
        },
      )) as typeof fetch;
    expect(await repoInfo({ owner: "bob", repo: "commit-four-engine" }, fork)).toEqual({
      fork: true,
      private: false,
      isTemplate: false,
      parent: "NickHarder/commit-four-engine",
    });
    const down = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await repoInfo({ owner: "bob", repo: "x" }, down)).toBeNull();
    const notFound = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    expect(await repoInfo({ owner: "bob", repo: "x" }, notFound)).toBeNull();
  });
});
