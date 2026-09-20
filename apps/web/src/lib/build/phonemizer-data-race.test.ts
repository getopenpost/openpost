import { describe, expect, it } from 'vitest';
import { waitForPhonemizerVoiceData } from './phonemizer-data-race';

describe('phonemizer voice data race repair', () => {
	it('waits for embedded voices before caching the filtered catalogue', () => {
		const source = 'before;oe=ne.then((A=>{const e=A.list_voices().map(after';

		const transformed = waitForPhonemizerVoiceData(source);

		expect(transformed).toContain('1000&&0===(e=A.list_voices()).length');
		expect(transformed).toContain('e=e.map(after');
	});

	it('fails closed when an upstream upgrade changes the bootstrap', () => {
		expect(() => waitForPhonemizerVoiceData('changed upstream')).toThrow(
			/pinned phonemizer voice bootstrap changed/
		);
	});
});
