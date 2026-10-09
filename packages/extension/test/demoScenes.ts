/**
 * Scenery for the demo video (test/demo-video.test.ts): a mock profile page sized for a 1280x720
 * recording, the title/end cards, and the on-screen cursor and captions. A fictional account, no
 * GitHub logo or chrome.
 */
import { calendarHtml } from "../../core/test/fixtures";

const FONT = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`;

/** The 2016 calendar of `owner`, drawn large: the board sits in the first weeks of the year. */
export function demoProfile(owner: string, counts: Map<string, number>): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="user-login" content="${owner}"><title>${owner}</title>
<style>
  body { margin: 0; background: #fff; color: #1f2328; font: 14px/1.5 ${FONT}; }
  .bar { height: 44px; background: #f6f8fa; border-bottom: 1px solid #d1d9e0; display: flex; align-items: center; padding: 0 40px; }
  .url { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #59636e; background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; padding: 3px 12px; }
  .who { margin-left: auto; display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .who i { width: 24px; height: 24px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #d0d7de, #8c959f); }
  main { padding: 16px 40px 0; }
  .tabs { border-bottom: 1px solid #d1d9e0; margin-bottom: 14px; padding-bottom: 6px; color: #59636e; }
  .tabs b { color: #1f2328; border-bottom: 2px solid #fd8c73; padding-bottom: 7px; }
  .js-calendar-graph { zoom: 2.5; width: 480px; box-sizing: border-box; overflow: hidden; border: 1px solid #d1d9e0; border-radius: 6px; padding: 8px 10px; }
  .js-calendar-graph h2 { font-size: 13px; font-weight: 400; margin: 0 0 6px; }
  /* keep the real cell size and let later weeks run off the right edge, as the board is in January */
  table.ContributionCalendar-grid { border-spacing: 3px; border-collapse: separate; width: max-content; }
  td.ContributionCalendar-day { width: 10px; min-width: 10px; height: 10px; padding: 0; border-radius: 2px; outline: 1px solid rgb(31 35 40 / 0.05); outline-offset: -1px; }
  td[data-level="0"] { background: #eff2f5; } td[data-level="1"] { background: #aceebb; }
  td[data-level="2"] { background: #4ac26b; } td[data-level="3"] { background: #2da44e; }
  td[data-level="4"] { background: #116329; }
  td.ContributionCalendar-label { width: 0; padding: 0; }
  .sr-only, tool-tip { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .commit-four-hud { zoom: 1.5; width: 800px; }
</style></head><body>
<div class="bar"><span class="url">github.com/${owner}?from=2016-12-01&amp;to=2016-12-31</span><span class="who"><i></i>${owner}</span></div>
<main><div class="tabs"><b>Overview</b> &nbsp;&nbsp; Repositories &nbsp;&nbsp; Projects</div>
${calendarHtml(owner, "2016-01-01", "2016-12-31", counts)}
</main></body></html>`;
}

/** A full-frame card in the promo-tile style. `board` adds the little winning board on the left. */
export function demoCard(opts: { title: string; subtitle?: string; board?: boolean; size?: number }): string {
  const rows = [".......", ".......", "...h...", "..ha...", ".hah...", "hahaa.."]; // h yours, a the AI's
  const win = new Set(["2,3", "3,2", "4,1", "5,0"]);
  const grid = rows
    .flatMap((r, y) =>
      [...r].map((c, x) => {
        const cls = [c === "h" ? "h" : c === "a" ? "a" : "", win.has(`${y},${x}`) ? "w" : ""]
          .join(" ")
          .trim();
        return `<i class="${cls}"></i>`;
      }),
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; }
  body { background: linear-gradient(135deg, #0d1117 0%, #10301c 100%); color: #fff; font: 26px/1.35 ${FONT};
    display: flex; align-items: center; justify-content: center; gap: 72px; padding: 0 110px; box-sizing: border-box; }
  .grid { display: grid; grid-template-columns: repeat(7, 40px); gap: 9px; flex: none; }
  .grid i { width: 40px; height: 40px; border-radius: 7px; background: #161b22; outline: 2px solid #30363d; outline-offset: -2px; }
  .grid i.h { background: #39d353; outline: none; } .grid i.a { background: #006d32; outline: none; }
  .grid i.w { box-shadow: 0 0 0 4px #e3b341; }
  .text { ${opts.board ? "" : "text-align: center;"} }
  h1 { font-size: ${opts.size ?? 76}px; line-height: 1.08; margin: 0; letter-spacing: -1px; font-weight: 750; }
  p { margin: 18px 0 0; color: #c9d1d9; }
</style></head><body>
${opts.board ? `<div class="grid">${grid}</div>` : ""}
<div class="text"><h1>${opts.title}</h1>${opts.subtitle ? `<p>${opts.subtitle}</p>` : ""}</div>
</body></html>`;
}

/** Init script: a visible arrow cursor with a click ripple (headless recordings show no cursor). */
export const CURSOR_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById("c4-demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = \`
      #c4-demo-cursor { position: fixed; left: -100px; top: -100px; width: 26px; height: 26px; pointer-events: none;
        z-index: 2147483647; transition: transform .1s ease; transform-origin: 3px 3px; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .45)); }
      #c4-demo-cursor.down { transform: scale(.82); }
      .c4-demo-ripple { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
        border: 3px solid #bf8700; pointer-events: none; z-index: 2147483646; animation: c4-ripple .45s ease-out forwards; }
      @keyframes c4-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }\`;
    document.documentElement.append(style);
    const cur = document.createElement("div");
    cur.id = "c4-demo-cursor";
    cur.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.5 15 L18 15 Z" fill="#fff" stroke="#1f2328" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.append(cur);
    addEventListener("mousemove", (e) => { cur.style.left = e.clientX - 3 + "px"; cur.style.top = e.clientY - 2 + "px"; }, true);
    addEventListener("mousedown", (e) => {
      cur.classList.add("down");
      const r = document.createElement("div");
      r.className = "c4-demo-ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.documentElement.append(r);
      setTimeout(() => r.remove(), 500);
    }, true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
  };
  if (document.documentElement) install();
  else addEventListener("DOMContentLoaded", install);
})();`;

/** Shows (or, with null, hides) the caption pill at the bottom of the page. */
export function captionScript(text: string | null): string {
  return `(() => {
    let el = document.getElementById("c4-demo-caption");
    const text = ${JSON.stringify(text)};
    if (text === null) { el?.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "c4-demo-caption";
      Object.assign(el.style, {
        position: "fixed", left: "50%", bottom: "26px", transform: "translateX(-50%)", zIndex: "2147483645",
        background: "rgb(13 17 23 / .93)", color: "#fff", font: '600 24px/1.3 ${FONT.replaceAll('"', "")}',
        padding: "12px 26px", borderRadius: "999px", whiteSpace: "nowrap", boxShadow: "0 6px 24px rgb(0 0 0 / .25)",
      });
      document.documentElement.append(el);
    }
    el.textContent = text;
  })();`;
}
