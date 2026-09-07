import { describe, expect, it } from 'vitest';
import {
	estimateParakeetRuntimeBytes,
	estimateTranscriptionModelBytes,
	formatModelBytes
} from './runtime-estimates';

describe('runtime-estimates', () => {
	it('scales whisper downloads by quantization', () => {
		const fp32 = estimateTranscriptionModelBytes('whisper-small', 'fp32');
		const q4 = estimateTranscriptionModelBytes('whisper-small', 'q4');
		expect(fp32).toBeGreaterThan(q4);
		expect(fp32).toBe(Math.round(900 * 1024 * 1024));
	});

	it('hybrid whisper-base stays well under whisper-large', () => {
		expect(estimateTranscriptionModelBytes('whisper-base', 'hybrid')).toBeLessThan(
			estimateTranscriptionModelBytes('whisper-large', 'hybrid')
		);
	});

	it('sizes parakeet by backend', () => {
		expect(estimateParakeetRuntimeBytes('webgpu')).toBeGreaterThan(
			estimateParakeetRuntimeBytes('wasm')
		);
	});

	it('formats bytes for the picker', () => {
		expect(formatModelBytes(512 * 1024)).toBe('512 KB');
		expect(formatModelBytes(estimateTranscriptionModelBytes('whisper-base', 'hybrid'))).toBe(
			'273 MB'
		);
		expect(formatModelBytes(estimateParakeetRuntimeBytes('webgpu'))).toBe('1.2 GB');
	});
});
