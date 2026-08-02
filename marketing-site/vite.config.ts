import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';

const paraglidePlugin = paraglideVitePlugin({
	project: '../frontend/project.inlang',
	outdir: '../frontend/src/lib/paraglide'
}) as unknown as PluginOption;

export default defineConfig({
	plugins: [tailwindcss(), paraglidePlugin, sveltekit()]
});
