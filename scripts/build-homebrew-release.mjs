#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const releasesDir = join(rootDir, 'dist', 'releases');
const formulaDir = join(rootDir, 'dist', 'homebrew');
const templatePath = join(rootDir, 'packaging', 'homebrew', 'hychat.rb.template');

mkdirSync(releasesDir, { recursive: true });

for (const file of readdirSync(releasesDir)) {
  if (file.endsWith('.tgz')) {
    rmSync(join(releasesDir, file));
  }
}

execFileSync('pnpm', ['pack', '--pack-destination', releasesDir], {
  cwd: rootDir,
  stdio: 'inherit'
});

const tarballPath = findNewestTarball(releasesDir);
const sha256 = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
const repository = process.env.GITHUB_REPOSITORY ?? 'fantasy-ai-catcher/hychat';
const tarballUrl =
  process.env.HOMEBREW_TARBALL_URL ??
  `https://github.com/${repository}/releases/download/v${packageJson.version}/${basename(
    tarballPath
  )}`;
const license = process.env.HOMEBREW_LICENSE ?? packageJson.license ?? 'MIT';

const formula = readFileSync(templatePath, 'utf8')
  .replaceAll('{{GITHUB_REPOSITORY}}', repository)
  .replaceAll('{{TARBALL_URL}}', tarballUrl)
  .replaceAll('{{SHA256}}', sha256)
  .replaceAll('{{LICENSE}}', license);
const formulaPath = join(formulaDir, 'hychat.rb');
mkdirSync(formulaDir, { recursive: true });
writeFileSync(formulaPath, formula);

console.log(`Tarball: ${tarballPath}`);
console.log(`SHA256: ${sha256}`);
console.log(`Formula: ${formulaPath}`);

function findNewestTarball(dir) {
  const tarballs = readdirSync(dir)
    .filter((file) => file.endsWith('.tgz'))
    .map((file) => join(dir, file))
    .filter((file) => existsSync(file))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (tarballs.length === 0) {
    throw new Error(`No .tgz tarball was created in ${dir}`);
  }

  return tarballs[0];
}
