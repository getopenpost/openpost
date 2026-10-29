import { pdfPreviewAssets } from '../../packages/social-preview/pdf-assets.ts';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { postHogSourceMaps } from '../../scripts/posthog-source-maps.ts';

// FMT-03 (#393): marketing ships no messages and bundles no paraglide runtime,
// so it must not own a generator for apps/web/src/lib/paraglide. Web's
// `generate:i18n` is the single writer; marketing only reads web's $lib
// components through svelte.config files.lib.
const sourceMaps = postHogSourceMaps('marketing');

export default defineConfig(({ isSsrBuild }) => ({
	plugins: [pdfPreviewAssets(), tailwindcss(), sveltekit(), ...sourceMaps.plugins],
	define: {
		'import.meta.env.VITE_OPENPOST_REVISION': JSON.stringify(
			process.env.VITE_OPENPOST_REVISION || process.env.CF_PAGES_COMMIT_SHA || ''
		)
	},
	build: {
		sourcemap: sourceMaps.enabled && !isSsrBuild ? 'hidden' : false
	},
	ssr: {
		noExternal: ['bits-ui']
	}
}));
