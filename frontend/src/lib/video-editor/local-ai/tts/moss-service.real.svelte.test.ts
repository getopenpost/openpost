import { afterAll, describe, expect, it } from 'vitest';
import { mossTtsService } from './moss-service';

const runRealModel = import.meta.env.VITE_OPENPOST_REAL_LOCAL_AI_TEST === '1';

it('serves the MOSS worker runtime as JavaScript', async () => {
	const response = await fetch('/moss-tts/moss_tts.worker.js');
	const source = await response.text();
	expect(response.ok).toBe(true);
	expect(response.headers.get('content-type')).toMatch(/javascript/);
	expect(source).toContain('openpost-moss-tts-worker');
});

describe.skipIf(!runRealModel)('MOSS TTS real browser model', () => {
	afterAll(() => mossTtsService.unload());

	it('downloads, warms, and synthesizes a playable multilingual voice', async () => {
		const stages = new Set<string>();
		const generated = await mossTtsService.generateSpeechFile({
			text: 'Hello from OpenPost.',
			voice: 'Ava',
			speed: 1,
			onProgress: (progress) => stages.add(progress.stage)
		});
		const bytes = new Uint8Array(await generated.blob.arrayBuffer());
		expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF');
		expect(generated.file.type).toBe('audio/wav');
		expect(generated.duration).toBeGreaterThan(0.1);
		expect(generated.sampleRate).toBeGreaterThan(8_000);
		expect(stages).toContain('generating');
		expect(stages).toContain('finalizing');
	}, 900_000);

	it('cancels worker inference and starts cleanly on the next request', async () => {
		const abort = new AbortController();
		let reachedWorker = false;
		const cancelled = mossTtsService.generateSpeechFile({
			text: 'This request must stop after multilingual text preparation.',
			voice: 'Ava',
			speed: 1,
			signal: abort.signal,
			onProgress: (progress) => {
				if (progress.message.includes('Preparing multilingual text')) {
					reachedWorker = true;
					abort.abort();
				}
			}
		});
		await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
		expect(reachedWorker).toBe(true);

		const retried = await mossTtsService.generateSpeechFile({
			text: 'The clean retry works.',
			voice: 'Ava',
			speed: 1
		});
		expect(retried.duration).toBeGreaterThan(0.1);
	}, 900_000);
});
