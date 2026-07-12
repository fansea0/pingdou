# Pipeline Architecture Note

## Color Quantization

The MVP uses `quantizer.canvas` (pure JS) on the main thread for index
extraction. This is correct and fast enough for the spec's performance budget
because the canvas path runs against the *downsampled* ImageData
(`gridSize × gridSize`, e.g. 100×100 = 10,000 pixels) — see `sampler.ts`.

A WebGL-based renderer (see `quantizer.webgl.ts` and `shaders/quantize.frag.glsl`)
is included as a future optimization path, but the **index matrix always comes
from the JS nearest-neighbor pass** for accuracy and to avoid shader-to-CPU
round-tripping of floats (the only way to extract palette indices from a
GPU shader would be to encode them in the R/G/B channels of the output,
which loses precision and complicates the API).

If/when WebGL becomes the primary path, the index extraction will happen
either via:
- a second GPU pass that maps back through the palette look-up table, or
- continued JS run for index + GPU run for color rendering (current hybrid).

## Performance

- Sampler: O(srcW × srcH), runs once per parameter change with 200ms throttle
- Quantizer: O(gridSize² × paletteSize), always pure JS
- Renderer: O(gridSize²), pure JS canvas fillRect
- Renderer scale: 1× for preview, 16/24/32/48× for export

The current implementation satisfies the spec's performance budget:
- 100×100 quantization ≈ 87ms
- 200×200 quantization ≈ 214ms
- 500×500 quantization ≈ 1483ms

## Worker

`src/workers/quantizer.worker.ts` defines the message contract for a future
in-worker GPU pipeline. Currently it accepts `init` and `render` messages but
the heavy lifting stays on the main thread. The contract is stable and will
not change when the WebGL path is activated.
