# Distributing HyChat via Homebrew

HyChat ships to its small circle of friends as a Homebrew formula. Friends
install with:

```bash
brew install fantasy-ai-catcher/tap/hychat
hychat
```

No configuration is required: the Supabase URL and publishable (anon) key are
baked into the build (`src/config/env.ts`). Both are safe to publish — data
access is gated by Supabase RLS plus the invite code, not by hiding the key. The
only secret (`TWELVE_DATA_API_KEY`) lives server-side in Supabase and never
enters the client build.

## One-time infrastructure

Two **public** repositories under the `fantasy-ai-catcher` org:

1. `fantasy-ai-catcher/hychat` — this source repo. Public so Homebrew can
   download release tarballs without auth.
2. `fantasy-ai-catcher/homebrew-tap` — the tap. Holds only `Formula/hychat.rb`.
   The `homebrew-` prefix is required; friends type `fantasy-ai-catcher/tap`.

## Releasing a new version

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.1.1`).
2. Build the tarball + formula:

   ```bash
   pnpm pack:brew
   ```

   This runs `pnpm pack` into `dist/releases/hychat-<version>.tgz`, computes its
   sha256, and writes a filled-in formula to `dist/homebrew/hychat.rb`.
   `GITHUB_REPOSITORY` defaults to `fantasy-ai-catcher/hychat`; override it only
   if the repo moves.
3. Create a GitHub Release tagged `v<version>` and upload
   `dist/releases/hychat-<version>.tgz` as a release asset. The formula's `url`
   points at exactly this asset, so the tag, version, and filename must match
   (the script already aligns them).
4. Copy `dist/homebrew/hychat.rb` into the tap repo as `Formula/hychat.rb`,
   then commit and push.

Friends then get the update with `brew upgrade hychat`.

## How the formula works

`packaging/homebrew/hychat.rb.template` declares `depends_on "node"` and runs
`npm install` to install the packaged tarball (and its production dependencies)
into Homebrew's `libexec`, then symlinks the `hychat` bin onto `PATH`. The
tarball itself contains only `dist/`, `README.md`, `.env.example`, and `LICENSE`
(see `files` in `package.json`); runtime deps are fetched from the npm registry
at install time.

## Overriding the baked-in connection (dev)

To run against a different Supabase project, set env vars or drop a
`~/.config/hychat/.env` (or a `.env` in the working directory). Any env value
overrides the baked-in default; see `loadRuntimeDotenv` in `src/cli.ts`.
