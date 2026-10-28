import { defineBrowserCommand, playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import type { CDPSession, Page } from 'playwright';
import { defineConfig } from 'vitest/config';
import { paraglideTestMaps } from './scripts/paraglide-test-maps.mjs';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const runRealMusicModel = process.env.VITE_OPENPOST_REAL_MUSIC_TEST === '1';
// Use Chromium's supported GPU backends. Forcing experimental WebGPU on a
// software-only runner can lose unrelated Canvas2D and WebGL contexts.
const browserArgs: string[] = [];
const deviceScaleSessions = new WeakMap<Page, CDPSession>();
const browserTestFiles = ['src/**/*.svelte.{test,spec}.{js,ts}'];
const componentTestSuite = process.env.OPENPOST_COMPONENT_TEST_SUITE;
const generatedTestMaps = paraglideTestMaps(fileURLToPath(new URL('../..', import.meta.url)));
if (runRealMusicModel) browserArgs.push('--unlimited-storage');

export default defineConfig({
	test: {
		expect: { requireAssertions: true },
		reporters: ['default', generatedTestMaps.reporter],
		projects: [
			{
				extends: './vite.config.ts',
				plugins: [generatedTestMaps.plugin],
				optimizeDeps: {
					// Scan the linked UI output before mounting tests, avoiding optimizer reloads.
					entries: [...browserTestFiles, '../../packages/ui/dist/**/*.{js,svelte}'],
					// Keep wrapper components and their mount helpers on the same Svelte runtime.
					exclude: ['@testing-library/svelte-core', 'vitest-browser-svelte'],
					// Worker-loaded GIF encoding must not trigger a mid-test optimizer reload.
					include: ['gifenc', 'html-to-image']
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
						commands: {
							setDeviceScaleFactor: defineBrowserCommand(async ({ page }, scale: number | null) => {
								let session = deviceScaleSessions.get(page);
								if (scale === null) {
									await session?.detach();
									deviceScaleSessions.delete(page);
									return;
								}
								if (!session) {
									session = await page.context().newCDPSession(page);
									deviceScaleSessions.set(page, session);
								}
								await session.send('Emulation.setDeviceMetricsOverride', {
									...page.viewportSize(),
									deviceScaleFactor: scale,
									mobile: false
								});
								// CDP metrics alone do not notify resolution MediaQueryList listeners.
								await session.send('Emulation.setEmulatedMedia', { media: 'screen' });
								await session.send('Emulation.setEmulatedMedia', { media: '' });
							}),
							dragPointer: defineBrowserCommand(
								async (
									{ page, iframe },
									selector: string,
									dx: number,
									dy: number,
									options?: { cancel?: boolean }
								) => {
									const bounds = await iframe.locator(selector).boundingBox();
									if (!bounds) throw new Error('Pointer drag target is not visible');
									const x = bounds.x + bounds.width / 2;
									const y = bounds.y + bounds.height / 2;
									await page.mouse.move(x, y);
									await page.mouse.down();
									try {
										await page.mouse.move(x + dx, y + dy, { steps: 8 });
										if (options?.cancel) await page.keyboard.press('Escape');
									} finally {
										await page.mouse.up();
									}
								}
							)
						},
						// The interactive runner scales its iframe into a sidebar. Headless
						// fixtures need their actual viewport for layout and video playback.
						ui: runRealMusicModel,
						provider: playwright({
							launchOptions: {
								channel: chromiumExecutablePath ? undefined : 'chromium',
								executablePath: chromiumExecutablePath,
								args: browserArgs
							}
						}),
						instances: [{ browser: 'chromium', headless: !runRealMusicModel }]
					},
					include:
						componentTestSuite === 'routes'
							? ['src/routes/**/*.svelte.{test,spec}.{js,ts}']
							: browserTestFiles,
					exclude: [
						'src/lib/server/**',
						...(componentTestSuite === 'components' ? ['src/routes/**'] : [])
					]
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// Local app imports are large. More forks can exhaust laptop memory
					// and spend more time swapping than running assertions.
					maxWorkers: process.env.CI ? undefined : 2,
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
