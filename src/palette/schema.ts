import type { Palette, PaletteEntry } from '@/types';

const HEX = /^[A-Z]\d{3}$/;

function rgbValid(rgb: readonly number[]): boolean {
  return rgb.length === 3
    && rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255);
}

export function parsePalette(raw: unknown): Palette {
  if (!Array.isArray(raw)) {
    throw new Error('Palette JSON must be an array');
  }
  return raw.map((entry, idx) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Palette[${idx}] not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !HEX.test(e.id)) {
      throw new Error(`Palette[${idx}].id invalid: ${e.id}`);
    }
    if (!Array.isArray(e.rgb) || !rgbValid(e.rgb)) {
      throw new Error(`Palette[${idx}].rgb invalid`);
    }
    if (typeof e.name !== 'string') {
      throw new Error(`Palette[${idx}].name invalid`);
    }
    const entry_: PaletteEntry = {
      id: e.id,
      rgb: [e.rgb[0], e.rgb[1], e.rgb[2]] as [number, number, number],
      name: e.name,
    };
    return entry_;
  });
}

export async function loadPalette(): Promise<Palette> {
  const res = await fetch('/data/mard.json');
  if (!res.ok) throw new Error(`Failed to load palette: ${res.status}`);
  const raw = await res.json();
  return parsePalette(raw);
}
