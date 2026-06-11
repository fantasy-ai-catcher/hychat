# Email OTP identity (replace anonymous auth)

## Why

The current identity is an anonymous Supabase auth session stored in
`~/.hychat/session.json`. Losing/overwriting that file permanently destroys
the identity. Consequences already hit in practice: unrecoverable profiles,
nickname squatting by dead profiles, and a full admin lockout (no live admin
session left to mint invite codes; recovery required SQL surgery).

Per product intent (CLAUDE.md): a one-time extra onboarding step is a fair
price for deleting this whole failure-mode class. Zero cost: Supabase
built-in email OTP is on the free plan.

## Target UX

```
# New user (register):
/start liudong ld.miemie@gmail.com 690baca47b814b38
→ Code sent to ld.miemie@gmail.com. Run /verify <6-digit-code>.
/verify 482913
→ Started as liudong (admin).

# Returning user / new device / lost session file:
/start ld.miemie@gmail.com
→ Code sent. /verify <code>
/verify 173846
→ Welcome back, liudong.
```

Parsing rule: an argument containing `@` is the email. `/start <email>` =
login; `/start <nickname> <email> [invite-code]` = register. `/logout` only
signs out locally — identity is always recoverable via email, so it loses its
"destroys identity" footgun.

Once verified, the session persists in `~/.hychat/session.json` exactly as
today; OTP is only needed when there is no valid stored session.

## Design

### Supabase (Layer 3: migrations + db push + smoke run)

1. Migration `email_otp_identity`:
   - Make nickname uniqueness recoverable: replace
     `profiles_display_name_lower_idx` with a partial unique index
     `on profiles (lower(display_name)) where status = 'active'`.
   - Fresh start (user decision): wipe all app data — profiles, rooms,
     room_members, messages, invite_codes, watchlists, quotes — and the
     orphaned anonymous auth users. Done as a one-off SQL run against the
     remote DB (data, not schema, so it is not a migration).
   - `start_profile` keeps its current contract and rules (first active
     profile bootstraps as admin, everyone else needs a valid invite code).
     With all old profiles deactivated, the owner's first email registration
     becomes admin naturally. Admin lockout is structurally gone because an
     admin can always re-login via email.
2. Auth config (done via management API): Anonymous provider disabled;
   Email provider stays on.
   **Free-tier constraint discovered during implementation:** email
   templates cannot be customized while using the default email provider,
   and the default "magic link" template contains only a link — no OTP
   digits. Therefore `/verify` accepts either the digits (works once a
   custom SMTP is configured later) or the entire pasted link, from which
   it extracts the `token` parameter and verifies it as a token hash.
   Verified end-to-end against the remote project with an
   admin-generated link.
   **Resolved (2026-06-11):** custom SMTP is now configured via the
   owner's Gmail app password (smtp.gmail.com:465, sender "HyChat"),
   which unlocked template editing. Login emails now carry a 6-digit
   code in the subject and body; `/verify <code>` is the primary flow
   and pasted links remain supported as a fallback. Email rate limit
   raised to 30/hour. Zero recurring cost.

### Service adapter (`src/app/hychat-service.ts`, Layer 3: thin, no new logic)

- Remove `signInAnonymously` usage.
- Add `sendOtp(email)` → `supabase.auth.signInWithOtp({ email })`.
- Add `verifyOtp(email, code)` → `supabase.auth.verifyOtp({ email, token,
  type: 'email' })`.
- `startProfile(nickname, inviteCode)` unchanged (called after verify).

### Session flow (`src/app/chat-session.ts` + `src/chat/commands.ts`, Layer 1: TDD)

- Parser: `/start` distinguishes login vs register by the `@` argument;
  new `/verify <code>` command.
- Chat session holds `pendingAuth: { email, nickname?, inviteCode? }`
  between `/start` and `/verify`:
  - `/start` → `sendOtp`, store pendingAuth, status tells user to check mail.
  - `/verify` → `verifyOtp`; then `getCurrentUser()`; if a profile exists →
    signed in; if not → call `startProfile(pendingAuth.nickname,
    pendingAuth.inviteCode)`; if nickname missing, prompt to rerun
    `/start <nickname> <email> [invite-code]` (no extra state to manage).
  - Errors (wrong/expired code) surface in statusText; pendingAuth survives
    so the user can retry `/verify`.
- `--profile <name>` keeps working (separate session files = separate
  emails for testing); drop the auto-mint-invite-from-default-session logic
  — it was an anonymous-auth workaround.
- Update helpSections and welcome-screen lines (`/start` → `/verify` steps).

### Explicitly not doing

- No password auth, no magic links (OTP types in a TUI better than opening
  links), no admin email allowlist config, no profile claim/migration tool,
  no automated orphan reaper. Old anonymous profiles just sit inactive.

## Verification

1. `pnpm typecheck` + `pnpm test` (new Layer 1 tests for parser and
   pendingAuth flow drive the implementation).
2. `supabase db push` for the migration.
3. Real smoke run (`pnpm dev`) with a real mailbox: register with invite
   code → becomes profile; delete `session.json` → re-login via OTP →
   same profile returns. Mind the built-in SMTP hourly cap when testing.

## Out-of-band steps (need the user)

- Disable Anonymous provider in the Supabase dashboard.
- Receive OTP mails during the smoke run (uses the user's real email).
