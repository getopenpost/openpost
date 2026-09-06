/** CPU fallback bins for the live grading panel. */
export interface ScopeBins {
	histogram: { red: Uint32Array; green: Uint32Array; blue: Uint32Array; luma: Uint32Array };
	vectorscope: Uint32Array;
	waveform: Uint32Array;
	parade: { red: Uint32Array; green: Uint32Array; blue: Uint32Array };
}

const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

export interface ScopePoint {
	x: number;
	y: number;
}

export function luma709(r: number, g: number, b: number): number {
	return KR * r + KG * g + KB * b;
}

export function vectorscopeCoordinate(r: number, g: number, b: number, size = 128): ScopePoint {
	const y = luma709(r, g, b);
	const cb = (b - y) / (2 * (1 - KB));
	const cr = (r - y) / (2 * (1 - KR));
	const center = size / 2;
	const scale = center * 0.92;
	return {
		x: Math.max(0, Math.min(size - 1, Math.round(center + cb * 2 * scale))),
		y: Math.max(0, Math.min(size - 1, Math.round(center - cr * 2 * scale)))
	};
}

export function buildScopeBins(data: Uint8ClampedArray, width: number, height: number): ScopeBins {
	const red = new Uint32Array(256);
	const green = new Uint32Array(256);
	const blue = new Uint32Array(256);
	const luma = new Uint32Array(256);
	const vectorscope = new Uint32Array(128 * 128);
	const waveform = new Uint32Array(256 * 128);
	const parade = {
		red: new Uint32Array(256 * 128),
		green: new Uint32Array(256 * 128),
		blue: new Uint32Array(256 * 128)
	};
	const pixelCount = Math.min(width * height, Math.floor(data.length / 4));
	for (let pixel = 0; pixel < pixelCount; pixel++) {
		const index = pixel * 4;
		const r = data[index] ?? 0;
		const g = data[index + 1] ?? 0;
		const b = data[index + 2] ?? 0;
		red[r]++;
		green[g]++;
		blue[b]++;
		const y = Math.max(0, Math.min(255, Math.round(luma709(r, g, b))));
		luma[y]++;
		const x = pixel % width;
		const waveX = Math.min(255, Math.floor((x / Math.max(1, width - 1)) * 255));
		const waveY = 127 - Math.min(127, Math.floor((y / 255) * 127));
		waveform[waveY * 256 + waveX]++;
		parade.red[(127 - Math.min(127, Math.floor((r / 255) * 127))) * 256 + waveX]++;
		parade.green[(127 - Math.min(127, Math.floor((g / 255) * 127))) * 256 + waveX]++;
		parade.blue[(127 - Math.min(127, Math.floor((b / 255) * 127))) * 256 + waveX]++;
		const vector = vectorscopeCoordinate(r / 255, g / 255, b / 255);
		vectorscope[vector.y * 128 + vector.x]++;
	}
	return { histogram: { red, green, blue, luma }, vectorscope, waveform, parade };
}
