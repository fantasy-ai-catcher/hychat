import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  bin?: Record<string, string>;
  files?: string[];
  license?: string;
  scripts?: Record<string, string>;
};

describe('Homebrew packaging metadata', () => {
  it('packages the built CLI and release assets for npm-style installation', () => {
    expect(packageJson.bin?.hychat).toBe('./dist/index.js');
    expect(packageJson.files).toEqual(
      expect.arrayContaining(['dist', 'README.md', '.env.example', 'LICENSE'])
    );
    expect(packageJson.license).toBe('MIT');
    expect(packageJson.scripts?.build).toContain('scripts/build.mjs');
    expect(packageJson.scripts?.prepack).toBe('pnpm build');
    expect(packageJson.scripts?.['pack:brew']).toContain('build-homebrew-release');
  });

  it('uses a runtime-only TypeScript build for packaged releases', () => {
    expect(existsSync('tsconfig.build.json')).toBe(true);

    const buildConfig = JSON.parse(readFileSync('tsconfig.build.json', 'utf8')) as {
      compilerOptions?: Record<string, unknown>;
      include?: string[];
      exclude?: string[];
    };

    expect(buildConfig.compilerOptions?.rootDir).toBe('src');
    expect(buildConfig.compilerOptions?.outDir).toBe('dist');
    expect(buildConfig.include).toEqual(['src']);
    expect(buildConfig.exclude).toEqual(
      expect.arrayContaining(['**/*.test.ts', '**/*.test.tsx'])
    );
  });

  it('keeps a Homebrew formula template aligned with Node formula guidance', () => {
    const template = readFileSync('packaging/homebrew/hychat.rb.template', 'utf8');

    expect(template).toContain('class Hychat < Formula');
    expect(template).toContain('depends_on "node"');
    expect(template).toContain('system "npm", "install", *std_npm_args');
    expect(template).toContain('bin.install_symlink libexec.glob("bin/*")');
    expect(template).toContain('shell_output("#{bin}/hychat --version")');
  });
});
