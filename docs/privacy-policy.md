# Commit Four privacy policy

_Last updated: 2026-10-08_

Commit Four is a browser extension and command-line tool that lets you play Connect 4 on your own
GitHub contribution graph. It is an unofficial project, not affiliated with GitHub.

## What data it handles

- **Settings you enter**: your GitHub username, the name of your board repository, and either a
  pairing token for the local helper or a fine-grained GitHub token. These are stored only in your
  browser's extension storage (or, for the command-line tool, in `~/.commit-four/config.json` on
  your computer, readable only by your user account).
- **Your profile's contribution graph**: on your own GitHub profile page, the extension reads the
  graph to draw the board and to check when new squares appear. This stays in your browser.

## Where data goes

- In **browser-only mode**, the extension sends your token to `api.github.com` to write moves to
  your board repository — the only repository it will write to.
- In **local-helper mode**, the extension sends moves to the helper program on your own computer
  (`127.0.0.1`), which pushes them with your existing git login.

Nothing is sent anywhere else. There are no analytics, no tracking, no ads, and no data is sold or
shared with anyone.

## Removing your data

Remove the extension (or clear its settings) to delete the stored settings and token. Revoke the
GitHub token at github.com/settings/personal-access-tokens. Delete `~/.commit-four` to remove the
command-line tool's settings. Deleting your board repository removes the game's commits; GitHub
may take a while to update your graph.

## Contact

Questions: open an issue at https://github.com/NickHarder/commit-four-engine/issues
