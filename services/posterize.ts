/**
 * Flatten a bitmap before tracing: k-means palette of `k` colours, then a 3×3
 * majority filter on the palette labels. Texture grain, paper noise and
 * anti-aliasing fringes otherwise become hundreds of tiny paths in VTracer.
 * Alpha is copied unchanged. Used in: vtracerService.prepareForTrace.
 */
export function posterize(src: Uint8ClampedArray, w: number, h: number, k: number, passes = 2): Uint8ClampedArray {
    const n = w * h;
    // Lloyd's k-means on a strided sample (≤ 16k pixels): fast and deterministic.
    const stride = Math.max(1, Math.floor(n / 16384));
    const sample: number[] = [];
    for (let i = 0; i < n; i += stride) sample.push(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]);
    const m = sample.length / 3;
    const dist = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number) =>
        (a[ai] - b[bi]) ** 2 + (a[ai + 1] - b[bi + 1]) ** 2 + (a[ai + 2] - b[bi + 2]) ** 2;

    // Farthest-point init keeps small but distinct accents (a red dot) as their own colour.
    let centres: number[] = [sample[0], sample[1], sample[2]];
    const nearest = new Float64Array(m).fill(Infinity);
    while (centres.length / 3 < k) {
        const c = centres.length - 3;
        let far = 0;
        for (let s = 0; s < m; s++) {
            nearest[s] = Math.min(nearest[s], dist(sample, s * 3, centres, c));
            if (nearest[s] > nearest[far]) far = s;
        }
        if (nearest[far] === 0) break; // fewer distinct colours than k
        centres.push(sample[far * 3], sample[far * 3 + 1], sample[far * 3 + 2]);
    }
    const kk = centres.length / 3;
    const closest = (data: ArrayLike<number>, i: number) => {
        let best = 0, bd = Infinity;
        for (let c = 0; c < kk; c++) { const d = dist(data, i, centres, c * 3); if (d < bd) { bd = d; best = c; } }
        return best;
    };
    for (let iter = 0; iter < 12; iter++) {
        const sum = new Float64Array(kk * 4);
        for (let s = 0; s < m; s++) {
            const c = closest(sample, s * 3);
            sum[c * 4] += sample[s * 3]; sum[c * 4 + 1] += sample[s * 3 + 1]; sum[c * 4 + 2] += sample[s * 3 + 2]; sum[c * 4 + 3]++;
        }
        const next = centres.map((v, i) => { const c = Math.floor(i / 3); return sum[c * 4 + 3] ? sum[c * 4 + i % 3] / sum[c * 4 + 3] : v; });
        if (next.every((v, i) => Math.abs(v - centres[i]) < 0.5)) { centres = next; break; }
        centres = next;
    }

    let labels = new Uint8Array(n);
    for (let i = 0; i < n; i++) labels[i] = closest(src, i * 4);

    // Majority filter: a pixel takes the most frequent label of its 3×3 window (ties keep its own).
    const counts = new Uint16Array(kk);
    for (let p = 0; p < passes; p++) {
        const out = new Uint8Array(n);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            counts.fill(0);
            for (let dy = -1; dy <= 1; dy++) {
                const yy = Math.min(h - 1, Math.max(0, y + dy));
                for (let dx = -1; dx <= 1; dx++) counts[labels[yy * w + Math.min(w - 1, Math.max(0, x + dx))]]++;
            }
            let best = labels[y * w + x];
            for (let c = 0; c < kk; c++) if (counts[c] > counts[best]) best = c;
            out[y * w + x] = best;
        }
        labels = out;
    }

    const dst = new Uint8ClampedArray(src.length);
    for (let i = 0; i < n; i++) {
        const c = labels[i] * 3;
        dst[i * 4] = centres[c]; dst[i * 4 + 1] = centres[c + 1]; dst[i * 4 + 2] = centres[c + 2]; dst[i * 4 + 3] = src[i * 4 + 3];
    }
    return dst;
}
