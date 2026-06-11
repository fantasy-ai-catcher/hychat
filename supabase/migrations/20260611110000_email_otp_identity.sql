-- Email OTP identity: identities are now anchored to email logins, so a
-- deactivated profile is permanently unreachable junk. Free its nickname by
-- only enforcing uniqueness among active profiles.
drop index if exists public.profiles_display_name_lower_idx;

create unique index if not exists profiles_display_name_lower_active_idx
  on public.profiles (lower(display_name))
  where status = 'active';
