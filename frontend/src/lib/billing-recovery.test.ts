import { describe, expect, it } from 'vitest';
import {
	billingPortalBody,
	parseBillingRecoveryStatus,
	requiresBillingRecovery
} from './billing-recovery';

function status(providerStatus: string, accessRestricted: boolean) {
	return {
		workspace_id: 'workspace-1',
		status: providerStatus,
		can_manage_billing: true,
		access_restricted: accessRestricted
	};
}

describe('billing recovery', () => {
	it('requires canonical past-due status and restricted access', () => {
		expect(requiresBillingRecovery(status('past_due', true))).toBe(true);
		expect(requiresBillingRecovery(status('PAST_DUE', true))).toBe(true);
		expect(requiresBillingRecovery(status('active', false))).toBe(false);
		expect(requiresBillingRecovery(status('past_due', false))).toBe(false);
		expect(requiresBillingRecovery(undefined)).toBe(false);
	});

	it('builds the exact one-action payment recovery request', () => {
		expect(billingPortalBody('workspace-1', 'update_payment_method')).toEqual({
			workspace_id: 'workspace-1',
			purpose: 'update_payment_method'
		});
		expect(billingPortalBody('workspace-1')).toEqual({
			workspace_id: 'workspace-1',
			purpose: 'manage'
		});
	});

	it('accepts only a complete workspace-scoped recovery status', () => {
		expect(parseBillingRecoveryStatus(status('past_due', true))).toEqual(status('past_due', true));
		expect(
			parseBillingRecoveryStatus({ ...status('past_due', true), workspace_id: '' })
		).toBeNull();
		expect(
			parseBillingRecoveryStatus({
				...status('past_due', true),
				can_manage_billing: 'yes'
			})
		).toBeNull();
		expect(parseBillingRecoveryStatus(null)).toBeNull();
	});
});
