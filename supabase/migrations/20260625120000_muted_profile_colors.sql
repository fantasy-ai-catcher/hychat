-- Switch the server-side profile palette to the muted set used by the client
-- (src/app/profile-colors.ts). Three places hardcoded the old vivid palette:
-- the profiles + messages CHECK constraints and the update_profile_color RPC.
-- Existing rows holding a dropped color (e.g. 'cyan') are reset to 'white' so
-- the new, stricter constraint applies cleanly — friends re-pick from the new
-- palette (this matches the agreed behavior).

-- New allowed palette: 'white' (default) + the 13 muted names.

-- profiles.display_color ------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_display_color_check;

update public.profiles
set display_color = 'white'
where display_color not in (
  'white',
  'slate', 'steel', 'teal', 'sage', 'moss', 'olive', 'sand',
  'clay', 'rose', 'mauve', 'plum', 'dusk', 'gray'
);

alter table public.profiles
  add constraint profiles_display_color_check
  check (
    display_color in (
      'white',
      'slate', 'steel', 'teal', 'sage', 'moss', 'olive', 'sand',
      'clay', 'rose', 'mauve', 'plum', 'dusk', 'gray'
    )
  );

-- messages.sender_display_color ----------------------------------------------
alter table public.messages
  drop constraint if exists messages_sender_display_color_check;

update public.messages
set sender_display_color = 'white'
where sender_display_color not in (
  'white',
  'slate', 'steel', 'teal', 'sage', 'moss', 'olive', 'sand',
  'clay', 'rose', 'mauve', 'plum', 'dusk', 'gray'
);

alter table public.messages
  add constraint messages_sender_display_color_check
  check (
    sender_display_color in (
      'white',
      'slate', 'steel', 'teal', 'sage', 'moss', 'olive', 'sand',
      'clay', 'rose', 'mauve', 'plum', 'dusk', 'gray'
    )
  );

-- update_profile_color RPC ----------------------------------------------------
create or replace function public.update_profile_color(target_display_color text)
returns table (
  id uuid,
  display_name text,
  display_color text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_user_id uuid := auth.uid();
  normalized_display_color text := lower(btrim(target_display_color));
begin
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if normalized_display_color not in (
    'white',
    'slate', 'steel', 'teal', 'sage', 'moss', 'olive', 'sand',
    'clay', 'rose', 'mauve', 'plum', 'dusk', 'gray'
  ) then
    raise exception 'invalid_display_color';
  end if;

  update public.profiles p
  set display_color = normalized_display_color,
      updated_at = now()
  where p.id = current_user_id
    and p.status = 'active'
  returning p.id, p.display_name, p.display_color, p.role, p.status
  into id, display_name, display_color, role, status;

  if id is null then
    raise exception 'profile_not_found';
  end if;

  return next;
end;
$$;

revoke all on function public.update_profile_color(text) from public;
grant execute on function public.update_profile_color(text) to authenticated;
