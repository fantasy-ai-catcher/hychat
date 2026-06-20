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

Record what changed under `## [Unreleased]` in `CHANGELOG.md` as you work. Then,
from a clean `main` with `gh` authenticated:

```bash
pnpm release minor --dry-run   # preview the version + release notes
pnpm release minor             # cut it (patch | minor | major | x.y.z)
```

`scripts/release.mjs` does the whole sequence:

1. Bumps `version` in `package.json`.
2. Moves the `[Unreleased]` changelog entries into a dated `[x.y.z]` section and
   uses them as the GitHub release notes.
3. Builds the tarball + formula via `pnpm pack:brew`
   (`dist/releases/hychat-<version>.tgz` + `dist/homebrew/hychat.rb`).
4. Commits, pushes `main`, and tags `v<version>`.
5. Creates the GitHub Release with the tarball asset. The formula's `url` points
   at exactly this asset, so tag, version, and filename stay aligned.
6. Clones the tap, drops in `Formula/hychat.rb`, and pushes it.

Friends then get the update with `brew upgrade hychat`.

### Doing it by hand

If you ever need to run the steps manually, the underlying command is
`GITHUB_REPOSITORY=fantasy-ai-catcher/hychat pnpm pack:brew` to produce the
tarball + formula, then `gh release create v<version> <tarball>` and copy the
formula into the tap's `Formula/hychat.rb`.

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
