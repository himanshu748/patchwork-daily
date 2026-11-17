const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map<string, number>([...ALPHABET].map((ch, i) => [ch, i]));

/** Standard base64 with padding; pure, so it runs the same on the Client and the Server. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : ALPHABET[b2 & 63];
  }
  return out;
}

/** Null for anything that is not canonical padded base64. */
export function base64ToBytes(text: string): Uint8Array | null {
  if (typeof text !== 'string' || text.length % 4 !== 0) return null;
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const v: number[] = [];
    for (let k = 0; k < 4; k++) {
      const ch = text[i + k] as string;
      if (ch === '=') {
        if (i + 4 !== text.length || k < 2 || (k === 2 && text[i + 3] !== '=')) return null;
        v.push(0);
      } else {
        const n = LOOKUP.get(ch);
        if (n === undefined) return null;
        v.push(n);
      }
    }
    const [a, b, c, d] = v as [number, number, number, number];
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (triple >> 16) & 255;
    if (o < out.length) out[o++] = (triple >> 8) & 255;
    if (o < out.length) out[o++] = triple & 255;
  }
  if (bytesToBase64(out) !== text) return null;
  return out;
}
