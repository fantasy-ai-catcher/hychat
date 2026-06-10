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

  it('enables realtime replication for chat messages and watchlist changes', () => {
    expect(migration).toContain('supabase_realtime');
    expect(migration).toContain('alter publication supabase_realtime add table public.messages');
    expect(migration).toContain(
      'alter publication supabase_realtime add table public.room_watchlist'
    );
  });
});
