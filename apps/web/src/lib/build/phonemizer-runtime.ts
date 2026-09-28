import type { Plugin } from 'vite';

const PHONEMIZER_MODULE_SUFFIX = '/node_modules/phonemizer/dist/phonemizer.js';

/** Preserve Emscripten initialization side effects that the production optimizer removes. */
export function phonemizerRuntimePlugin(): Plugin {
	return {
		name: 'openpost-phonemizer-runtime',
		apply: 'build',
		enforce: 'pre',
		transform(code, id) {
			if (!id.replaceAll('\\', '/').endsWith(PHONEMIZER_MODULE_SUFFIX)) return null;
			const reference = this.emitFile({
				type: 'asset',
				name: 'phonemizer-runtime.mjs',
				source: code
			});
			return {
				code: `
    const runtime = import(/* @vite-ignore */ import.meta.ROLLUP_FILE_URL_${reference});
    export async function list_voices(...args) { return (await runtime).list_voices(...args); }
    export async function phonemize(...args) { return (await runtime).phonemize(...args); }
   `,
				map: null
			};
		}
	};
}
