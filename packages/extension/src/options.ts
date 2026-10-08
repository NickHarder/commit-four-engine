/**
 * Options page. Default path: Sign in with GitHub (device flow) → Set up my board → play.
 * Advanced: your own fine-grained token, or the local helper.
 */

import {
  ApiWriter,
  DEFAULT_BOARD_REPO,
  ensureBoard,
  GameEngine,
  GitHubClient,
  type Identity,
  seasonProfileUrl,
  UnclaimedBoardError,
} from "@commit-four/core";
import { GITHUB_CLIENT_ID, OAUTH_SCOPE } from "./config";
import { DeviceFlowError, pollForToken, requestDeviceCode } from "./deviceFlow";
import type { Mode } from "./messages";
import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from "./settings";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// keep aria-invalid in sync with :user-invalid (visual state)
for (const input of document.querySelectorAll<HTMLInputElement>("input:not([type=radio])")) {
  const sync = () => {
    if (input.matches(":user-invalid")) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  input.addEventListener("blur", sync);
  input.addEventListener("input", sync);
}

// --- Sign in with GitHub ----------------------------------------------------------------------

const account = {
  section: $("#account"),
  signedOut: $("#signed-out"),
  device: $("#device"),
  signedIn: $("#signed-in"),
  userCode: $("#user-code"),
  login: $("#login"),
  boardName: $<HTMLInputElement>("#board-name"),
  setup: $<HTMLButtonElement>("#setup-board"),
  play: $("#play"),
  playLink: $<HTMLAnchorElement>("#play-link"),
  status: $("#account-status"),
};
let signinAbort: AbortController | null = null;
let deviceUri = "https://github.com/login/device";

function accountSay(text: string, bad = false): void {
  account.status.textContent = text;
  account.status.classList.toggle("bad", bad);
}

function showAccount(view: "signed-out" | "device" | "signed-in"): void {
  account.signedOut.hidden = view !== "signed-out";
  account.device.hidden = view !== "device";
  account.signedIn.hidden = view !== "signed-in";
}

function showPlay(s: Settings): void {
  account.playLink.href = seasonProfileUrl(s.owner, 2016);
  account.play.hidden = !s.repo;
}

$("#signin").addEventListener("click", async () => {
  signinAbort?.abort();
  const abort = new AbortController();
  signinAbort = abort;
  accountSay("Asking GitHub for a sign-in code…");
  try {
    const code = await requestDeviceCode(GITHUB_CLIENT_ID, OAUTH_SCOPE);
    deviceUri = code.verificationUri;
    account.userCode.textContent = code.userCode;
    showAccount("device");
    accountSay("Waiting for you to approve Commit Four on GitHub…");
    const { token, scope } = await pollForToken(GITHUB_CLIENT_ID, code, { signal: abort.signal });
    if (!scope.split(/[,\s]+/).includes(OAUTH_SCOPE) && !scope.split(/[,\s]+/).includes("repo")) {
      throw new Error(
        "GitHub didn't grant access to public repositories, which Commit Four needs to write moves.",
      );
    }
    const me = await new GitHubClient({ token }).user();
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      mode: "browser",
      authKind: "oauth",
      owner: me.login,
      repo: "",
      pat: token,
      author: me.identity,
    };
    await saveSettings(s);
    account.login.textContent = `@${me.login}`;
    showAccount("signed-in");
    showPlay(s);
    accountSay("Signed in. Now set up your board.");
    account.setup.focus();
  } catch (e) {
    if (e instanceof DeviceFlowError && e.code === "aborted") return;
    showAccount("signed-out");
    accountSay(e instanceof Error ? e.message : String(e), true);
  } finally {
    if (signinAbort === abort) signinAbort = null;
  }
});

$("#open-github").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(account.userCode.textContent ?? "");
  } catch {
    // clipboard may be unavailable; the code is on screen
  }
  window.open(deviceUri, "_blank", "noopener");
});

$("#cancel-signin").addEventListener("click", () => {
  signinAbort?.abort();
  showAccount("signed-out");
  accountSay("");
});

$("#signout").addEventListener("click", async () => {
  await chrome.storage.local.remove("settings");
  showAccount("signed-out");
  account.play.hidden = true;
  accountSay("Signed out. To fully revoke access, remove Commit Four at github.com/settings/applications.");
});

account.setup.addEventListener("click", async () => {
  const s = await loadSettings();
  if (!s?.pat || !s.author) {
    showAccount("signed-out");
    return;
  }
  if (!account.boardName.reportValidity()) return;
  const repo = account.boardName.value.trim();
  account.setup.disabled = true;
  accountSay(`Setting up ${s.owner}/${repo}…`);
  try {
    const r = await ensureBoard({ token: s.pat, login: s.owner, author: s.author, repo });
    if (!("branch" in r)) {
      accountSay(r.message, true);
      return;
    }
    const saved: Settings = { ...s, repo: r.repo, branch: r.branch };
    await saveSettings(saved);
    showPlay(saved);
    accountSay(
      {
        created: `Created ${r.owner}/${r.repo}.`,
        claimed: `${r.owner}/${r.repo} is now your board.`,
        existing: `Using your board ${r.owner}/${r.repo}.`,
      }[r.status],
    );
    account.playLink.focus();
  } catch (e) {
    accountSay(e instanceof Error ? e.message : String(e), true);
  } finally {
    account.setup.disabled = false;
  }
});

// --- Advanced form ------------------------------------------------------------------------------

const form = $<HTMLFormElement>("#settings");
const result = $("#result");
const claimButton = $<HTMLButtonElement>("#claim");
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

function mode(): Mode {
  return (form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value as Mode) ?? "browser";
}

function showMode(): void {
  const m = mode();
  form.querySelector<HTMLElement>(".mode-companion")!.hidden = m !== "companion";
  form.querySelector<HTMLElement>(".mode-browser")!.hidden = m !== "browser";
  field("helperToken").required = m === "companion";
  field("pat").required = m === "browser";
}

function say(text: string, bad = false): void {
  result.textContent = text;
  result.classList.toggle("bad", bad);
}

for (const radio of form.querySelectorAll('input[name="mode"]')) radio.addEventListener("change", showMode);

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  // permission requests must be the first call in the gesture handler
  const granted =
    mode() === "companion"
      ? chrome.permissions.request({ origins: ["http://127.0.0.1/*"] })
      : Promise.resolve(true);
  void (async () => {
    if (!form.reportValidity()) return;
    if (!(await granted)) {
      say("Commit Four needs access to 127.0.0.1 to talk to the local helper.", true);
      return;
    }
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      mode: mode(),
      authKind: "pat",
      owner: field("owner").value.trim(),
      repo: field("repo").value.trim(),
      branch: field("branch").value.trim() || "main",
      helperPort: Number(field("helperPort").value) || DEFAULT_SETTINGS.helperPort,
      helperToken: field("helperToken").value.trim(),
      pat: field("pat").value.trim(),
    };
    say("Testing…");
    claimButton.hidden = true;
    try {
      if (s.mode === "companion") await testHelper(s);
      else {
        s.author = await identityFromToken(s);
        await testApi(s);
      }
      await saveSettings(s);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true);
    }
  })();
});

claimButton.addEventListener("click", async () => {
  const s = await loadSettings();
  if (!s?.author) return;
  try {
    say("Claiming the board…");
    await engine(s).claim(`${s.owner}/${s.repo}`);
    claimButton.hidden = true;
    say(`Board claimed for ${s.owner}. Open your profile to play.`);
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true);
  }
});

async function testHelper(s: Settings): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${s.helperPort}/v1/status`, {
    headers: { Authorization: `Bearer ${s.helperToken}` },
  }).catch(() => {
    throw new Error(`No helper on port ${s.helperPort}. Run \`npm run serve\` and try again.`);
  });
  if (res.status === 401)
    throw new Error("The helper rejected the pairing token. Copy it again from `npm run serve`.");
  if (res.status === 403)
    throw new Error("The helper is paired with a different browser. Run `commit-four pair --reset`.");
  if (!res.ok) throw new Error(`Helper error ${res.status}`);
  const status = (await res.json()) as { owner: string; repo: string };
  if (status.owner.toLowerCase() !== s.owner.toLowerCase() || status.repo !== s.repo) {
    throw new Error(`The helper is serving ${status.owner}/${status.repo}, not ${s.owner}/${s.repo}.`);
  }
  say(`Connected to the local helper for ${status.owner}/${status.repo}. Saved — open your profile to play.`);
}

async function identityFromToken(s: Settings): Promise<Identity> {
  const me = await new GitHubClient({ token: s.pat }).user().catch((e: unknown) => {
    throw new Error(`GitHub rejected the token (${e instanceof Error ? e.message : String(e)}).`);
  });
  if (me.login.toLowerCase() !== s.owner.toLowerCase())
    throw new Error(`This token belongs to ${me.login}, not ${s.owner}.`);
  return me.identity;
}

function engine(s: Settings): GameEngine {
  return new GameEngine({
    writer: new ApiWriter({ owner: s.owner, repo: s.repo, token: s.pat, branch: s.branch }),
    owner: s.owner,
    pieceAuthor: s.author!,
  });
}

async function testApi(s: Settings): Promise<void> {
  const meta = await new GitHubClient({ token: s.pat }).repo(s.owner, s.repo);
  if (!meta) throw new Error(`Can't see ${s.owner}/${s.repo} with this token. Give it access to that repo.`);
  if (meta.fork) {
    throw new Error(
      `${s.owner}/${s.repo} is a fork, and GitHub never counts commits in forks. Make a standalone copy with "Use this template" instead, or use an empty repo.`,
    );
  }
  try {
    const state = await engine(s).load(true);
    say(
      `Connected to ${s.owner}/${s.repo} (${state.games.length} game(s)). Saved — open your profile to play.`,
    );
  } catch (e) {
    if (e instanceof UnclaimedBoardError) {
      claimButton.hidden = false;
      say("This board was created from the template. Claim it to start playing.");
      return;
    }
    throw e;
  }
}

// --- initial state ------------------------------------------------------------------------------

async function init(): Promise<void> {
  const s = await loadSettings();
  if (!GITHUB_CLIENT_ID) {
    // no OAuth app configured in this build: token / local helper only
    account.section.hidden = true;
    $<HTMLDetailsElement>("#advanced").open = true;
  }
  if (s?.authKind === "oauth" && s.pat) {
    account.login.textContent = `@${s.owner}`;
    account.boardName.value = s.repo || DEFAULT_BOARD_REPO;
    showAccount("signed-in");
    showPlay(s);
  } else {
    showAccount("signed-out");
  }
  const adv = s && s.authKind !== "oauth" ? s : DEFAULT_SETTINGS;
  field("owner").value = adv.owner;
  field("repo").value = adv.repo;
  field("branch").value = adv.branch;
  field("helperPort").value = String(adv.helperPort);
  field("helperToken").value = adv.helperToken;
  field("pat").value = adv.authKind === "pat" ? adv.pat : "";
  form.querySelector<HTMLInputElement>(`input[name="mode"][value="${adv.mode}"]`)!.checked = true;
  if (s && s.authKind !== "oauth") $<HTMLDetailsElement>("#advanced").open = true;
  showMode();
}

void init();
