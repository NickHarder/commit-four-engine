/** The Commit Four panel shown under the contribution graph (Shadow DOM, inherits GitHub's theme vars). */

import { DIFFICULTIES, type Difficulty } from "@commit-four/core";

export type HudAction =
  | { type: "newGame"; difficulty: Difficulty; humanFirst: boolean }
  | { type: "difficulty"; difficulty: Difficulty }
  | { type: "resign" }
  | { type: "settings" };

export interface HudView {
  title: string;
  status: string;
  sync?: string;
  error?: string;
  /** Something looks off but play can go on (e.g. GitHub shading the board unexpectedly). */
  warning?: string;
  link?: { href: string; label: string };
  canNewGame: boolean;
  canResign: boolean;
  /** Show the difficulty picker; during a game it changes the AI from its next move. */
  canChangeDifficulty?: boolean;
  /** The current game's difficulty (keeps the picker in sync). */
  difficulty?: Difficulty;
}

const STYLE = `
:host { all: initial; display: block; margin: 8px 0 16px; font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
.panel { border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px; padding: 8px 12px;
  background: var(--bgColor-default, #fff); color: var(--fgColor-default, #1f2328); }
h2 { all: unset; display: block; font-weight: 600; font-size: 13px; }
.status { margin: 4px 0 0; }
.sync { margin: 2px 0 0; color: var(--fgColor-muted, #59636e); }
.error { margin: 4px 0 0; color: var(--fgColor-danger, #d1242f); }
.warning { margin: 4px 0 0; color: var(--fgColor-attention, #9a6700); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
button, select { font: inherit; color: inherit; background: var(--button-default-bgColor-rest, #f6f8fa);
  border: 1px solid var(--button-default-borderColor-rest, #d1d9e0); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
button:hover { background: var(--button-default-bgColor-hover, #eff2f5); }
button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 1px; }
a { color: var(--fgColor-accent, #0969da); }
label { display: inline-flex; gap: 4px; align-items: center; }
[hidden] { display: none !important; }
`;

export class Hud {
  readonly host: HTMLElement;
  private readonly el: {
    title: HTMLElement;
    status: HTMLElement;
    sync: HTMLElement;
    error: HTMLElement;
    warning: HTMLElement;
    link: HTMLAnchorElement;
    difficulty: HTMLSelectElement;
    humanFirst: HTMLInputElement;
    newGame: HTMLButtonElement;
    resign: HTMLButtonElement;
  };

  constructor(onAction: (a: HudAction) => void) {
    this.host = document.createElement("div");
    this.host.className = "commit-four-hud";
    const root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("aria-label", "Commit Four");
    panel.innerHTML = `
      <h2></h2>
      <p class="status" role="status" aria-live="polite"></p>
      <p class="sync" aria-live="polite"></p>
      <p class="error" role="alert" hidden></p>
      <p class="warning" role="status" hidden></p>
      <p class="link" hidden><a target="_self"></a></p>
      <div class="controls">
        <label>Difficulty <select name="difficulty"></select></label>
        <label><input type="checkbox" name="humanFirst" checked> I go first</label>
        <button type="button" name="newGame">New game</button>
        <button type="button" name="resign">Resign</button>
        <button type="button" name="settings">Settings</button>
      </div>`;
    root.append(style, panel);
    const q = <T extends Element>(sel: string) => panel.querySelector<T>(sel)!;
    this.el = {
      title: q("h2"),
      status: q(".status"),
      sync: q(".sync"),
      error: q(".error"),
      warning: q(".warning"),
      link: q(".link a"),
      difficulty: q("select"),
      humanFirst: q('input[name="humanFirst"]'),
      newGame: q('button[name="newGame"]'),
      resign: q('button[name="resign"]'),
    };
    for (const d of DIFFICULTIES) {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d[0]!.toUpperCase() + d.slice(1);
      this.el.difficulty.append(o);
    }
    this.el.difficulty.value = "hard";
    this.el.difficulty.addEventListener("change", () => {
      if (this.inGame) onAction({ type: "difficulty", difficulty: this.el.difficulty.value as Difficulty });
    });
    this.el.newGame.addEventListener("click", () =>
      onAction({
        type: "newGame",
        difficulty: this.el.difficulty.value as Difficulty,
        humanFirst: this.el.humanFirst.checked,
      }),
    );
    this.el.resign.addEventListener("click", () => onAction({ type: "resign" }));
    q<HTMLButtonElement>('button[name="settings"]').addEventListener("click", () =>
      onAction({ type: "settings" }),
    );
  }

  private inGame = false;

  render(v: HudView): void {
    this.inGame = !v.canNewGame && !!v.canChangeDifficulty;
    if (v.difficulty && document.activeElement !== this.host) this.el.difficulty.value = v.difficulty;
    this.el.title.textContent = v.title;
    if (this.el.status.textContent !== v.status) this.el.status.textContent = v.status;
    this.el.sync.textContent = v.sync ?? "";
    this.el.error.hidden = !v.error;
    this.el.error.textContent = v.error ?? "";
    this.el.warning.hidden = !v.warning;
    this.el.warning.textContent = v.warning ?? "";
    const linkP = this.el.link.parentElement!;
    linkP.hidden = !v.link;
    if (v.link) {
      this.el.link.href = v.link.href;
      this.el.link.textContent = v.link.label;
    }
    this.el.newGame.hidden = !v.canNewGame;
    this.el.difficulty.parentElement!.hidden = !v.canNewGame && !v.canChangeDifficulty;
    this.el.humanFirst.parentElement!.hidden = !v.canNewGame;
    this.el.resign.hidden = !v.canResign;
  }
}
