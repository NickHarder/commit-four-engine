# Registering the Commit Four GitHub OAuth app

> Done: the app is registered and its client ID (`Ov23lifjGJ78vzIzvZZt`) is the default in
> `packages/extension/src/config.ts`. These steps are only needed for your own app (e.g. a fork that
> wants its own name on the consent screen).

"Sign in with GitHub" uses GitHub's device flow, which needs an OAuth app's **client ID** (public,
not a secret — no client secret is used or needed). One app serves every user of the extension.

1. Go to https://github.com/settings/applications/new
2. Fill in:
   - **Application name**: Commit Four
   - **Homepage URL**: https://github.com/NickHarder/commit-four-engine
   - **Authorization callback URL**: https://github.com/NickHarder/commit-four-engine (unused by the
     device flow, but GitHub requires a value)
   - **Enable Device Flow**: ✅ (required)
3. Click **Register application** and copy the **Client ID** (it looks like `Ov23li...`). Don't
   generate a client secret; it isn't needed.
4. Build with it: put it in `DEFAULT_CLIENT_ID` in `packages/extension/src/config.ts`, or set
   `COMMIT_FOUR_CLIENT_ID=<id>` when running `npm run build`.

Builds without a client ID hide the sign-in button and fall back to the token / local-helper options.
