/**
 * GitHub OAuth device flow ("enter this code on github.com"): sign-in without a client secret or
 * a server. github.com/login/* doesn't serve CORS, so this runs in an extension page that holds the
 * matching host permission.
 */

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between polls. */
  interval: number;
  expiresAt: number;
}

export class DeviceFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  expired_token: "The code expired. Start again.",
  access_denied: "Sign-in was cancelled on GitHub.",
  incorrect_client_credentials: "This build of Commit Four has an invalid GitHub client ID.",
  device_flow_disabled:
    "Device sign-in isn't enabled for this GitHub app (Settings > Developer settings > OAuth app > Enable Device Flow).",
  unsupported_grant_type: "GitHub rejected the sign-in request.",
  incorrect_device_code: "GitHub didn't recognize the sign-in code. Start again.",
  bad_verification_code: "GitHub didn't recognize the sign-in code. Start again.",
};

async function post(
  fetchImpl: typeof fetch,
  url: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new DeviceFlowError("http", `GitHub sign-in failed (${res.status}).`);
  return (await res.json()) as Record<string, unknown>;
}

export async function requestDeviceCode(
  clientId: string,
  scope: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceCode> {
  const r = await post(fetchImpl, "https://github.com/login/device/code", { client_id: clientId, scope });
  if (typeof r.error === "string")
    throw new DeviceFlowError(r.error, MESSAGES[r.error] ?? `GitHub sign-in failed: ${r.error}`);
  if (
    typeof r.device_code !== "string" ||
    typeof r.user_code !== "string" ||
    typeof r.verification_uri !== "string"
  ) {
    throw new DeviceFlowError("bad_response", "Unexpected answer from GitHub.");
  }
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUri: r.verification_uri,
    interval: Number(r.interval) || 5,
    expiresAt: Date.now() + (Number(r.expires_in) || 900) * 1000,
  };
}

export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  opts: { fetch?: typeof fetch; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ token: string; scope: string }> {
  const fetchImpl = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let interval = code.interval;
  for (;;) {
    if (opts.signal?.aborted) throw new DeviceFlowError("aborted", "Sign-in cancelled.");
    if (Date.now() > code.expiresAt) throw new DeviceFlowError("expired_token", MESSAGES.expired_token!);
    await sleep(interval * 1000);
    if (opts.signal?.aborted) throw new DeviceFlowError("aborted", "Sign-in cancelled.");
    const r = await post(fetchImpl, "https://github.com/login/oauth/access_token", {
      client_id: clientId,
      device_code: code.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (typeof r.access_token === "string") return { token: r.access_token, scope: String(r.scope ?? "") };
    const error = String(r.error ?? "unknown");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval = Number(r.interval) || interval + 5;
      continue;
    }
    throw new DeviceFlowError(error, MESSAGES[error] ?? `GitHub sign-in failed: ${error}`);
  }
}
