#!/usr/bin/env node
// Local testing helper: mint a real, logged-in session for one or more test
// profiles WITHOUT any email or OTP, so `pnpm dev --profile <name>` drops you
// straight into the app.
//
// For each profile it:
//   1. creates a confirmed auth user for <profile>@hychat.test (idempotent),
//   2. upserts a profile row (display name = the profile name),
//   3. mints a one-time link and verifies it to produce a session,
//   4. writes that session into the same file the app reads
//      (~/.hychat/sessions/<profile>/session.json).
//
// Usage:
//   pnpm dev:login                 # sets up alice and bob
//   pnpm dev:login carol dave      # sets up the named profiles
//
// Requires the service-role key. It is read from SUPABASE_SERVICE_ROLE_KEY, or
// fetched via the linked Supabase CLI if that env var is unset.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { parse as parseDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL_DOMAIN = 'hychat.test';

function loadEnv() {
  const files = [join(homedir(), '.config', 'hychat', '.env'), join(process.cwd(), '.env')];
  const env = { ...process.env };
  for (const file of files) {
    if (!existsSync(file)) continue;
    const values = parseDotenv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  return env;
}

function projectRef(url) {
  const match = /^https:\/\/([^.]+)\.supabase\.co/.exec(url);
  if (!match) throw new Error(`Cannot derive project ref from SUPABASE_URL: ${url}`);
  return match[1];
}

function serviceRoleKey(env, ref) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return env.SUPABASE_SERVICE_ROLE_KEY;

  // The CLI prints the keys as JSON to stdout, but its PostHog telemetry can
  // hang on shutdown and make the process exit non-zero *after* the JSON is
  // already out. So we parse whatever stdout we got even on a non-zero exit,
  // and disable telemetry to avoid the hang in the first place.
  let out;
  try {
    out = execFileSync(
      'supabase',
      ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'],
      { encoding: 'utf8', env: { ...env, DO_NOT_TRACK: '1' } }
    );
  } catch (error) {
    out = error.stdout;
    if (typeof out !== 'string' || !out.trim()) {
      throw new Error(
        'Could not get the service-role key. Set SUPABASE_SERVICE_ROLE_KEY or link the Supabase CLI.\n' +
          String(error)
      );
    }
  }

  let keys;
  try {
    keys = JSON.parse(out);
  } catch {
    throw new Error('Could not parse the supabase CLI output as JSON.');
  }
  // Prefer the legacy JWT service_role key: the GoTrue admin endpoints
  // (/auth/v1/admin/*) accept it but reject the newer sb_secret_… keys (403).
  // Fall back to the secret key only if the legacy one is gone.
  const row =
    keys.find((k) => k.name === 'service_role' && k.type === 'legacy') ??
    keys.find((k) => k.type === 'secret' && k.secret_jwt_template?.role === 'service_role');
  if (row?.api_key) return row.api_key;
  throw new Error('service_role key not found in supabase CLI output.');
}

// Mirrors src/app/session-storage.ts so the app reads what we write.
function fileStorage(filePath) {
  const read = () => {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  };
  const write = (values) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(values, null, 2));
  };
  return {
    getItem: (key) => read()[key] ?? null,
    setItem: (key, value) => {
      const v = read();
      v[key] = value;
      write(v);
    },
    removeItem: (key) => {
      const v = read();
      delete v[key];
      write(v);
    }
  };
}

function sessionPath(profile) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) {
    throw new Error(`Invalid profile name: ${profile}`);
  }
  return join(homedir(), '.hychat', 'sessions', profile, 'session.json');
}

async function adminFetch(url, serviceKey, path, body) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function setupProfile(profile, { url, publishableKey, serviceKey }) {
  const email = `${profile}@${TEST_EMAIL_DOMAIN}`;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 1. Confirmed auth user (idempotent).
  const created = await adminFetch(url, serviceKey, '/auth/v1/admin/users', {
    email,
    email_confirm: true
  });
  let userId = created.json?.id;
  if (!userId) {
    // Already exists — look it up.
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    userId = data?.users?.find((u) => u.email === email)?.id;
  }
  if (!userId) throw new Error(`Could not create or find auth user for ${email}`);

  // 2. Profile row (display name = profile name). service_role bypasses RLS.
  // Don't write display_color: omitting it preserves a color the user picked in
  // a previous session, while a brand-new row still gets the column default
  // ('white'). Including it here reset the color to white on every re-login.
  const { error: upsertError } = await admin
    .from('profiles')
    .upsert(
      { id: userId, display_name: profile, role: 'member', status: 'active' },
      { onConflict: 'id' }
    );
  if (upsertError) throw new Error(`Profile upsert failed for ${profile}: ${upsertError.message}`);

  // 3. Mint a one-time link and exchange it for a session.
  const link = await adminFetch(url, serviceKey, '/auth/v1/admin/generate_link', {
    type: 'magiclink',
    email
  });
  const props = link.json?.properties ?? link.json ?? {};
  const tokenHash = props.hashed_token;
  const emailOtp = props.email_otp;
  if (!tokenHash && !emailOtp) {
    throw new Error(`generate_link gave no token for ${email}: ${JSON.stringify(link.json)}`);
  }

  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: false, storage: fileStorage(sessionPath(profile)) }
  });
  let verify = tokenHash
    ? await userClient.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    : await userClient.auth.verifyOtp({ email, token: emailOtp, type: 'email' });
  if (verify.error && emailOtp) {
    verify = await userClient.auth.verifyOtp({ email, token: emailOtp, type: 'email' });
  }
  if (verify.error) throw new Error(`Session verify failed for ${profile}: ${verify.error.message}`);

  return email;
}

async function main() {
  const profiles = process.argv.slice(2);
  if (profiles.length === 0) profiles.push('alice', 'bob');

  const env = loadEnv();
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (.env).');
  }
  const ref = projectRef(url);
  const serviceKey = serviceRoleKey(env, ref);

  for (const profile of profiles) {
    const email = await setupProfile(profile, { url, publishableKey, serviceKey });
    console.log(`✓ ${profile.padEnd(10)} ${email}  ->  pnpm dev --profile ${profile}`);
  }
  console.log('\nLaunch them (e.g. in two terminals or tmux panes):');
  for (const profile of profiles) console.log(`  pnpm dev --profile ${profile}`);

  // The Supabase clients keep background timers alive; we are done, so exit
  // cleanly rather than wait on (or surface noise from) those.
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
