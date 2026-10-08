/** Options page: choose a mode, connect and test it, and claim a template board. */

import { ApiWriter, GameEngine, type Identity, UnclaimedBoardError } from "@commit-four/core";
import type { Mode } from "./messages";
import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from "./settings";

const form = document.querySelector<HTMLFormElement>("#settings")!;
const result = document.querySelector<HTMLElement>("#result")!;
const claimButton = document.querySelector<HTMLButtonElement>("#claim")!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;

// keep aria-invalid in sync with :user-invalid (visual state)
for (const input of form.querySelectorAll<HTMLInputElement>("input:not([type=radio])")) {
  const sync = () => {
    if (input.matches(":user-invalid")) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  input.addEventListener("blur", sync);
  input.addEventListener("input", sync);
}

function mode(): Mode {
  return (form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value as Mode) ?? "companion";
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

async function init(): Promise<void> {
  const s = (await loadSettings()) ?? DEFAULT_SETTINGS;
  field("owner").value = s.owner;
  field("repo").value = s.repo;
  field("branch").value = s.branch;
  field("helperPort").value = String(s.helperPort);
  field("helperToken").value = s.helperToken;
  field("pat").value = s.pat;
  form.querySelector<HTMLInputElement>(`input[name="mode"][value="${s.mode}"]`)!.checked = true;
  showMode();
}

for (const radio of form.querySelectorAll('input[name="mode"]')) radio.addEventListener("change", showMode);

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  // must be the first call in the gesture handler
  const origin = mode() === "companion" ? "http://127.0.0.1/*" : "https://api.github.com/*";
  const granted = chrome.permissions.request({ origins: [origin] });
  void (async () => {
    if (!form.reportValidity()) return;
    if (!(await granted)) {
      say(`Commit Four needs access to ${origin.replace("/*", "")} to work in this mode.`, true);
      return;
    }
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      mode: mode(),
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
    await engine(s).claim();
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
    throw new Error(`No helper on port ${s.helperPort}. Run \`npx commit-four serve\` and try again.`);
  });
  if (res.status === 401)
    throw new Error("The helper rejected the pairing token. Copy it again from `commit-four serve`.");
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
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${s.pat}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub rejected the token (${res.status}).`);
  const user = (await res.json()) as { id: number; login: string; name: string | null };
  if (user.login.toLowerCase() !== s.owner.toLowerCase())
    throw new Error(`This token belongs to ${user.login}, not ${s.owner}.`);
  return { name: user.name ?? user.login, email: `${user.id}+${user.login}@users.noreply.github.com` };
}

function engine(s: Settings): GameEngine {
  return new GameEngine({
    writer: new ApiWriter({ owner: s.owner, repo: s.repo, token: s.pat, branch: s.branch }),
    owner: s.owner,
    pieceAuthor: s.author!,
  });
}

async function testApi(s: Settings): Promise<void> {
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

void init();
