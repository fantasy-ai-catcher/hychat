# Startup update-version gate

## Goal

Before HyChat launches the chat UI, check the latest released version. If the
locally installed version is older — or if the check cannot be completed — print
the Homebrew update command and refuse to enter the app.

This keeps a small circle of friends on the same version, which matters because
the client and the Supabase schema move together (no long-term backwards
compatibility).

## Decisions (agreed with user)

- **Source of "latest":** GitHub Releases API for the public source repo
  `fantasy-ai-catcher/hychat`
  (`GET /repos/fantasy-ai-catcher/hychat/releases/latest`, read `tag_name`).
  No auth needed; this is exactly where `pnpm release` creates releases.
- **Update command shown:** `brew update && brew upgrade hychat` (the two-step
  form so the tap formula refreshes before the upgrade).
- **On check failure (offline / GitHub down / timeout / bad payload): block.**
  We cannot confirm the version is current, so we stop.
- **Escape hatch:** `HYCHAT_SKIP_UPDATE_CHECK` (any truthy value) skips the gate.
  This covers local dev and emergencies. `pnpm dev` sets it automatically.

## Design

Functional core / imperative shell.

New module `src/app/update-check.ts`:

- **Pure (Layer 1, TDD):**
  - `parseSemver`, `compareSemver`, `isUpToDate`
  - `parseLatestVersionFromTag` (strip leading `v`)
  - `shouldSkipUpdateCheck(env)`
  - `evaluateUpdateGate({ current, latest })` → `{ allow, lines }`
  - `buildOutdatedLines`, `buildCheckFailedLines`
- **Shell (IO, not unit-tested):**
  - `fetchLatestVersion()` — `fetch` + `AbortSignal.timeout`
  - `runUpdateGate({ currentVersion, env, fetcher? })` — wires skip-check +
    fetch + evaluate; `fetcher` is injectable so `runUpdateGate` is fully
    testable without the network.

Wiring in `src/cli.ts`: after the `--version` / `doctor` short-circuits and
before building the Supabase client / rendering Ink, call `runUpdateGate`. When
`!allow`, print the lines to stderr, set `process.exitCode = 1`, and return.

## Verification

- `pnpm typecheck` + `pnpm test` (Layer 1 covers the pure logic and
  `runUpdateGate` via an injected fetcher).
- Smoke: `HYCHAT_SKIP_UPDATE_CHECK=1 pnpm dev` still launches; a forced-old
  version run prints the block message and does not enter.
