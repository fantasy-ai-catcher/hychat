import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n')
  .toLowerCase();

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
    expect(migration).toContain('room owners can add themselves');
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
