import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import { postHogSourceMaps } from '../scripts/posthog-source-maps.ts';

const rawParaglidePlugin = paraglideVitePlugin({
	project: './project.inlang',
	outdir: './src/lib/paraglide'
});
// SAFETY: paraglideVitePlugin returns a Vite-compatible plugin, but its package type is not assignable to this Vite version.
const paraglidePlugin = rawParaglidePlugin as PluginOption;
const usesPrecompiledParaglide = process.env.OPENPOST_PARAGLIDE_PRECOMPILED === '1';
const isVitest = process.env.VITEST === 'true';
const apiProxyTimeoutMs = 120_000;
const sourceMaps = postHogSourceMaps('app');
const svelteKitPlugins = await sveltekit();
const appFrameworkPlugins = isVitest
	? svelteKitPlugins.filter((plugin) => plugin.name !== 'vite-plugin-sveltekit-compile')
	: svelteKitPlugins;
const testMediaStubPlugin: Plugin = {
	name: 'openpost-vitest-media-stub',
	configureServer(server) {
		// Browser component tests use deliberate fake media IDs. Settle them here
		// so they cannot fall through the production proxy into SvelteKit SSR.
		server.middlewares.use((request, response, next) => {
			if (!request.url?.startsWith('/media/')) return next();
			response.statusCode = 404;
			response.end();
		});
	}
};

export default defineConfig({
	publicDir: isVitest ? 'static' : undefined,
	define: {
		'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE || 'web')
	},
	plugins: [
		...(isVitest ? [testMediaStubPlugin] : []),
		tailwindcss(),
		...appFrameworkPlugins,
		...(!usesPrecompiledParaglide ? [paraglidePlugin] : []),
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			// F-007: SW must not cache dev builds. `devOptions.enabled` defaults
			// to false but we set it explicitly so a future plugin default change
			// cannot reintroduce the first-load race where a stale SW serves old
			// hashes while Vite is still compiling generated SvelteKit nodes.
			devOptions: { enabled: false },
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
		exclude: ['ai-music-js', 'kokoro-js', 'phonemizer'],
		include: [
			'@huggingface/transformers',
			'@lucide/svelte/icons/align-left',
			'@lucide/svelte/icons/alert-circle',
			'@lucide/svelte/icons/arrow-right',
			'@lucide/svelte/icons/camera',
			'@lucide/svelte/icons/calendar-clock',
			'@lucide/svelte/icons/check',
			'@lucide/svelte/icons/check-circle-2',
			'@lucide/svelte/icons/chevron-down',
			'@lucide/svelte/icons/chevron-right',
			'@lucide/svelte/icons/chevron-up',
			'@lucide/svelte/icons/circle-alert',
			'@lucide/svelte/icons/circle-off',
			'@lucide/svelte/icons/clipboard-paste',
			'@lucide/svelte/icons/columns-2',
			'@lucide/svelte/icons/copy',
			'@lucide/svelte/icons/diamond-minus',
			'@lucide/svelte/icons/eye',
			'@lucide/svelte/icons/external-link',
			'@lucide/svelte/icons/file-audio',
			'@lucide/svelte/icons/film',
			'@lucide/svelte/icons/folder',
			'@lucide/svelte/icons/folder-plus',
			'@lucide/svelte/icons/headphones',
			'@lucide/svelte/icons/image',
			'@lucide/svelte/icons/image-plus',
			'@lucide/svelte/icons/images',
			'@lucide/svelte/icons/laugh',
			'@lucide/svelte/icons/library',
			'@lucide/svelte/icons/layout-grid',
			'@lucide/svelte/icons/layers-3',
			'@lucide/svelte/icons/link',
			'@lucide/svelte/icons/list',
			'@lucide/svelte/icons/loader-2',
			'@lucide/svelte/icons/loader-circle',
			'@lucide/svelte/icons/mic',
			'@lucide/svelte/icons/minus',
			'@lucide/svelte/icons/more-horizontal',
			'@lucide/svelte/icons/palette',
			'@lucide/svelte/icons/pause',
			'@lucide/svelte/icons/pipette',
			'@lucide/svelte/icons/play',
			'@lucide/svelte/icons/plus',
			'@lucide/svelte/icons/refresh-cw',
			'@lucide/svelte/icons/save',
			'@lucide/svelte/icons/search',
			'@lucide/svelte/icons/search-x',
			'@lucide/svelte/icons/scissors',
			'@lucide/svelte/icons/send',
			'@lucide/svelte/icons/settings-2',
			'@lucide/svelte/icons/smartphone',
			'@lucide/svelte/icons/snowflake',
			'@lucide/svelte/icons/sparkles',
			'@lucide/svelte/icons/square',
			'@lucide/svelte/icons/upload',
			'@lucide/svelte/icons/ungroup',
			'@lucide/svelte/icons/trash-2',
			'@lucide/svelte/icons/triangle-alert',
			'@lucide/svelte/icons/video',
			'@lucide/svelte/icons/wand-sparkles',
			'@lucide/svelte/icons/x'
		]
	},
	server: {
		proxy: {
			'/api': {
				target: 'http://localhost:8080',
				changeOrigin: false,
				timeout: apiProxyTimeoutMs,
				proxyTimeout: apiProxyTimeoutMs
			},
			'^/media/[^/]+': {
				target: 'http://localhost:8080'
			}
		}
	},
	worker: {
		format: 'es'
	}
});
