import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n')
  .toLowerCase();

const fixStartProfileMigration = readFileSync(
  'supabase/migrations/20260610072815_fix_start_profile_ambiguous_id.sql',
  'utf8'
).toLowerCase();

const fixStartProfileConflictMigration = readFileSync(
  'supabase/migrations/20260610073049_fix_start_profile_variable_conflict.sql',
  'utf8'
).toLowerCase();

const allowSetupStartMigration = readFileSync(
  'supabase/migrations/20260610073307_allow_setup_start_before_invites.sql',
  'utf8'
).toLowerCase();

const fixInviteCodeMigration = readFileSync(
  'supabase/migrations/20260610073537_fix_invite_code_generation.sql',
  'utf8'
).toLowerCase();

const hardenAccessMigration = readFileSync(
  'supabase/migrations/20260610190000_harden_access_and_cleanup.sql',
  'utf8'
).toLowerCase();

const minimumGrantsMigration = readFileSync(
  'supabase/migrations/20260610191500_minimum_data_api_grants.sql',
  'utf8'
).toLowerCase();

const roomInvitesMigration = readFileSync(
  'supabase/migrations/20260610200000_room_invites_and_quota_guards.sql',
  'utf8'
).toLowerCase();

const activityMessagesMigration = readFileSync(
  'supabase/migrations/20260620120000_room_activity_messages.sql',
  'utf8'
).toLowerCase();

const dropMemberActivityMigration = readFileSync(
  'supabase/migrations/20260620130000_drop_member_activity_trigger.sql',
  'utf8'
).toLowerCase();

describe('initial Supabase schema migration', () => {
  it('creates the core chat and stock tables', () => {
    for (const table of [
      'profiles',
      'rooms',
      'room_members',
      'messages',
      'invite_codes',
      'room_watchlist',
      'stock_quotes'
    ]) {
      expect(migration).toContain(`create table if not exists public.${table}`);
    }
  });

  it('enables RLS on every public application table', () => {
    for (const table of [
      'profiles',
      'rooms',
      'room_members',
      'messages',
      'room_watchlist',
      'stock_quotes'
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it('grants Data API access explicitly to authenticated users only', () => {
    expect(migration).toContain('grant usage on schema public to authenticated');
    expect(migration).toContain('grant select, insert, update, delete on public.messages to authenticated');
    expect(migration).toContain('grant select on public.stock_quotes to authenticated');
    expect(migration).not.toContain('grant select on public.messages to anon');
  });

  it('uses room membership and auth.uid in policies', () => {
    expect(migration).toContain('to authenticated');
    expect(migration).toContain('(select auth.uid())');
    expect(migration).toContain('public.room_members');
  });

  it('supports nickname profiles and invite-only activation', () => {
    expect(migration).toContain('alter column email drop not null');
    expect(migration).toContain('create or replace function public.start_profile');
    expect(migration).toContain('create or replace function public.create_invite_code');
    expect(migration).toContain('create unique index if not exists profiles_display_name_lower_idx');
    expect(migration).toContain('drop function if exists public.invite_room_member_by_email');
    expect(migration).toContain('drop policy if exists "owners can add members"');
    expect(migration).toContain('create or replace function public.invite_room_member_by_display_name');
    expect(migration).toContain('private.is_current_user_active_profile()');
    expect(fixStartProfileMigration).toContain('result_id uuid');
    expect(fixStartProfileMigration).not.toContain('into id, display_name, role, status');
    expect(fixStartProfileConflictMigration).toContain('#variable_conflict use_column');
    expect(allowSetupStartMigration).toContain('invite_code_count = 0');
    expect(fixInviteCodeMigration).toContain('gen_random_uuid()');
    expect(fixInviteCodeMigration).not.toContain('gen_random_bytes');
    expect(migration).toContain('room owners can add themselves');
    expect(migration).toContain('create or replace function public.list_room_members');
    expect(migration).toContain('grant execute on function public.list_room_members(uuid) to authenticated');
    expect(migration).toContain('security invoker');
    expect(migration).toContain('display_color text');
    expect(migration).toContain('sender_display_color text');
    expect(migration).toContain('profiles_display_color_check');
    expect(migration).toContain('messages_sender_display_color_check');
    expect(migration).toContain('drop function if exists public.start_profile(text, text)');
    expect(migration).toContain('grant execute on function public.start_profile(text, text) to authenticated');
    expect(migration).toContain('drop function if exists public.list_room_members(uuid)');
    expect(migration).toContain('create or replace function public.update_profile_color');
    expect(migration).toContain('grant execute on function public.update_profile_color(text) to authenticated');
  });

  it('bounds message size and quote cache growth', () => {
    expect(migration).toContain('char_length(body) <= 2000');
    expect(migration).toContain('cache_expires_at timestamptz not null');
    expect(migration).toContain('primary key (canonical_symbol)');
    expect(migration).not.toContain('stock_quote_history');
  });

  it('adds cleanup functions for free-tier storage control', () => {
    expect(migration).toContain('create or replace function public.cleanup_old_messages');
    expect(migration).toContain('create or replace function public.cleanup_orphan_stock_quotes');
  });

  it('hardens grants, cleanup, and admin bootstrap', () => {
    expect(hardenAccessMigration).toContain(
      'revoke update, delete on public.messages from authenticated'
    );
    expect(hardenAccessMigration).toContain(
      'revoke update on public.room_members from authenticated'
    );
    expect(hardenAccessMigration).toContain(
      'revoke all on function public.cleanup_old_messages(int) from public'
    );
    expect(hardenAccessMigration).toContain(
      'revoke all on function public.cleanup_orphan_stock_quotes() from public'
    );
    expect(hardenAccessMigration).toContain('and rn > message_retention_min_count');
    expect(hardenAccessMigration).toContain('if active_profile_count = 0 then');
    expect(hardenAccessMigration).not.toContain('invite_code_count = 0');
    expect(hardenAccessMigration).toContain('display_name_taken');
  });

  it('adds room-bound invites, rate limiting, and quote realtime', () => {
    expect(roomInvitesMigration).toContain(
      'alter publication supabase_realtime add table public.stock_quotes'
    );
    expect(roomInvitesMigration).toContain(
      'add column if not exists room_id uuid references public.rooms(id)'
    );
    expect(roomInvitesMigration).toContain(
      'create or replace function public.create_invite_code(target_room_id uuid default null)'
    );
    expect(roomInvitesMigration).toContain('create or replace function public.list_invite_codes');
    expect(roomInvitesMigration).toContain('create or replace function public.revoke_invite_code');
    expect(roomInvitesMigration).toContain('invite_record.room_id is not null');
    expect(roomInvitesMigration).toContain('on conflict (room_id, user_id) do nothing');
    expect(roomInvitesMigration).toContain('enforce_message_rate_limit');
    expect(roomInvitesMigration).toContain("raise exception 'rate_limited'");
    expect(roomInvitesMigration).toContain('cleanup_orphan_anonymous_users');
    expect(roomInvitesMigration).toContain(
      'revoke all on function private.cleanup_orphan_anonymous_users(interval) from authenticated'
    );
  });

  it('resets legacy blanket grants to the policy-backed minimum', () => {
    expect(minimumGrantsMigration).toContain(
      'revoke all on all tables in schema public from anon'
    );
    expect(minimumGrantsMigration).toContain(
      'revoke all on all tables in schema public from authenticated'
    );
    expect(minimumGrantsMigration).toContain('grant select, insert on public.messages to authenticated');
    expect(minimumGrantsMigration).toContain('grant select on public.stock_quotes to authenticated');
    expect(minimumGrantsMigration).toContain('alter default privileges for role postgres in schema public');
    expect(minimumGrantsMigration).not.toContain('to anon;');
  });

  it('logs watchlist add/remove as system messages via a trigger', () => {
    expect(activityMessagesMigration).toContain(
      'create or replace function private.log_room_watchlist_activity'
    );
    expect(activityMessagesMigration).toContain(
      'after insert or delete on public.room_watchlist'
    );
    // SECURITY DEFINER so it can insert the message regardless of the actor's RLS.
    expect(activityMessagesMigration).toContain('security definer');
    expect(activityMessagesMigration).toContain("'system'");
    expect(activityMessagesMigration).toContain("'watch_add'");
    expect(activityMessagesMigration).toContain("'watch_remove'");
    // Best-effort: logging must never abort the underlying change.
    expect(activityMessagesMigration).toContain('exception when others then');
  });

  it('drops the membership activity trigger (room enter/leave moved to presence)', () => {
    // Room enter/leave is now ephemeral presence in the client, so the
    // membership-row trigger is removed; the watchlist trigger is untouched.
    expect(dropMemberActivityMigration).toContain(
      'drop trigger if exists log_room_member_activity on public.room_members'
    );
    expect(dropMemberActivityMigration).toContain(
      'drop function if exists private.log_room_member_activity'
    );
    expect(dropMemberActivityMigration).not.toContain('log_room_watchlist_activity');
  });

  it('enables realtime replication for chat messages and watchlist changes', () => {
    expect(migration).toContain('supabase_realtime');
    expect(migration).toContain('alter publication supabase_realtime add table public.messages');
    expect(migration).toContain(
      'alter publication supabase_realtime add table public.room_watchlist'
    );
  });
});
