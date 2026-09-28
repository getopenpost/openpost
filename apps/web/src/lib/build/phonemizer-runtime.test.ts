import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { phonemizerRuntimePlugin } from './phonemizer-runtime';

it('keeps English pronunciation working in the optimized production artifact', async () => {
	const output = await mkdtemp(join(tmpdir(), 'openpost-phonemizer-'));
	try {
		const entry = createRequire(import.meta.url)
			.resolve('phonemizer')
			.replace(/phonemizer\.cjs$/, 'phonemizer.js');
		await build({
			configFile: false,
			base: './',
			logLevel: 'error',
			plugins: [phonemizerRuntimePlugin()],
			build: {
				outDir: output,
				minify: 'oxc',
				lib: { entry, formats: ['es'], fileName: () => 'runtime.mjs' }
			}
		});
		const runtime = await import(
			/* @vite-ignore */ pathToFileURL(join(output, 'runtime.mjs')).href
		);
		const voices = await runtime.list_voices('en-us');
		expect(
			voices.some((voice: { languages: { name: string }[] }) =>
				voice.languages.some((language) => language.name === 'en-us')
			)
		).toBe(true);
		expect((await runtime.phonemize('Ready.', 'en-us')).join('')).not.toBe('');
	} finally {
		await rm(output, { recursive: true, force: true });
	}
}, 30000);
