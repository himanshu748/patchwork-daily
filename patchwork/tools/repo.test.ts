import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE, THEME } from '../src/shared/palette';
import type { ThemeTokens } from '../src/shared/palette';

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
const DEPENDENCY_ALLOWLIST = new Set([
  // Devvit Web runtime, build plugin, test harness and Journeys analytics (React template, F2, F27, F28).
  '@devvit/analytics',
  '@devvit/start',
  '@devvit/test',
  '@devvit/web',
  'devvit',
  // Server framework and client UI from the template.
  '@hono/node-server',
  'hono',
  'react',
  'react-dom',
  // Build, type and lint tooling from the template.
  '@eslint/js',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  'eslint',
  'eslint-plugin-react-hooks',
  'eslint-plugin-react-refresh',
  'globals',
  'prettier',
  'typescript',
  'typescript-eslint',
  'vite',
  // Tests.
  'fast-check',
  'vitest',
]);

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

  it('imports Journeys only from src/client/lib/track.ts and the server telemetry route (Req 24.1)', () => {
    const allowed = new Set(['src/client/lib/track.ts', 'src/server/routes/telemetry.ts']);
    for (const file of walk(join(ROOT, 'src')).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))) {
      if (allowed.has(rel(file))) continue;
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/(?:from\s+|import\s*\(\s*)['"]@devvit\/analytics/);
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

  it.skipIf(!existsSync(tokens))('keeps tokens.css colours equal to src/shared/palette.ts (Req 25.1)', () => {
    const text = readFileSync(tokens, 'utf8');
    const [light = '', dark = ''] = text.split('@media (prefers-color-scheme: dark)');
    const read = (block: string): Map<string, string> =>
      new Map([...block.matchAll(/--colour-([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1] as string, (m[2] as string).toLowerCase()]));
    const names: Record<keyof ThemeTokens, string> = {
      paper: 'paper',
      ink: 'ink',
      inkMuted: 'ink-muted',
      emptyCell: 'empty-cell',
      gridLine: 'grid-line',
      focus: 'focus',
      focusHalo: 'focus-halo',
      placeholder: 'placeholder',
    };
    for (const [mode, block] of [['light', light], ['dark', dark]] as const) {
      const css = read(block);
      for (const [key, name] of Object.entries(names)) expect(css.get(name), `${mode} --colour-${name}`).toBe(THEME[mode][key as keyof ThemeTokens]);
      for (const entry of PALETTE) expect(css.get(`palette-${entry.id}`), `${mode} palette ${entry.id}`).toBe(entry[mode]);
    }
  });

  const client = join(ROOT, 'src/client');
  it.skipIf(!existsSync(client))('calls fetch only in lib/api.ts and only for /api/ paths (Req 1.8, Req 2.1)', () => {
    for (const file of walk(client).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))) {
      const text = readFileSync(file, 'utf8');
      if (rel(file) !== 'src/client/lib/api.ts') expect(text, rel(file)).not.toMatch(/\bfetch\s*\(/);
      for (const m of text.matchAll(/\bapi(?:Get|Post)(?:<[^>]*>)?\(\s*(['"`])([^'"`]*)\1/g)) {
        expect(m[2], rel(file)).toMatch(/^\/api\//);
      }
      expect(text, rel(file)).not.toMatch(/https?:\/\//);
    }
  });

  it.skipIf(!existsSync(client))('uses Devvit effects instead of window.location and alert (template rule)', () => {
    for (const file of walk(client).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/\b(?:window\.)?location\.(?:href|assign|replace|reload)\b|\bwindow\.location\s*=|\b(?:window\.)?alert\s*\(/);
    }
  });

  it.skipIf(!existsSync(client))('loads every client script from a file, never inline (template rule)', () => {
    for (const file of walk(client).filter((f) => f.endsWith('.html'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        expect(m[1], rel(file)).toMatch(/\bsrc=/);
        expect((m[2] ?? '').trim(), rel(file)).toBe('');
      }
    }
  });

  it.skipIf(!existsSync(client))('keeps colour literals out of client code except tokens.css (Req 25.1)', () => {
    for (const file of walk(client).filter((f) => /\.(tsx?|css)$/.test(f) && f !== tokens)) {
      expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    }
  });

  const devvitJson = join(ROOT, 'devvit.json');
  it.skipIf(!existsSync(devvitJson))('declares the daily-post task at 00:00 UTC with internal endpoints (Req 7.5, F3)', () => {
    const json = readJson(devvitJson) as {
      scheduler?: { tasks?: Record<string, { endpoint?: string; cron?: string }> };
      permissions?: Record<string, unknown>;
      post?: { entrypoints?: Record<string, { entry?: string; inline?: boolean; height?: string }> };
      triggers?: Record<string, string>;
      menu?: { items?: { endpoint?: string }[] };
      forms?: Record<string, string>;
    };
    const task = json.scheduler?.tasks?.['daily-post'];
    expect(task?.cron).toBe('0 0 * * *');
    for (const t of Object.values(json.scheduler?.tasks ?? {})) expect(t.endpoint?.startsWith('/internal/')).toBe(true);
    for (const e of Object.values(json.triggers ?? {})) expect(e.startsWith('/internal/')).toBe(true);
    for (const i of json.menu?.items ?? []) expect(i.endpoint?.startsWith('/internal/')).toBe(true);
    for (const e of Object.values(json.forms ?? {})) expect(e.startsWith('/internal/')).toBe(true);
    expect(json.permissions).toEqual({
      redis: true,
      realtime: true,
      journeys: true,
      reddit: { enable: true, scope: 'moderator', asUser: ['SUBMIT_COMMENT'] },
    });
    expect(json.post?.entrypoints?.default).toEqual({ entry: 'splash.html', inline: true, height: 'tall' });
    expect(json.post?.entrypoints?.game?.entry).toBe('game.html');
  });
});
