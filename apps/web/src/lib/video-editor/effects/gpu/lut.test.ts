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
		const decoded = decodeLutData(stored.data);
		expect(decoded).toHaveLength(33 * 33 * 33 * 4);
		expect([...decoded.slice(0, 4)]).toEqual([0, 0, 0, 255]);
		expect([...decoded.slice(32 * 4, 33 * 4)]).toEqual([255, 0, 0, 255]);
		expect([...decoded.slice(-4)]).toEqual([255, 255, 255, 255]);
	});
});
