import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
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
				optimizeDeps: {
					// Keep wrapper components and their mount helpers on the same Svelte runtime.
					exclude: ['@testing-library/svelte-core', 'vitest-browser-svelte'],
					include: ['html-to-image']
				},
				resolve: {
					// Browser tests assert computed font-family names, which resolve
					// from declarations without font files. Stub the ~30 bundled
					// families so each test file does not flood the Vite dev server
					// with thousands of woff2 requests. Production is unaffected.
					alias: [
						{
							find: /^@fontsource(-variable)?(\/.*)?$/,
							replacement: fileURLToPath(
								new URL('./src/lib/test-stubs/fontsource-stub.css', import.meta.url)
							)
						}
					]
				},
				test: {
					name: 'client',
					// SvelteKit, media workers, codecs, and GPU suites share one Vite module
					// runner and Chromium process. Serial files so teardown cannot invalidate
					// the runner while a worker-backed media request is still settling.
					maxWorkers: 1,
					browser: {
						enabled: true,
						// The interactive runner scales its iframe into a sidebar. Headless
						// fixtures need their actual viewport for layout and video playback.
						ui: runRealMusicModel,
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
