export type PaletteId = 0 | 1 | 2 | 3;
export type Pattern = 'solid' | 'diagonal' | 'dots' | 'cross';
export type Hex = `#${string}`;

export interface PaletteEntry {
  readonly id: PaletteId;
  readonly name: string;
  readonly light: Hex;
  readonly dark: Hex;
  readonly pattern: Pattern;
}

/** The one Patchwork Palette. Values are checked by checkPalette in both modes (Req 26.1, Req 26.2). */
export const PALETTE: readonly [PaletteEntry, PaletteEntry, PaletteEntry, PaletteEntry] = [
  { id: 0, name: 'Navy', light: '#0e192f', dark: '#a8bde6', pattern: 'solid' },
  { id: 1, name: 'Rust', light: '#ce7955', dark: '#a65430', pattern: 'diagonal' },
  { id: 2, name: 'Teal', light: '#15473b', dark: '#b6f7ee', pattern: 'dots' },
  { id: 3, name: 'Ochre', light: '#826026', dark: '#c18215', pattern: 'cross' },
];

export const PALETTE_IDS: readonly PaletteId[] = [0, 1, 2, 3];

export interface ThemeTokens {
  readonly paper: Hex;
  readonly ink: Hex;
  readonly inkMuted: Hex;
  readonly emptyCell: Hex;
  readonly gridLine: Hex;
  /** Inner band of the two-band focus ring. */
  readonly focus: Hex;
  /** Outer band of the two-band focus ring. */
  readonly focusHalo: Hex;
  readonly placeholder: Hex;
}

export const THEME: { readonly light: ThemeTokens; readonly dark: ThemeTokens } = {
  light: {
    paper: '#f6f1e7',
    ink: '#1d1b18',
    inkMuted: '#57524a',
    emptyCell: '#ffffff',
    gridLine: '#8a8478',
    focus: '#1d1b18',
    focusHalo: '#ffffff',
    placeholder: '#e3dccd',
  },
  dark: {
    paper: '#121110',
    ink: '#f2ede4',
    inkMuted: '#b5aea2',
    emptyCell: '#1d1c1a',
    gridLine: '#6d675e',
    focus: '#ffffff',
    focusHalo: '#000000',
    placeholder: '#2c2a27',
  },
};

export type ColourMode = 'light' | 'dark';
export type CvdKind = 'protan' | 'deutan' | 'tritan';

function parseHex(hex: Hex): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new RangeError(`Not a #rrggbb colour: ${hex}`);
  const v = Number.parseInt(m[1] as string, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function toHex(r: number, g: number, b: number): Hex {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: Hex): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(a: Hex, b: Hex): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
const CVD_MATRICES: Readonly<Record<CvdKind, readonly number[]>> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function simulateCvd(hex: Hex, kind: CvdKind): Hex {
  const [r, g, b] = parseHex(hex).map(toLinear) as [number, number, number];
  const m = CVD_MATRICES[kind];
  const at = (i: number): number => m[i] as number;
  return toHex(
    fromLinear(at(0) * r + at(1) * g + at(2) * b),
    fromLinear(at(3) * r + at(4) * g + at(5) * b),
    fromLinear(at(6) * r + at(7) * g + at(8) * b),
  );
}

export interface ThemeCheck {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

export const MIN_PAIR_CONTRAST = 1.5;
export const MIN_CELL_CONTRAST = 3;
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_FOCUS_CONTRAST = 3;

export function paletteValues(mode: ColourMode, palette: readonly PaletteEntry[] = PALETTE): Hex[] {
  return palette.map((p) => (mode === 'light' ? p.light : p.dark));
}

/** Req 26.2: pairwise 1.5:1 unsimulated and under each CVD simulation; 3:1 against the empty Cell. */
export function checkPalette(
  mode: ColourMode,
  palette: readonly PaletteEntry[] = PALETTE,
  theme: ThemeTokens = THEME[mode],
): ThemeCheck {
  const failures: string[] = [];
  const values = paletteValues(mode, palette);
  const views: [string, (h: Hex) => Hex][] = [
    ['none', (h) => h],
    ['protan', (h) => simulateCvd(h, 'protan')],
    ['deutan', (h) => simulateCvd(h, 'deutan')],
    ['tritan', (h) => simulateCvd(h, 'tritan')],
  ];
  for (const [label, view] of views) {
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        const ratio = contrastRatio(view(values[i] as Hex), view(values[j] as Hex));
        if (ratio < MIN_PAIR_CONTRAST) failures.push(`${mode} ${label}: entries ${i} and ${j} at ${ratio.toFixed(2)}:1`);
      }
    }
  }
  values.forEach((v, i) => {
    const ratio = contrastRatio(v, theme.emptyCell);
    if (ratio < MIN_CELL_CONTRAST) failures.push(`${mode}: entry ${i} against the empty Cell at ${ratio.toFixed(2)}:1`);
  });
  return { ok: failures.length === 0, failures };
}

/**
 * Req 25.7: ink and inkMuted at 4.5:1 on paper and the empty Cell.
 * Req 26.6: the focus ring has two bands (focus inside, focusHalo outside) that reach 3:1 against each
 * other, and on every surface it can sit on (paper, empty Cell, each Palette value) at least one band
 * reaches 3:1 against that surface.
 */
export function checkTextContrast(
  mode: ColourMode,
  palette: readonly PaletteEntry[] = PALETTE,
  theme: ThemeTokens = THEME[mode],
): ThemeCheck {
  const failures: string[] = [];
  for (const [name, fg] of [
    ['ink', theme.ink],
    ['inkMuted', theme.inkMuted],
  ] as const) {
    for (const [bgName, bg] of [
      ['paper', theme.paper],
      ['emptyCell', theme.emptyCell],
    ] as const) {
      const ratio = contrastRatio(fg, bg);
      if (ratio < MIN_TEXT_CONTRAST) failures.push(`${mode}: ${name} on ${bgName} at ${ratio.toFixed(2)}:1`);
    }
  }
  const bands = contrastRatio(theme.focus, theme.focusHalo);
  if (bands < MIN_FOCUS_CONTRAST) failures.push(`${mode}: focus bands at ${bands.toFixed(2)}:1`);
  const surfaces: [string, Hex][] = [
    ['paper', theme.paper],
    ['emptyCell', theme.emptyCell],
    ...paletteValues(mode, palette).map((v, i): [string, Hex] => [`palette ${i}`, v]),
  ];
  for (const [name, surface] of surfaces) {
    const best = Math.max(contrastRatio(theme.focus, surface), contrastRatio(theme.focusHalo, surface));
    if (best < MIN_FOCUS_CONTRAST) failures.push(`${mode}: focus ring on ${name} at ${best.toFixed(2)}:1`);
  }
  return { ok: failures.length === 0, failures };
}
