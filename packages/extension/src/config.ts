/**
 * Build-time configuration. GITHUB_CLIENT_ID is the client ID of the "Commit Four" GitHub OAuth app
 * (public, not a secret; device flow needs no client secret). Set COMMIT_FOUR_CLIENT_ID when
 * building, or put it in DEFAULT_CLIENT_ID. Empty = no "Sign in with GitHub" button (token only).
 */

declare const __C4_CLIENT_ID__: string;

const DEFAULT_CLIENT_ID = "";

export const GITHUB_CLIENT_ID: string =
  (typeof __C4_CLIENT_ID__ === "string" && __C4_CLIENT_ID__) || DEFAULT_CLIENT_ID;

/** public_repo: create the board repo and write moves to it. Commit Four only ever writes to that repo. */
export const OAUTH_SCOPE = "public_repo";
