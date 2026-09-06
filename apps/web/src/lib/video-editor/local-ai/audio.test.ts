import { describe, expect, it } from 'vitest';
import { applyPlaybackSpeed, createFloat32WavBlob } from './audio';

describe('local AI audio', () => {
	it('writes an interleaved stereo float WAV with correct RIFF metadata', async () => {
		const blob = createFloat32WavBlob(
			[new Float32Array([0.25, 0.5]), new Float32Array([-0.25, -0.5])],
			48_000
		);
		const buffer = await blob.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		const view = new DataView(buffer);

		expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
		expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE');
		expect(view.getUint16(20, true)).toBe(3);
		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint32(24, true)).toBe(48_000);
		expect(view.getUint32(40, true)).toBe(16);
		expect(view.getFloat32(44, true)).toBeCloseTo(0.25);
		expect(view.getFloat32(48, true)).toBeCloseTo(-0.25);
	});

	it('changes duration without mutating the source samples', () => {
		const source = new Float32Array([0, 1, 0, -1, 0]);
		const [faster] = applyPlaybackSpeed([source], 2);
		const [slower] = applyPlaybackSpeed([source], 0.5);

		expect(faster).toEqual(new Float32Array([0, 0, 0]));
		expect(slower?.length).toBe(9);
		expect(source).toEqual(new Float32Array([0, 1, 0, -1, 0]));
	});
});
