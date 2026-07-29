import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { PluginOption } from 'vite';

const paraglidePlugin = paraglideVitePlugin({
	project: './project.inlang',
	outdir: './src/lib/paraglide'
}) as unknown as PluginOption;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	define: {
		'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE || 'web')
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		paraglidePlugin,
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
						urlPattern: ({ url }) => url.pathname.startsWith('/studio-models/'),
						handler: 'CacheFirst',
						options: {
							cacheName: 'openpost-studio-models-1.7.0',
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
				theme_color: '#9a4d2a',
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
		})
	],
	optimizeDeps: {
		include: [
			'lucide-svelte/icons/align-left',
			'lucide-svelte/icons/alert-circle',
			'lucide-svelte/icons/arrow-right',
			'lucide-svelte/icons/calendar-clock',
			'lucide-svelte/icons/check-circle-2',
			'lucide-svelte/icons/circle-alert',
			'lucide-svelte/icons/image-plus',
			'lucide-svelte/icons/images',
			'lucide-svelte/icons/link',
			'lucide-svelte/icons/list',
			'lucide-svelte/icons/loader-2',
			'lucide-svelte/icons/play',
			'lucide-svelte/icons/save',
			'lucide-svelte/icons/send',
			'lucide-svelte/icons/settings-2',
			'lucide-svelte/icons/smartphone',
			'lucide-svelte/icons/upload',
			'lucide-svelte/icons/video',
			'lucide-svelte/icons/x'
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
