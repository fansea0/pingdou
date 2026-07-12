import { describe, it, expect } from 'vitest';
import { WebGLQuantizer } from '@/pipeline/quantizer.webgl';
import fragSource from '../../shaders/quantize.frag.glsl?raw';
import type { Palette } from '@/types';

const palette: Palette = [
  { id: 'A01', rgb: [0, 0, 0], name: '黑' },
  { id: 'A02', rgb: [255, 255, 255], name: '白' },
];

// jsdom doesn't implement WebGL2; this is a structural test (no real GL context).
describe('WebGLQuantizer', () => {
  it('exposes fragment shader source', () => {
    expect(fragSource).toContain('u_palette');
  });

  it('accepts palette in constructor (or throws cleanly if no WebGL)', () => {
    // In jsdom this may throw "WebGL2 not available" — that's expected.
    try {
      const q = new WebGLQuantizer(palette, fragSource);
      expect(q).toBeDefined();
    } catch (e: unknown) {
      expect(String(e)).toMatch(/WebGL2 not available/);
    }
  });
});
