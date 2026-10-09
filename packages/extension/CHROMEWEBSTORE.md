# Chrome Web Store Listing — Commit Four

> Last Updated: 2026-10-09

## Store Listing

**Extension Name**
Commit Four

**Short Description** (≤ 132 chars, matches manifest)
Play four in a row against an AI by clicking your own GitHub contribution graph. Unofficial; not affiliated with GitHub.

**Detailed Description**
Commit Four turns the contribution graph on your own GitHub profile into a four-in-a-row board, like Connect 4, and lets you play against an AI right there.

Click any column of the board on your profile and your piece drops in instantly. The AI answers within a couple of seconds. Each piece becomes a few real (empty, backdated) commits in a separate board repository you own, so the squares really appear on your graph: your pieces in the darkest green, the AI's in a lighter green.

Choose Casual, Hard or Perfect. Perfect never gives away a won or drawn position.
Games are drawn in a past year with no other activity on your graph (picked for you), so your recent activity keeps its look and can't change the board's colors. Finished games stay on the graph as a trophy wall, or erase them all with Start over in Settings.
Squares show as "pending" until GitHub's graph catches up, and the game keeps going even when GitHub is slow.

How to use it:
1. Click the extension icon and choose "Sign in with GitHub", then enter the code GitHub shows you. You never need to give it access to any organization.
2. Click "Set up my board": a board repository is created in your account (or an existing one is reused).
3. Open your profile and click "New game" in the Commit Four panel under your graph.

Privacy: everything stays in your browser. The extension only works on your own profile, only talks to GitHub and (if you choose) a helper running on your own computer, collects no analytics, and never writes to any repo except your board repo.

Unofficial project, not affiliated with or endorsed by GitHub. Connect 4 is a trademark of Hasbro; Commit Four is not affiliated with Hasbro. Source, issues and support: https://github.com/NickHarder/commit-four-engine

**Category**
Fun

**Single Purpose**
Lets you play four in a row against an AI on your own GitHub profile's contribution graph.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG (96×96 artwork, 16 px transparent padding) | ✅ Ready (drawn by build.mjs) | store-assets/store-icon-128.png |
| Screenshot 1 | 1280×800 | ✅ Ready | store-assets/screenshot-1-playing.png |
| Screenshot 2 | 1280×800 | ✅ Ready | store-assets/screenshot-2-won.png |
| Screenshot 3 | 1280×800 | ✅ Ready | store-assets/screenshot-3-settings.png |
| Small Promo Tile | 440×280 | ✅ Ready | store-assets/promo-small-440x280.png |
| Marquee Promo Tile | 1400×560 | ✅ Ready | store-assets/promo-marquee-1400x560.png |
| Promo video | YouTube link, 1920×1080 MP4 with sound (~26 s) | ✅ Live: https://youtu.be/i_M3oNOQUNA | store-assets/commit-four-demo-1080p.mp4 + commit-four-demo-thumbnail.png (generated, not committed) |

### Screenshot Notes
1. A game in progress in the 2016 view: the board outlined, your pieces dark, the AI's lighter, an earlier finished game to its left, and the panel saying it's your move with the timing line.
2. A finished game with the winning four highlighted and "You won game 1. Start a new one?".
3. The settings page: signed in, board set up, Start over.

They show the real extension on a mock profile page of a fictional account (`alex-codes`), with no GitHub logo. Regenerate after UI changes:
`C4_STORE_ASSETS=1 npx vitest run packages/extension/test/store-assets.test.ts`

The promo video is the same idea, scripted end to end: a joke hook, then a fictional profile in GitHub's dark theme, a camera move in on the whole year, a game the player loses to the Perfect AI (planned with the engine's own solver), captions, and a "Can you beat it?" end card. The 8-bit soundtrack and sound effects are composed in code (`test/demoAudio.ts`, no samples) and timed to the recorded clicks. It needs ffmpeg with libx264 and AAC:
`C4_DEMO_VIDEO=1 npx vitest run packages/extension/test/demo-video.test.ts`
Upload the MP4 to YouTube and paste the link into Store listing → Global promo video (currently https://youtu.be/i_M3oNOQUNA).

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| storage | permissions | Saves the user's board settings (repo name, mode, and their GitHub sign-in token or helper pairing token) in their own browser. |
| offscreen | permissions | Runs the four-in-a-row AI in a background worker so thinking about a move never freezes the GitHub page. |
| https://github.com/* | content script match | Draws the game board and the game panel on the contribution graph of the signed-in user's own profile page, and re-reads that graph to confirm when GitHub shows the new squares. It does nothing on other pages or other people's profiles. |
| https://github.com/login/* | host_permissions | "Sign in with GitHub": requests a sign-in code and the resulting access token from GitHub's device sign-in endpoints. |
| https://api.github.com/* | host_permissions | Creates the user's board repository and writes each move to it as commits, using the user's own sign-in. |
| http://127.0.0.1/* | optional_host_permissions | Requested only if the user chooses the "local helper" mode: sends moves to the Commit Four helper program running on the user's own computer. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — authentication info, stored locally only.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | Yes (your GitHub display name and no-reply commit address) | Only to api.github.com, as the author of the piece commits in your board repo | Make the squares count on your graph | No |
| Health info | No | — | — | No |
| Financial info | No | — | — | No |
| Authentication info | Yes (the GitHub sign-in token, or a token / helper pairing token the user enters) | Only to github.com (sign-in), api.github.com, or the user's own computer (127.0.0.1), to make the moves the user asks for | Create the board repo and write moves to it | No |
| Personal communications | No | — | — | No |
| Location | No | — | — | No |
| Web history | No | — | — | No |
| User activity | No | — | — | No |
| Website content | Reads the contribution graph on the user's own profile page | No | Draw and confirm the game board | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**: publish `docs/privacy-policy.md` with GitHub Pages, e.g.
`https://nickharder.github.io/commit-four-engine/privacy-policy` (must be live before submission).

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name**: Nick Harder (TODO: confirm)
**Contact Email**: TODO — a monitored address (Google sends takedown/policy notices here)
**Support URL**: https://github.com/NickHarder/commit-four-engine/issues
**Homepage URL**: https://github.com/NickHarder/commit-four-engine

## Pre-publish checklist

- [ ] `npm run package -w @commit-four/extension` → `packages/extension/commit-four-extension-v<version>.zip` (built from `build/` only: no sources, tests or this file)
- [ ] Version bumped in `static/manifest.json`
- [ ] Load the zip unpacked, play a game in both modes, check the console for errors
- [ ] Privacy policy URL live and consistent with the table above
- [x] At least one 1280×800 screenshot (three, plus the promo tile, in `store-assets/`)
- [ ] $5 developer registration done by the publisher

## Version History

| Version | Date | Summary |
|---|---|---|
| 0.1.0 | 2026-10-08 | First release: board overlay, local-helper and browser-only modes, Casual/Hard/Perfect AI. |
| 0.1.1 | 2026-10-09 | Fresh GitHub reads (no "board changed elsewhere" after quick moves), working Resign and Settings, difficulty changeable mid-game, faster turns with a timing breakdown. |
| 0.1.2 | 2026-10-09 | Your pieces and the AI's now render in two different shades (corrected shading model; the Jan 1 anchor becomes 14 commits, older boards are topped up on the next move). |
| 0.2.0 | 2026-10-09 | Start over (erase all games, in Settings). Each board's year is picked from your own graph (the newest empty past year), and the panel warns if GitHub shades the board unexpectedly. |
| 0.2.1 | 2026-10-09 | Store name is now "Commit Four"; clearer timing line ("AI answered instantly"). |
| 0.2.2 | 2026-10-09 | New icon: board squares with the store's padding, readable on light and dark toolbars. |
