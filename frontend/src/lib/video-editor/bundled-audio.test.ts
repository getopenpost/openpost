import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUNDLED_AUDIO_MANIFEST } from './bundled-audio.generated';

describe('OpenPost Video Editor bundled audio', () => {
	it('ships the promised licensed asset inventory', () => {
		expect(BUNDLED_AUDIO_MANIFEST.assets.filter((asset) => asset.kind === 'music')).toHaveLength(8);
		expect(BUNDLED_AUDIO_MANIFEST.assets.filter((asset) => asset.kind === 'effect')).toHaveLength(
			12
		);
		expect(
			BUNDLED_AUDIO_MANIFEST.assets.every(
				(asset) => asset.license === 'CC0-1.0' && asset.author === 'OpenPost contributors'
			)
		).toBe(true);
	});

	it('matches every checked-in byte size and SHA-256 hash', async () => {
		for (const asset of BUNDLED_AUDIO_MANIFEST.assets) {
			const bytes = await readFile(resolve('static', asset.path.replace(/^\//u, '')));
			expect(bytes.byteLength, asset.id).toBe(asset.size_bytes);
			expect(createHash('sha256').update(bytes).digest('hex'), asset.id).toBe(asset.sha256);
		}
	});

	it('keeps mastered PCM below the declared peak ceiling', async () => {
		const peakLimit = 10 ** (-0.9 / 20);
		for (const asset of BUNDLED_AUDIO_MANIFEST.assets) {
			const bytes = await readFile(resolve('static', asset.path.replace(/^\//u, '')));
			let peak = 0;
			for (let offset = 44; offset + 1 < bytes.byteLength; offset += 2) {
				peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset) / 32767));
			}
			expect(peak, asset.id).toBeLessThanOrEqual(peakLimit);
		}
	});
});
