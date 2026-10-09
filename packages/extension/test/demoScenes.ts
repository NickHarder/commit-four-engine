/**
 * Scenery for the demo video (test/demo-video.test.ts): a GitHub-style dark profile page sized for
 * a 1280x720 recording, the title/end cards, and the on-screen cursor and captions. A fictional
 * account, and no GitHub logo.
 */
import { calendarHtml } from "../../core/test/fixtures";

const FONT = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A GitHub-style identicon (5x5, mirrored), the default avatar look. */
function identicon(size: number): string {
  const on = ["10101", "01110", "11011", "01010", "11111"]; // rows, left half mirrored
  const cell = size / 6;
  const rects = on.flatMap((row, y) =>
    [...row].map((c, x) =>
      c === "1"
        ? `<rect x="${(x + 0.5) * cell}" y="${(y + 0.5) * cell}" width="${cell}" height="${cell}" fill="#3fb98f"/>`
        : "",
    ),
  );
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#f0f0f0"/>${rects.join("")}</svg>`;
}

/**
 * The year's contribution calendar as GitHub draws it: month labels, Mon/Wed/Fri labels and the
 * legend around the same cells and tooltips the content script reads (from the test fixture).
 */
function profileCalendar(
  owner: string,
  year: number,
  counts: Map<string, number>,
): { heading: string; card: string } {
  let html = calendarHtml(owner, `${year}-01-01`, `${year}-12-31`, counts);
  const heading = /<h2[^>]*>([^<]*)<\/h2>/.exec(html)![1]!;
  html = html.replace(/<h2[^>]*>[^<]*<\/h2>/, "");
  // month labels: each month starts at the week column holding its 1st day
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const firstSunday = Date.UTC(year, 0, 1 - jan1.getUTCDay());
  const weeks = Math.ceil((Date.UTC(year, 11, 31) - firstSunday) / 86_400_000 / 7 + 1 / 7);
  const starts = MONTHS.map((_, m) => Math.floor((Date.UTC(year, m, 1) - firstSunday) / 86_400_000 / 7));
  const months = starts
    .map((w, m) => {
      const span = (starts[m + 1] ?? weeks) - w;
      return `<td class="ContributionCalendar-label" colspan="${span}"><span class="month">${MONTHS[m]}</span></td>`;
    })
    .join("");
  html = html.replace(
    /(<table[^>]*>)/,
    `$1<thead><tr class="months"><td class="ContributionCalendar-label wd-col"></td>${months}</tr></thead>`,
  );
  let row = 0;
  html = html.replace(
    /<td class="ContributionCalendar-label"><span class="sr-only">Day<\/span><\/td>/g,
    () => {
      const label = { 1: "Mon", 3: "Wed", 5: "Fri" }[row++] ?? "";
      return `<td class="ContributionCalendar-label wd-col"><span class="wd">${label}</span></td>`;
    },
  );
  const legend = [0, 1, 2, 3, 4].map((l) => `<i class="lv" data-level="${l}"></i>`).join("");
  html = html.replace(
    /<\/table>/,
    `</table><div class="cal-foot"><span class="learn">Learn how we count contributions</span><span class="legend">Less ${legend} More</span></div>`,
  );
  return { heading, card: html };
}

/**
 * `owner`'s profile in GitHub's dark theme, open on `year`: header, tabs, sidebar, popular
 * repositories, the full-year contribution calendar and the year list. No GitHub logo. The theme
 * variables are the ones GitHub defines, so the Commit Four panel renders as it does on github.com.
 */
export function demoProfile(owner: string, counts: Map<string, number>, year = 2016): string {
  const { heading, card } = profileCalendar(owner, year, counts);
  const years = Array.from({ length: 11 }, (_, i) => 2026 - i)
    .map((y) => `<li class="${y === year ? "sel" : ""}">${y}</li>`)
    .join("");
  const icon = (d: string) =>
    `<span class="iconbtn"><svg width="16" height="16" viewBox="0 0 16 16"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="user-login" content="${owner}"><title>${owner} (Alex Rivera)</title>
<style>
  :root { color-scheme: dark;
    --bgColor-default: #0d1117; --bgColor-inset: #010409; --fgColor-default: #f0f6fc; --fgColor-muted: #9198a1;
    --fgColor-accent: #4493f8; --fgColor-danger: #f85149; --fgColor-attention: #d29922; --borderColor-default: #3d444d;
    --button-default-bgColor-rest: #212830; --button-default-bgColor-hover: #262c36; --button-default-borderColor-rest: #3d444d;
    --focus-outlineColor: #1f6feb; }
  html { overflow: hidden; }
  body { margin: 0; background: var(--bgColor-default); color: var(--fgColor-default); font: 14px/1.5 ${FONT}; }
  header { height: 64px; background: var(--bgColor-inset); border-bottom: 1px solid var(--borderColor-default); display: flex; align-items: center; gap: 12px; padding: 0 16px; }
  .iconbtn { width: 32px; height: 32px; box-sizing: border-box; border: 1px solid var(--borderColor-default); border-radius: 6px; display: grid; place-items: center; color: var(--fgColor-muted); }
  .crumb { font-weight: 600; font-size: 14px; }
  .search { margin-left: auto; width: 280px; height: 32px; box-sizing: border-box; border: 1px solid var(--borderColor-default); border-radius: 6px; color: var(--fgColor-muted); display: flex; align-items: center; padding: 0 10px; gap: 6px; }
  .search kbd { margin-left: auto; font: 11px ${FONT}; border: 1px solid var(--borderColor-default); border-radius: 4px; padding: 0 5px; }
  .hdr-avatar { width: 32px; height: 32px; border-radius: 50%; overflow: hidden; }
  nav { height: 48px; border-bottom: 1px solid var(--borderColor-default); display: flex; align-items: flex-end; gap: 8px; padding-left: 352px; }
  nav span { padding: 0 8px 12px; color: var(--fgColor-default); display: flex; gap: 6px; align-items: center; }
  nav span.sel { font-weight: 600; box-shadow: inset 0 -2px #f78166; }
  nav em { font-style: normal; font-size: 12px; background: rgb(101 108 118 / 0.2); border-radius: 2em; padding: 0 6px; }
  .wrap { display: flex; gap: 24px; padding: 24px 24px 0 32px; }
  aside { width: 296px; flex: none; }
  aside .avatar { width: 296px; height: 296px; border-radius: 50%; overflow: hidden; border: 1px solid var(--borderColor-default); box-sizing: border-box; }
  aside h1 { margin: 16px 0 0; font-size: 24px; line-height: 1.25; font-weight: 600; }
  aside .login { font-size: 20px; font-weight: 300; color: var(--fgColor-muted); }
  aside .btn { margin-top: 16px; text-align: center; padding: 5px 0; border: 1px solid var(--borderColor-default); border-radius: 6px; background: var(--button-default-bgColor-rest); font-weight: 500; }
  aside .follow { margin-top: 12px; color: var(--fgColor-muted); }
  aside .follow b { color: var(--fgColor-default); }
  .main { flex: 1; min-width: 0; display: flex; gap: 16px; }
  .col { flex: 1; min-width: 0; }
  .sub { font-size: 16px; margin: 0 0 8px; font-weight: 400; }
  .repos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .repo { border: 1px solid var(--borderColor-default); border-radius: 6px; padding: 14px 16px; font-size: 12px; color: var(--fgColor-muted); }
  .repo b { color: var(--fgColor-accent); font-size: 14px; font-weight: 600; }
  .repo .pub { border: 1px solid var(--borderColor-default); border-radius: 2em; padding: 0 7px; margin-left: 6px; font-size: 12px; }
  .repo p { margin: 8px 0; }
  .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; vertical-align: -1px; margin-right: 4px; }
  #c4-total { font-size: 16px; font-weight: 400; margin: 0 0 8px; }
  .js-calendar-graph { border: 1px solid var(--borderColor-default); border-radius: 6px; padding: 12px 16px 10px; }
  table.ContributionCalendar-grid { border-spacing: 3px; border-collapse: separate; margin: 0 auto; }
  td.ContributionCalendar-day { width: 10px; height: 10px; padding: 0; border-radius: 2px; outline: 1px solid rgb(240 246 252 / 0.06); outline-offset: -1px; }
  [data-level="0"] { background: #151b23; } [data-level="1"] { background: #033a16; }
  [data-level="2"] { background: #196c2e; } [data-level="3"] { background: #2ea043; } [data-level="4"] { background: #56d364; }
  td.ContributionCalendar-label { padding: 0; font-size: 12px; color: var(--fgColor-default); position: relative; }
  tr.months td { height: 15px; }
  .month { position: absolute; top: -3px; left: 0; }
  .wd-col { width: 28px; }
  .wd { position: absolute; top: -4px; left: 0; font-size: 12px; }
  .cal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 12px; color: var(--fgColor-muted); }
  .legend { display: flex; align-items: center; gap: 3px; }
  .lv { display: inline-block; width: 10px; height: 10px; border-radius: 2px; outline: 1px solid rgb(240 246 252 / 0.06); outline-offset: -1px; }
  .sr-only, tool-tip { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .years { list-style: none; margin: 0; padding: 0; width: 96px; flex: none; }
  .years li { padding: 6px 16px; border-radius: 6px; color: var(--fgColor-muted); font-size: 12px; }
  .years li.sel { background: #1f6feb; color: #fff; }
  .activity { margin-top: 24px; font-size: 16px; }
</style></head><body>
<header>
  ${icon("M2 4h12M2 8h12M2 12h12")}
  <span class="crumb">${owner}</span>
  <span class="search"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5"/></svg>Type <kbd>/</kbd> to search</span>
  ${icon("M8 3v10M3 8h10")}${icon("M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11")}${icon("M3 3h10v7H8l-3 3v-3H3z")}
  <span class="hdr-avatar">${identicon(32)}</span>
</header>
<nav><span class="sel">Overview</span><span>Repositories <em>12</em></span><span>Projects</span><span>Packages</span><span>Stars <em>34</em></span></nav>
<div class="wrap">
  <aside>
    <div class="avatar">${identicon(296)}</div>
    <h1>Alex Rivera</h1><div class="login">${owner}</div>
    <div class="btn">Edit profile</div>
    <div class="follow"><b>12</b> followers · <b>8</b> following</div>
  </aside>
  <div class="main"><div class="col">
    <h2 class="sub">Popular repositories</h2>
    <div class="repos">
      <div class="repo"><b>commit-four-board</b><span class="pub">Public</span><p>My four-in-a-row board. Mostly losses.</p><span class="dot" style="background:#3fb98f"></span>Board</div>
      <div class="repo"><b>dotfiles</b><span class="pub">Public</span><p>Config for the editor I spend all day in.</p><span class="dot" style="background:#89e051"></span>Shell</div>
    </div>
    <h2 id="c4-total">${heading}</h2>
    ${card}
    <div class="activity">Contribution activity</div>
  </div><ul class="years">${years}</ul></div>
</div>
</body></html>`;
}

/** A full-frame card in the promo-tile style. `board` adds the little winning board on the left. */
export function demoCard(opts: {
  title: string;
  subtitle?: string;
  board?: boolean;
  size?: number;
  /** Small print at the bottom of the card. */
  note?: string;
}): string {
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
  .note { position: absolute; left: 0; right: 0; bottom: 30px; text-align: center; font-size: 17px; color: #8b949e; }
</style></head><body>
${opts.board ? `<div class="grid">${grid}</div>` : ""}
<div class="text"><h1>${opts.title}</h1>${opts.subtitle ? `<p>${opts.subtitle}</p>` : ""}</div>
${opts.note ? `<div class="note">${opts.note}</div>` : ""}
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

/** Shows (or, with null, hides) the caption pill at the bottom of the page: light, on the dark page. */
export function captionScript(text: string | null): string {
  return `(() => {
    let el = document.getElementById("c4-demo-caption");
    const text = ${JSON.stringify(text)};
    if (text === null) { el?.remove(); document.getElementById("c4-demo-scrim")?.remove(); return; }
    if (!el) {
      // a lower-third scrim, so the caption reads over whatever the camera has under it
      const scrim = document.createElement("div");
      scrim.id = "c4-demo-scrim";
      Object.assign(scrim.style, {
        position: "fixed", left: "0", right: "0", bottom: "0", height: "150px", zIndex: "2147483644",
        pointerEvents: "none", background: "linear-gradient(rgb(1 4 9 / 0), rgb(1 4 9 / .92) 62%)",
      });
      document.documentElement.append(scrim);
      el = document.createElement("div");
      el.id = "c4-demo-caption";
      Object.assign(el.style, {
        position: "fixed", left: "50%", bottom: "26px", transform: "translateX(-50%)", zIndex: "2147483645",
        background: "rgb(240 246 252 / .96)", color: "#0d1117", font: '600 24px/1.3 ${FONT.replaceAll('"', "")}',
        padding: "12px 26px", borderRadius: "999px", whiteSpace: "nowrap", boxShadow: "0 8px 28px rgb(0 0 0 / .55)",
      });
      document.documentElement.append(el);
    }
    el.textContent = text;
  })();`;
}
