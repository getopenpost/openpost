import { describe, expect, it } from 'vitest';
import {
	createIdentityLutData,
	decodeLutData,
	encodeCubeLut,
	encodeLutData,
	parseCubeLut,
	resampleCubeLut
} from './lut';

describe('cube LUT', () => {
	it('parses and packs a 2x2x2 identity LUT', () => {
		const encoded = encodeCubeLut(
			`LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1`
		);
		expect(encoded.size).toBe(2);
		expect(atob(encoded.data)).toHaveLength(32);
	});

	it('rejects incomplete LUTs', () => {
		expect(() => encodeCubeLut('LUT_3D_SIZE 2\n0 0 0')).toThrow(/expected 8/i);
	});

	it('parses a 129-sized header and supports chunked base64 >64', () => {
		const size = 65;
		const entries = size ** 3;
		const lines = [`LUT_3D_SIZE ${size}`];
		for (let i = 0; i < entries; i++) {
			const r = (i % size) / (size - 1);
			const g = (Math.floor(i / size) % size) / (size - 1);
			const b = Math.floor(i / (size * size)) / (size - 1);
			lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
		}
		const parsed = parseCubeLut(lines.join('\n'));
		expect(parsed.size).toBe(65);
		expect(parsed.data).toHaveLength(65 * 65 * 65 * 4);
		// Encode via chunked path must round-trip
		const encoded = encodeLutData(parsed.data);
		expect(decodeLutData(encoded)).toEqual(parsed.data);
		// First and last texels are exact corners
		expect(Array.from(parsed.data.subarray(0, 4))).toEqual([0, 0, 0, 255]);
		expect(Array.from(parsed.data.subarray(parsed.data.length - 4))).toEqual([255, 255, 255, 255]);
	});

	it('resamples identity 65 to 33 with trilinear correctness within 1', () => {
		const source = { title: null, size: 65, data: createIdentityLutData(65) };
		const resampled = resampleCubeLut(source, 33);
		expect(resampled.size).toBe(33);
		const expected = createIdentityLutData(33);
		for (let i = 0; i < expected.length; i++) {
			expect(Math.abs((resampled.data[i] ?? 0) - (expected[i] ?? 0))).toBeLessThanOrEqual(1);
		}
	});

	it('applies DOMAIN_MIN/DOMAIN_MAX and exponent notation', () => {
		const encoded = encodeCubeLut(
			`LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n0 0 0\n2 0 0\n0 2 0\n2 2 0\n0 0 2\n2 0 2\n0 2 2\n1 1 1`
		);
		const data = decodeLutData(encoded.data);
		// 2 maps to 255, 1 maps to 128
		expect(data[4]).toBe(255);
		expect(Array.from(data.subarray(7 * 4, 8 * 4))).toEqual([128, 128, 128, 255]);
		const exp = parseCubeLut(`LUT_3D_SIZE 2\n${Array(8).fill('5e-1 1e0 0e0').join('\n')}`);
		expect(exp.data[0]).toBe(128);
		expect(exp.data[1]).toBe(255);
		expect(exp.data[2]).toBe(0);
	});

	it('keeps full 65-129 size without downsampling and rejects 1D / missing size', () => {
		expect(() => parseCubeLut('LUT_3D_SIZE 129\n0 0 0')).toThrow(/expected 2146689/);
		expect(() => parseCubeLut('LUT_1D_SIZE 1024')).toThrow('1D LUTs are not supported');
		expect(() => parseCubeLut('TITLE "no size"\n0 0 0')).toThrow(/LUT_3D_SIZE/);
		expect(() => parseCubeLut('LUT_3D_SIZE 130\n0 0 0')).toThrow(/between 2 and 129/);
		// 65 stays 65 - not auto-downsampled to 33
		const lines65 = [`LUT_3D_SIZE 65`, ...Array(65 ** 3).fill('0.5 0.5 0.5')];
		const parsed65 = parseCubeLut(lines65.join('\n'));
		expect(parsed65.size).toBe(65);
		const encoded65 = encodeCubeLut(lines65.join('\n'));
		expect(encoded65.size).toBe(65);
		// 129 limit is accepted (header parsed) - truncated data throws count proving limit is 129 not 64
		expect(() => parseCubeLut('LUT_3D_SIZE 129\n' + Array(10).fill('0 0 0').join('\n'))).toThrow(/2146689/);
	});

	it('preserves distinct samples that a 33 resample would collapse', () => {
		// 64 high-frequency pattern: adjacent texels alternate 0/1, downsample to 33 must interpolate
		const size = 64;
		const lines = [`LUT_3D_SIZE ${size}`];
		for (let i = 0; i < size ** 3; i++) {
			const r = i % size;
			const v = r % 2 === 0 ? 0 : 1;
			lines.push(`${v} ${v} ${v}`);
		}
		const full = parseCubeLut(lines.join('\n'));
		expect(full.size).toBe(64);
		// Full retains alternating extremes
		expect(full.data[0]).toBe(0);
		expect(full.data[4]).toBe(255);
		const downsampled = resampleCubeLut(full, 33);
		expect(downsampled.size).toBe(33);
		// Downsampled interpolates between 0 and 255, so first blended texel is mid-grey, not pure extremes
		// With scale 63/32=1.96875, downsampled texel 1 samples between src 1 and 2
		const mid = downsampled.data[4] ?? 0;
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(255);
		// Full 64 encoded keeps size 64
		const encodedFull = encodeCubeLut(lines.join('\n'));
		expect(encodedFull.size).toBe(64);
	});
});
