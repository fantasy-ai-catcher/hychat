# Agent Instructions

## Branch workflow

Before changing code, decide whether the work is a `feature`, `fix`, or `chore`,
then create a new branch for the change. Do not modify code directly on `main`.

Branch names must follow this convention:

- `feature/<short-kebab-description>`
- `fix/<short-kebab-description>`
- `chore/<short-kebab-description>`

After implementation, run the required tests and verification commands on the
branch. Merge back to `main` only after the user explicitly agrees.

## Supabase schema changes

When a code change adds, removes, or renames Supabase database fields, tables,
RPC return columns, triggers, policies, or Edge Function database contracts:

1. Add or update the migration in `supabase/migrations/`.
2. Run the normal verification commands for the repo.
3. Run `supabase db push` before handing the work back.
4. If `supabase db push` cannot be run, report the exact blocker and do not
   describe the product as ready to run against the remote database.

Do not add long-term fallback code for old schemas unless the user explicitly
asks for backwards compatibility. The MVP assumes code and Supabase schema move
together.
