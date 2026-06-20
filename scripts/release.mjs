#!/usr/bin/env node
// One-command release: bump version, roll the changelog, build the Homebrew
// tarball + formula, push main, tag, create the GitHub release, and update the
// tap. See docs/DISTRIBUTION.md.
//
// Usage: pnpm release <patch|minor|major|x.y.z> [--dry-run]

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = 'fantasy-ai-catcher/hychat';
const TAP_REPO = 'fantasy-ai-catcher/homebrew-tap';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function capture(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { cwd: rootDir, encoding: 'utf8', ...opts }).trim();
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(' ')}`);
  execFileSync(cmd, cmdArgs, { cwd: rootDir, stdio: 'inherit', ...opts });
}

function computeVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    return bump;
  }
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    fail(`Cannot parse current version "${current}".`);
  }
  const [major, minor, patch] = parts;
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      return fail(`Unknown version bump "${bump}". Use patch|minor|major|x.y.z.`);
  }
}

// Move the [Unreleased] entries into a dated version section. Returns the notes
// (for the GitHub release) and the rewritten changelog text.
function rollChangelog(text, version) {
  const date = new Date().toISOString().slice(0, 10);
  // Match the section header as a full line, not an inline mention in the intro.
  const headerMatch = /^## \[Unreleased\][^\n]*$/m.exec(text);
  if (!headerMatch) {
    fail('CHANGELOG.md is missing a "## [Unreleased]" section.');
  }
  const rest = text.slice(headerMatch.index + headerMatch[0].length);
  const nextMatch = rest.search(/\n## \[/);
  const body = (nextMatch === -1 ? rest : rest.slice(0, nextMatch)).trim();
  if (!body) {
    fail('No entries under "## [Unreleased]". Add what changed before releasing.');
  }
  const tail = nextMatch === -1 ? '' : rest.slice(nextMatch).replace(/^\n+/, '');
  const head = text.slice(0, headerMatch.index);
  const updated = `${head}## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n\n${tail}`;
  return { notes: body, updated };
}

function updateTap(formulaPath, version) {
  const workDir = mkdtempSync(join(tmpdir(), 'hychat-tap-'));
  const tapDir = join(workDir, 'homebrew-tap');
  try {
    run('git', ['clone', `git@github.com:${TAP_REPO}.git`, tapDir], { cwd: workDir });
    cpSync(formulaPath, join(tapDir, 'Formula', 'hychat.rb'));
    run('git', ['add', 'Formula/hychat.rb'], { cwd: tapDir });
    run('git', ['commit', '-m', `hychat ${version}`], { cwd: tapDir });
    run('git', ['push', 'origin', 'HEAD'], { cwd: tapDir });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (!bumpArg) {
  fail('Usage: pnpm release <patch|minor|major|x.y.z> [--dry-run]');
}

// Preconditions (skipped for --dry-run so it can be run from any branch).
if (!dryRun) {
  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    fail(`Releases must run on main (currently on "${branch}").`);
  }
  if (capture('git', ['status', '--porcelain'])) {
    fail('Working tree is not clean. Commit or stash changes first.');
  }
  // An explicit env token is authoritative. Otherwise ask gh for the token it
  // would use and pass it down explicitly — `gh auth token` reads the stored
  // (e.g. macOS-keychain) credential reliably, unlike `gh auth status`, which
  // flakily reports "not authenticated" when run with stdin detached.
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    let token = '';
    try {
      token = capture('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      token = '';
    }
    if (!token) {
      fail(
        'GitHub CLI is not authenticated. Run `gh auth login`, or set GH_TOKEN ' +
          '(e.g. `GH_TOKEN="$(gh auth token)" pnpm release ...`).'
      );
    }
    // Hand the resolved token to the gh subcommands below via the environment.
    process.env.GH_TOKEN = token;
  }
}

const pkgPath = join(rootDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = computeVersion(pkg.version, bumpArg);
const tag = `v${version}`;
if (capture('git', ['tag', '--list', tag])) {
  fail(`Tag ${tag} already exists.`);
}

const changelogPath = join(rootDir, 'CHANGELOG.md');
const { notes, updated } = rollChangelog(readFileSync(changelogPath, 'utf8'), version);

console.log(`\nReleasing ${pkg.version} -> ${version} (${tag})\n`);
console.log('Release notes:\n');
console.log(notes);
console.log('');

if (dryRun) {
  console.log('--dry-run: no files written, nothing pushed.');
  process.exit(0);
}

// 1. Bump version + roll changelog.
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
writeFileSync(changelogPath, updated);

// 2. Build the tarball + formula.
run('pnpm', ['pack:brew'], { env: { ...process.env, GITHUB_REPOSITORY: REPO } });
const tarball = join(rootDir, 'dist', 'releases', `hychat-${version}.tgz`);
const formula = join(rootDir, 'dist', 'homebrew', 'hychat.rb');

// 3. Commit + push main, then tag.
run('git', ['add', 'package.json', 'CHANGELOG.md']);
run('git', ['commit', '-m', `release: ${tag}`]);
run('git', ['push', 'origin', 'main']);
run('git', ['tag', '-a', tag, '-m', `HyChat ${tag}`]);
run('git', ['push', 'origin', tag]);

// 4. GitHub release with the tarball asset.
run('gh', [
  'release',
  'create',
  tag,
  '--repo',
  REPO,
  '--title',
  `HyChat ${tag}`,
  '--notes',
  notes,
  tarball
]);

// 5. Update the Homebrew tap.
updateTap(formula, version);

console.log(`\n✅ Released ${tag}. Friends update with: brew upgrade hychat`);
