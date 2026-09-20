import type { Plugin } from 'vite';

const PHONEMIZER_MODULE_SUFFIX = '/node_modules/phonemizer/dist/phonemizer.js';
const EAGER_VOICE_SNAPSHOT = 'oe=ne.then((A=>{const e=A.list_voices().map(';
const WAIT_FOR_VOICE_DATA =
	'oe=ne.then((async A=>{let e=[];for(let g=0;g<1000&&0===(e=A.list_voices()).length;g++)await new Promise((A=>setTimeout(A,10)));e=e.map(';

export function waitForPhonemizerVoiceData(code: string): string {
	if (!code.includes(EAGER_VOICE_SNAPSHOT)) {
		throw new Error('The pinned phonemizer voice bootstrap changed; update its data-race repair.');
	}
	return code.replace(EAGER_VOICE_SNAPSHOT, WAIT_FOR_VOICE_DATA);
}

/**
 * phonemizer 1.2.1 can initialize eSpeak WASM before its embedded voice data
 * finishes decompressing. It then caches an empty voice set for the page.
 * Keep this narrow transform until the pinned dependency ships the same wait.
 */
export function phonemizerDataRacePlugin(): Plugin {
	return {
		name: 'openpost-phonemizer-data-race',
		enforce: 'pre',
		transform(code, id) {
			const modulePath = id.split('?', 1)[0]?.replaceAll('\\', '/');
			if (!modulePath?.endsWith(PHONEMIZER_MODULE_SUFFIX)) return null;
			return { code: waitForPhonemizerVoiceData(code), map: null };
		}
	};
}
