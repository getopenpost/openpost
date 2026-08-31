import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const runRealMusicModel = process.env.VITE_OPENPOST_REAL_MUSIC_TEST === '1';
const browserArgs = ['--enable-unsafe-webgpu'];
if (runRealMusicModel) browserArgs.push('--unlimited-storage');

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					// SvelteKit, media workers, codecs, and GPU suites share one Vite module
					// runner and Chromium process. Serial files so teardown cannot invalidate
					// the runner while a worker-backed media request is still settling.
					maxWorkers: 1,
					browser: {
						enabled: true,
						provider: playwright({
							launchOptions: {
								executablePath: chromiumExecutablePath,
								args: browserArgs
							}
						}),
						instances: [{ browser: 'chromium', headless: !runRealMusicModel }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
