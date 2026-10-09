import { describe, expect, it } from "vitest";
import { FakeAccount } from "../../core/test/fakeAccount";
import { DeviceFlowError, pollForToken, requestDeviceCode } from "../src/deviceFlow";

const noSleep = async () => undefined;

describe("GitHub device flow", () => {
  it("gets a user code, waits through authorization_pending and returns the token", async () => {
    const a = new FakeAccount("NickHarder", 29993711);
    a.pendingPolls = 3;
    const code = await requestDeviceCode(a.clientId, "public_repo", a.fetch);
    expect(code).toMatchObject({
      userCode: "WDJB-MJHT",
      verificationUri: "https://github.com/login/device",
      interval: 1,
    });
    const r = await pollForToken(a.clientId, code, { fetch: a.fetch, sleep: noSleep });
    expect(r).toEqual({ token: a.token, scope: "public_repo" });
    expect(a.tokenPolls).toBe(4);
  });

  it("backs off on slow_down and reports denial, expiry and bad client ids", async () => {
    const a = new FakeAccount("NickHarder", 1);
    const code = await requestDeviceCode(a.clientId, "public_repo", a.fetch);
    const waits: number[] = [];
    let calls = 0;
    const slowThenDeny = (async () => {
      calls++;
      const body = calls === 1 ? { error: "slow_down", interval: 10 } : { error: "access_denied" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    await expect(
      pollForToken(a.clientId, code, { fetch: slowThenDeny, sleep: async (ms) => void waits.push(ms) }),
    ).rejects.toThrow(/cancelled on GitHub/);
    expect(waits).toEqual([1000, 10_000]);

    await expect(
      pollForToken(a.clientId, { ...code, expiresAt: Date.now() - 1 }, { fetch: a.fetch, sleep: noSleep }),
    ).rejects.toThrow(/expired/);
    await expect(requestDeviceCode("wrong-id", "public_repo", a.fetch)).rejects.toBeInstanceOf(
      DeviceFlowError,
    );

    const abort = new AbortController();
    abort.abort();
    await expect(
      pollForToken(a.clientId, code, { fetch: a.fetch, signal: abort.signal, sleep: noSleep }),
    ).rejects.toMatchObject({
      code: "aborted",
    });
  });
});
