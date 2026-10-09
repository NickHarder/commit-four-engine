# Commit Four privacy policy

_Last updated: 2026-10-08_

Commit Four is a browser extension and command-line tool that lets you play Connect 4 on your own
GitHub contribution graph. It is an unofficial project, not affiliated with GitHub.

## What data it handles

- **Settings and sign-in**: your GitHub username, the name of your board repository, and either the
  access token GitHub issues when you "Sign in with GitHub", a token you paste, or a pairing token
  for the local helper. These are stored only in your
  browser's extension storage (or, for the command-line tool, in `~/.commit-four/config.json` on
  your computer, readable only by your user account).
- **Your commit name and address**: after you sign in (or paste a token), the extension stores your
  GitHub display name and your GitHub no-reply address (`ID+username@users.noreply.github.com`),
  and uses them only as the author of the piece commits it writes to your own board repository,
  so the squares count on your graph. They are stored with the settings above.
- **Your profile's contribution graph**: on your own GitHub profile page, the extension reads the
  graph to draw the board and to check when new squares appear. When a new board year is needed,
  it also reads your graph for past years, only to find one with no contributions. This stays in
  your browser.

## Where data goes

- **Signing in** talks to `github.com/login` (GitHub's device sign-in) to obtain your token.
- In **browser mode** (the default), the extension uses your token with `api.github.com` to create
  your board repository and write moves to it — the only repository it will write to. Each move's
  commits carry your display name and no-reply address as their author, like any commit you push.
- In **local-helper mode**, the extension sends moves to the helper program on your own computer
  (`127.0.0.1`), which pushes them with your existing git login.

Nothing is sent anywhere else. There are no analytics, no tracking, no ads, and no data is sold or
shared with anyone.

## Removing your data

Remove the extension (or clear its settings) to delete the stored settings and token. Revoke the
GitHub token at github.com/settings/personal-access-tokens. Delete `~/.commit-four` to remove the
command-line tool's settings. **Start over** in the extension settings erases every game from your
board repository, and deleting the repository removes the game's commits; either way GitHub may take
up to a day to update your graph.

## Contact

Questions: open an issue at https://github.com/NickHarder/commit-four-engine/issues
