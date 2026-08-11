import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { PluginOption } from 'vite';
import { postHogSourceMaps } from '../scripts/posthog-source-maps';

const paraglidePlugin = paraglideVitePlugin({
	project: './project.inlang',
	outdir: './src/lib/paraglide'
}) as unknown as PluginOption;
const usesPrecompiledParaglide = process.env.OPENPOST_PARAGLIDE_PRECOMPILED === '1';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const sourceMaps = postHogSourceMaps('app');

export default defineConfig({
	define: {
		'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE || 'web')
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		...(!usesPrecompiledParaglide ? [paraglidePlugin] : []),
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			workbox: {
				globPatterns: [],
				navigateFallback: null,
				runtimeCaching: [
					{
						urlPattern: ({ request }) => request.mode === 'navigate',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'openpost-pages-1',
							networkTimeoutSeconds: 3,
							expiration: {
								maxEntries: 32,
								maxAgeSeconds: 7 * 24 * 60 * 60
							},
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						urlPattern: ({ url }) => url.pathname.startsWith('/_app/immutable/'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'openpost-app-assets-1',
							expiration: {
								maxEntries: 400,
								maxAgeSeconds: 30 * 24 * 60 * 60
							},
							cacheableResponse: { statuses: [0, 200] }
						}
					},
					{
						urlPattern: ({ url }) => url.pathname.startsWith('/image-editor-models/'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'openpost-image-editor-models-1.7.0',
							expiration: {
								maxEntries: 32,
								maxAgeSeconds: 365 * 24 * 60 * 60
							},
							cacheableResponse: { statuses: [0, 200] }
						}
					}
				]
			},
			manifest: {
				name: 'OpenPost',
				short_name: 'OpenPost',
				description: 'Schedule and publish content across multiple social platforms.',
				theme_color: '#b74c05',
				background_color: '#faf9f7',
				display: 'standalone',
				start_url: '/',
				icons: [
					{
						src: '/assets/brand/icon.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'any maskable'
					}
				]
			}
		}),
		...sourceMaps.plugins
	],
	build: {
		sourcemap: sourceMaps.enabled ? 'hidden' : false
	},
	optimizeDeps: {
		include: [
			'@lucide/svelte/icons/align-left',
			'@lucide/svelte/icons/alert-circle',
			'@lucide/svelte/icons/arrow-right',
			'@lucide/svelte/icons/camera',
			'@lucide/svelte/icons/calendar-clock',
			'@lucide/svelte/icons/check',
			'@lucide/svelte/icons/check-circle-2',
			'@lucide/svelte/icons/circle-alert',
			'@lucide/svelte/icons/external-link',
			'@lucide/svelte/icons/file-audio',
			'@lucide/svelte/icons/image',
			'@lucide/svelte/icons/image-plus',
			'@lucide/svelte/icons/images',
			'@lucide/svelte/icons/laugh',
			'@lucide/svelte/icons/library',
			'@lucide/svelte/icons/link',
			'@lucide/svelte/icons/list',
			'@lucide/svelte/icons/loader-2',
			'@lucide/svelte/icons/palette',
			'@lucide/svelte/icons/play',
			'@lucide/svelte/icons/refresh-cw',
			'@lucide/svelte/icons/save',
			'@lucide/svelte/icons/search',
			'@lucide/svelte/icons/search-x',
			'@lucide/svelte/icons/send',
			'@lucide/svelte/icons/settings-2',
			'@lucide/svelte/icons/smartphone',
			'@lucide/svelte/icons/sparkles',
			'@lucide/svelte/icons/upload',
			'@lucide/svelte/icons/video',
			'@lucide/svelte/icons/wand-sparkles',
			'@lucide/svelte/icons/x'
		]
	},
	server: {
		proxy: {
			'/api': 'http://localhost:8080',
			'^/media/[^/]+': {
				target: 'http://localhost:8080'
			}
		}
	},
	worker: {
		format: 'es'
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright({
							launchOptions: chromiumExecutablePath
								? { executablePath: chromiumExecutablePath }
								: undefined
						}),
						instances: [{ browser: 'chromium', headless: true }]
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
