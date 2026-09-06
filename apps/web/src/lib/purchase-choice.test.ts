import { describe, expect, it } from 'vitest';

import { purchaseChoiceErrorCode } from './purchase-choice';

describe('purchase choice API errors', () => {
	it('uses the stable problem type instead of localized detail text', () => {
		expect(
			purchaseChoiceErrorCode({
				type: 'urn:openpost:problem:purchase-choice:expired',
				detail: 'La selección ya no está disponible.'
			})
		).toBe('expired');
		expect(
			purchaseChoiceErrorCode({
				type: 'urn:openpost:problem:purchase-choice:mismatch',
				detail: 'Copy can change without changing behavior.'
			})
		).toBe('mismatch');
	});

	it('fails closed for unknown or absent problem types', () => {
		expect(purchaseChoiceErrorCode({ detail: 'purchase choice has expired' })).toBe('unavailable');
		expect(
			purchaseChoiceErrorCode({
				type: 'urn:openpost:problem:purchase-choice:new-case',
				detail: 'A future case'
			})
		).toBe('unavailable');
	});
});
