import type { paths } from '@openpost/api-contract';
import { describe, expect, it, vi } from 'vitest';
import {
	adminQueryKeys,
	billingQueryKeys,
	featureQueryKeys,
	organizationQueryKeys,
	publicProfileQueryKeys,
	workspaceSettingsQueryKeys
} from '@openpost/query-catalog';
import { QueryClient } from '@tanstack/query-core';
import createClient from 'openapi-fetch';
import { createBillingQueryAPI, invalidateBillingDependencies } from './billing';

describe('billing query API', () => {
	it('forwards Workspace and cancellation dimensions', async () => {
		const requests: Request[] = [];
		const responses = [{ workspace_id: 'workspace-1' }, { client_token: 'token' }];
		let responseIndex = 0;
		const fetchMock = vi.fn(async (request: Request) => {
			requests.push(request);
			const response = responses[responseIndex];
			responseIndex += 1;
			return Response.json(response);
		});
		const api = createBillingQueryAPI(
			createClient<paths>({ baseUrl: 'https://openpost.test/api/v1', fetch: fetchMock })
		);
		const controller = new AbortController();

		await api.getBillingStatus('workspace-1', controller.signal);
		await api.getCheckoutConfig(controller.signal);

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/api/v1/billing/status',
			'/api/v1/billing/checkout/config'
		]);
		expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toEqual({
			workspace_id: 'workspace-1'
		});
		expect(requests.every((request) => !request.signal.aborted)).toBe(true);
		controller.abort();
		expect(requests.every((request) => request.signal.aborted)).toBe(true);
	});

	it('invalidates every plan-dependent view for the captured billing scope', async () => {
		const client = new QueryClient();
		const profileKey = publicProfileQueryKeys.detail('founder');
		const adminUsersKey = adminQueryKeys.usersRoot();
		const organizationAuditKey = organizationQueryKeys.auditRoot('organization-1');
		const instanceAuditKey = organizationQueryKeys.instanceAuditRoot();
		const billingKey = billingQueryKeys.status('workspace-1');
		const featureKey = featureQueryKeys.accountStates('workspace-1', ['account-1']);
		const setupKey = workspaceSettingsQueryKeys.setup('workspace-2');
		for (const queryKey of [
			profileKey,
			adminUsersKey,
			organizationAuditKey,
			instanceAuditKey,
			billingKey,
			featureKey,
			setupKey
		]) {
			client.setQueryData(queryKey, 'cached');
		}

		await invalidateBillingDependencies(client, {
			workspaceID: 'workspace-1',
			organizationID: 'organization-1'
		});

		expect(client.getQueryData(profileKey)).toBeUndefined();
		for (const queryKey of [
			adminUsersKey,
			organizationAuditKey,
			instanceAuditKey,
			billingKey,
			featureKey,
			setupKey
		]) {
			expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
		}
	});
});
