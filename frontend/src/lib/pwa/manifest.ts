import type { ManifestOptions } from 'vite-plugin-pwa';

export const appManifest = {
	id: '/',
	scope: '/',
	name: 'OpenPost',
	short_name: 'OpenPost',
	description: 'Schedule and publish content across multiple social platforms.',
	theme_color: '#b74c05',
	background_color: '#faf9f7',
	display: 'standalone',
	start_url: '/',
	icons: [
		{
			src: '/assets/brand/pwa-192.png',
			sizes: '192x192',
			type: 'image/png',
			purpose: 'any'
		},
		{
			src: '/assets/brand/pwa-512.png',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'any'
		},
		{
			src: '/assets/brand/pwa-maskable-512.png',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'maskable'
		},
		{
			src: '/assets/brand/icon.svg',
			sizes: 'any',
			type: 'image/svg+xml',
			purpose: 'any'
		}
	]
} satisfies Partial<ManifestOptions>;
