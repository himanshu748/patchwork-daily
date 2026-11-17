import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '__snapshots__']);
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|md|svg|txt)$/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function rel(file: string): string {
  return relative(ROOT, file);
}

/** Follows `extends` and merges compilerOptions, nearest file last. */
function compilerOptions(file: string): Record<string, unknown> {
  const json = readJson(file);
  const own = (json.compilerOptions ?? {}) as Record<string, unknown>;
  if (typeof json.extends !== 'string') return own;
  return { ...compilerOptions(resolve(dirname(file), json.extends)), ...own };
}

const pkg = readJson(join(ROOT, 'package.json'));
const sharedSources = walk(join(ROOT, 'src/shared')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('/test/'));

/** Every dependency must be listed here; none is a paid service or LLM SDK (Req 1.8). */
const DEPENDENCY_ALLOWLIST = new Set(['@types/node', 'fast-check', 'typescript', 'vitest']);

describe('repository checks', () => {
  it('sets strict in every tsconfig (Req 28.1)', () => {
    const configs = [...walk(join(ROOT, 'tools')), ...walk(join(ROOT, 'src'))].filter((f) => /tsconfig.*\.json$/.test(basename(f)));
    expect(configs.length).toBeGreaterThanOrEqual(2);
    for (const file of configs) {
      if (rel(file) === 'tools/tsconfig.base.json') continue;
      expect(compilerOptions(file).strict, rel(file)).toBe(true);
    }
    expect(compilerOptions(join(ROOT, 'tools/tsconfig.base.json')).strict).toBe(true);
  });

  it('keeps src/shared pure (Req 28.2)', () => {
    expect(sharedSources.length).toBeGreaterThan(0);
    const forbiddenImport = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
    for (const file of sharedSources) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(forbiddenImport)) {
        const spec = m[1] as string;
        expect(spec, `${rel(file)} imports ${spec}`).not.toMatch(/(^|\/)(client|server)(\/|$)|^@devvit\/|^devvit$|redis/i);
        expect(spec.startsWith('./'), `${rel(file)} imports ${spec}`).toBe(true);
      }
      expect(text, rel(file)).not.toMatch(/Math\.random|\bnew Date\b|\bDate\.|toLocale|\bIntl\./);
    }
    const lib = compilerOptions(join(ROOT, 'src/shared/tsconfig.json')).lib as string[] | undefined;
    expect(lib).toBeDefined();
    expect((lib ?? []).some((l) => /dom/i.test(l))).toBe(false);
    expect(compilerOptions(join(ROOT, 'src/shared/tsconfig.json')).types).toEqual([]);
  });

  it('requires Node 24.18 or later (Req 1.4)', () => {
    expect((pkg.engines as Record<string, string>).node).toBe('>=24.18.0');
    const nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
    const [major, minor] = nvmrc.split('.').map(Number);
    expect((major as number) > 24 || ((major as number) === 24 && (minor ?? 0) >= 18)).toBe(true);
  });

  it('has no launch or publish script (Req 1.5, Req 1.6, B8)', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(Object.keys(scripts)).not.toContain('launch');
    for (const [name, cmd] of Object.entries(scripts)) expect(cmd, name).not.toMatch(/devvit\s+publish/);
    expect(scripts.test).toBe('vitest --run');
  });

  it('uses only allowlisted dependencies and calls no outside service (Req 1.8, Req 2.1)', () => {
    const deps = { ...(pkg.dependencies as Record<string, string> | undefined), ...(pkg.devDependencies as Record<string, string> | undefined) };
    for (const name of Object.keys(deps)) expect(DEPENDENCY_ALLOWLIST.has(name), `dependency ${name} is not allowlisted`).toBe(true);
    const serverAndShared = [...walk(join(ROOT, 'src/server')), ...walk(join(ROOT, 'src/shared'))].filter((f) => /\.tsx?$/.test(f));
    for (const file of serverAndShared) {
      const text = readFileSync(file, 'utf8');
      expect(text, rel(file)).not.toMatch(/\bfetch\s*\(/);
      expect(text, rel(file)).not.toMatch(/https?:\/\//);
    }
  });

  it('has no Snoo file and no snoo or karma text (Req 2.8)', () => {
    for (const file of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'public'))]) {
      expect(basename(file).toLowerCase().startsWith('snoo.'), rel(file)).toBe(false);
      if (!TEXT_EXT.test(file)) continue;
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/snoo|karma/i);
    }
  });

  it('imports the Journeys client module only from src/client/lib/track.ts (Req 24.1)', () => {
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f))) {
      if (rel(file) === 'src/client/lib/track.ts') continue;
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/from\s+['"][^'"]*journeys[^'"]*['"]/i);
    }
  });

  it('never copies the Devvit docs snapshot into the app', () => {
    expect(walk(ROOT).some((f) => basename(f) === 'devvit-docs-llms-full.txt')).toBe(false);
  });

  const tokens = join(ROOT, 'src/client/tokens.css');
  it.skipIf(!existsSync(tokens))('declares at most 5 font sizes and 2 families in tokens.css only (Req 25.2)', () => {
    const text = readFileSync(tokens, 'utf8');
    expect(new Set(text.match(/--font-size-[\w-]+\s*:/g) ?? []).size).toBeLessThanOrEqual(5);
    expect(new Set(text.match(/--font-family-[\w-]+\s*:/g) ?? []).size).toBeLessThanOrEqual(2);
    for (const file of walk(join(ROOT, 'src/client')).filter((f) => f.endsWith('.css') && f !== tokens)) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/font-(size|family)\s*:/);
    }
  });

  const client = join(ROOT, 'src/client');
  it.skipIf(!existsSync(client))('keeps colour literals out of client code except tokens.css (Req 25.1)', () => {
    for (const file of walk(client).filter((f) => /\.(tsx?|css)$/.test(f) && f !== tokens)) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    }
  });

  const devvitJson = join(ROOT, 'devvit.json');
  it.skipIf(!existsSync(devvitJson))('declares the daily-post task at 00:00 UTC with internal endpoints (Req 7.5, F3)', () => {
    const json = readJson(devvitJson) as { scheduler?: { tasks?: Record<string, { endpoint?: string; cron?: string }> } };
    const task = json.scheduler?.tasks?.['daily-post'];
    expect(task?.cron).toBe('0 0 * * *');
    expect(task?.endpoint?.startsWith('/internal/')).toBe(true);
  });
});
