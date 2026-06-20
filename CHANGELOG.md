# Changelog

All notable changes to HyChat are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/): add bullets under
`## [Unreleased]` as you work, grouped by **Added** / **Changed** / **Fixed** /
**Removed**. Running `pnpm release <patch|minor|major|x.y.z>` moves the
`[Unreleased]` entries into a dated, versioned section automatically.

## [Unreleased]

### Added
- On startup HyChat now checks GitHub for the latest released version and refuses
  to launch when you are on an older one — printing `brew update && brew upgrade
  hychat` — so everyone stays on a build that matches the current Supabase schema.
  If the check cannot reach GitHub it also stops (rather than guessing). Set
  `HYCHAT_SKIP_UPDATE_CHECK=1` to bypass it.

## [0.2.0] - 2026-06-20

### Changed
- The header watchlist is now a vertical aligned table (one stock per row,
  aligned price/change columns) instead of a single line that wrapped mid-number
  once you watched more than a couple of symbols. The header grows with the
  watchlist instead of overflowing into the chat.
- Watched stocks now show the company name (e.g. 腾讯控股) rather than the
  raw symbol code, falling back to the code until a name loads. Up/down moves use
  a green ▲ / red ▼ arrow.
- Hong Kong and A-share stocks now display their Chinese name (from Tencent's
  free quote feed, fetched once per symbol and cached). US/JP stocks keep their
  English name. Prices still come from Yahoo.

## [0.1.1] - 2026-06-20

### Added
- `pnpm release <patch|minor|major|x.y.z>`: one-command release that bumps the
  version, rolls the changelog, builds the Homebrew tarball + formula, pushes
  main, tags, creates the GitHub release, and updates the tap (`--dry-run` to
  preview). This changelog itself is the new release-notes source.

### Fixed
- A transient network drop during a background refresh (e.g. when someone added
  a stock) could crash the whole app to a raw error dump. Background reloads and
  quote refreshes now fail quietly with a "Network error — check your connection
  and try again." status hint, keeping the current view instead of crashing.
- README: corrected the Yahoo endpoint (`v7/finance/quote`, not v8), replaced the
  stale hand-listed migrations with a pointer to `supabase/migrations/`, and
  clarified that `.env` is optional now that the Supabase connection is baked in.

## [0.1.0] - 2026-06-20

### Added
- Homebrew distribution via the `fantasy-ai-catcher/tap` tap, with a baked-in
  Supabase connection so a `brew install`ed binary runs with zero config.
- Terminal chat MVP: email-OTP login with invite-code registration, open rooms
  (discover, self-join, member list), realtime messages, and room activity lines.
- Shared per-room stock watchlists with US / HK / CN / JP quotes (keyless Yahoo
  Finance), a current-quote cache, manual `/refresh`, and server-side scheduled
  refresh for active rooms.
- Per-profile display colors and configurable Beijing-time message timestamps.
