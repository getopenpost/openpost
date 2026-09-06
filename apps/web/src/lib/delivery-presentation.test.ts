import { describe, expect, it } from 'vitest';
import { deliveryRecoveryAction } from './delivery-presentation';

describe('delivery recovery presentation', () => {
	it('offers retry only for the current failed Rendition', () => {
		expect(deliveryRecoveryAction({ recovery_action: 'retry' }, 'failed')).toBe('retry');
		expect(deliveryRecoveryAction({ recovery_action: 'retry' }, 'scheduled')).toBe('none');
	});

	it('never turns reconciliation or manual review into a replay', () => {
		expect(deliveryRecoveryAction({ recovery_action: 'reconcile' }, 'publishing')).toBe(
			'reconcile'
		);
		expect(deliveryRecoveryAction({ recovery_action: 'manual_resolution' }, 'failed')).toBe(
			'manual_resolution'
		);
	});
});
