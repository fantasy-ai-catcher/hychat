# Changelog

All notable changes to HyChat are recorded here. The format loosely follows
[Keep a Changelog](https://keepachangelog.com/): add bullets under
`## [Unreleased]` as you work, grouped by **Added** / **Changed** / **Fixed** /
**Removed**. Running `pnpm release <patch|minor|major|x.y.z>` moves the
`[Unreleased]` entries into a dated, versioned section automatically.

## [Unreleased]

### Added
- `pnpm release <patch|minor|major|x.y.z>`: one-command release that bumps the
  version, rolls the changelog, builds the Homebrew tarball + formula, pushes
  main, tags, creates the GitHub release, and updates the tap (`--dry-run` to
  preview). This changelog itself is the new release-notes source.

### Fixed
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
