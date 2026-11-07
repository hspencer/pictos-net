import test from 'node:test';
import assert from 'node:assert/strict';
import { posterize } from './posterize.ts';

test('posterize flattens grain to the palette and removes isolated specks', () => {
    // Left half white, right half red, with ±12 grain and isolated black specks.
    const w = 40, h = 20, px = new Uint8ClampedArray(w * h * 4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 24;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const base = x < w / 2 ? [250, 250, 250] : [200, 30, 30];
        const speck = (x * 7 + y * 13) % 53 === 0;
        for (let c = 0; c < 3; c++) px[i + c] = speck ? 0 : base[c] + rnd();
        px[i + 3] = 255;
    }
    const out = posterize(px, w, h, 3);
    const colours = new Set<string>();
    for (let i = 0; i < out.length; i += 4) colours.add(`${out[i]},${out[i + 1]},${out[i + 2]}`);
    assert.ok(colours.size <= 2, `specks survived: ${[...colours].join(' ')}`);
    const at = (x: number, y: number) => out[(y * w + x) * 4];
    assert.ok(at(5, 10) > 230 && at(35, 10) > 180 && out[(10 * w + 35) * 4 + 1] < 60, 'regions keep their colour');
    assert.equal(out[3], 255);
});
