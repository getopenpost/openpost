import { describe, expect, it, vi } from 'vitest';
import {
	adminQueryKeys,
	billingQueryKeys,
	featureQueryKeys,
	organizationQueryKeys,
	publicProfileQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { createBillingQueryAPI, invalidateBillingDependencies } from './billing';

describe('billing query API', () => {
	it('forwards Workspace and cancellation dimensions', async () => {
		const GET = vi
			.fn()
			.mockResolvedValueOnce({
				data: { workspace_id: 'workspace-1' },
				response: new Response(null, { status: 200 })
			})
			.mockResolvedValueOnce({
				data: { client_token: 'token' },
				response: new Response(null, { status: 200 })
			});
		const api = createBillingQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await api.getBillingStatus('workspace-1', signal);
		await api.getCheckoutConfig(signal);

		expect(GET).toHaveBeenNthCalledWith(1, '/billing/status', {
			params: { query: { workspace_id: 'workspace-1' } },
			signal
		});
		expect(GET).toHaveBeenNthCalledWith(2, '/billing/checkout/config', {
			signal
		});
	});

	it('invalidates every plan-dependent view for the captured billing scope', async () => {
		const invalidateQueries = vi.fn().mockResolvedValue(undefined);
		const removeQueries = vi.fn();

		await invalidateBillingDependencies({ invalidateQueries, removeQueries } as never, {
			workspaceID: 'workspace-1',
			organizationID: 'organization-1'
		});

		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: publicProfileQueryKeys.all()
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: adminQueryKeys.usersRoot()
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.auditRoot('organization-1')
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.instanceAuditRoot()
		});
		const billingInvalidation = invalidateQueries.mock.calls.find(
			([filters]) =>
				typeof filters.predicate === 'function' &&
				filters.predicate({ queryKey: billingQueryKeys.status('workspace-1') })
		)?.[0];
		expect(
			billingInvalidation?.predicate({
				queryKey: billingQueryKeys.status('workspace-1')
			})
		).toBe(true);
		const featureInvalidation = invalidateQueries.mock.calls.find(
			([filters]) =>
				typeof filters.predicate === 'function' &&
				filters.predicate({
					queryKey: featureQueryKeys.accountStates('workspace-1', [])
				})
		)?.[0];
		expect(featureInvalidation).toBeDefined();
		const setupInvalidation = invalidateQueries.mock.calls.find(
			([filters]) =>
				typeof filters.predicate === 'function' &&
				filters.predicate({
					queryKey: workspaceSettingsQueryKeys.setup('workspace-2')
				})
		)?.[0];
		expect(setupInvalidation).toBeDefined();
	});
});
