import { pdfPreviewAssets } from '../../packages/social-preview/pdf-assets.ts';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';
import { postHogSourceMaps } from '../../scripts/posthog-source-maps.ts';

const rawParaglidePlugin = paraglideVitePlugin({
	project: '../web/project.inlang',
	outdir: '../web/src/lib/paraglide'
});
// SAFETY: paraglideVitePlugin returns a Vite-compatible plugin, but its package type is not assignable to this Vite version.
const paraglidePlugin = rawParaglidePlugin as PluginOption;
const sourceMaps = postHogSourceMaps('marketing');

export default defineConfig({
	plugins: [pdfPreviewAssets(), tailwindcss(), paraglidePlugin, sveltekit(), ...sourceMaps.plugins],
	define: {
		'import.meta.env.VITE_OPENPOST_REVISION': JSON.stringify(
			process.env.VITE_OPENPOST_REVISION || process.env.CF_PAGES_COMMIT_SHA || ''
		)
	},
	build: {
		sourcemap: sourceMaps.enabled ? 'hidden' : false
	},
	ssr: {
		noExternal: ['bits-ui']
	}
});
