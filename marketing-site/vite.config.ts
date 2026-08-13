import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';
import { postHogSourceMaps } from '../scripts/posthog-source-maps';

const paraglidePlugin = paraglideVitePlugin({
	project: '../frontend/project.inlang',
	outdir: '../frontend/src/lib/paraglide'
}) as unknown as PluginOption;
const sourceMaps = postHogSourceMaps('marketing');

export default defineConfig({
	plugins: [tailwindcss(), paraglidePlugin, sveltekit(), ...sourceMaps.plugins],
	build: {
		sourcemap: sourceMaps.enabled ? 'hidden' : false
	},
	ssr: {
		noExternal: ['bits-ui']
	}
});
