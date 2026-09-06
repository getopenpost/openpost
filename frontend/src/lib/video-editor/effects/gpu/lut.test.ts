import { describe, expect, it } from 'vitest';
import {
	createIdentityLutData,
	decodeLutData,
	packCubeLutForStorage,
	type ParsedCubeLut
} from './lut';

describe('LUT project storage', () => {
	it('resamples large imports to a bounded 33 cubed payload', () => {
		const imported: ParsedCubeLut = {
			title: 'Large identity',
			size: 65,
			data: createIdentityLutData(65)
		};

		const stored = packCubeLutForStorage(imported);

		expect(stored.size).toBe(33);
		expect(decodeLutData(stored.data)).toHaveLength(33 * 33 * 33 * 4);
	});
});
