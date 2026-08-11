import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';

const paraglidePlugin = paraglideVitePlugin({
	project: '../frontend/project.inlang',
	outdir: '../frontend/src/lib/paraglide'
}) as unknown as PluginOption;

// svelte-check for this project also type-checks ../frontend/src/lib/posthog-capture.ts, whose
// $env/static/public import throws a build-time error if these keys are absent entirely (not
// just falsy). Give it an empty default; real values still take precedence when set.
process.env.PUBLIC_POSTHOG_PROJECT_TOKEN ??= '';
process.env.PUBLIC_POSTHOG_HOST ??= '';

export default defineConfig({
	plugins: [tailwindcss(), paraglidePlugin, sveltekit()],
	ssr: {
		noExternal: ['bits-ui']
	}
});
