import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { billingQueryKeys } from '@openpost/query-catalog';
import { queryClient } from '$lib/query/client';
import { client } from '$lib/api/client';
import { workspaceCtx } from '$lib/stores/workspace.svelte';
import BillingSettingsTab from './BillingSettingsTab.svelte';
import SettingsLoadTestBoundary from '$lib/settings-load-test-boundary.svelte';
import { getSettingsInitialLoadPlan } from '$lib/settings-initial-load.svelte';

function renderBilling() {
	return render(
		BillingSettingsTab,
		{},
		{
			wrapper: SettingsLoadTestBoundary,
			wrapperProps: {
				plan: getSettingsInitialLoadPlan('plan', {
					userID: 'user-a',
					workspaceID: 'workspace-a',
					organizationID: 'organization-1'
				})
			}
		}
	);
}

const getMock = vi.spyOn(client, 'GET');
const status = {
	workspace_id: 'workspace-a',
	organization_id: 'organization-1',
	provider: 'none',
	status: 'active',
	plan_id: 'pro',
	can_manage_billing: false,
	access_restricted: false,
	cancel_at_period_end: false,
	limits: {},
	usage: {},
	provider_costs: []
};

beforeEach(() => {
	queryClient.clear();
	workspaceCtx.currentWorkspace = {
		id: 'workspace-a',
		organization_id: 'organization-1',
		organization_name: 'Organization',
		name: 'Workspace',
		avatar_url: '',
		color: '',
		can_edit: true,
		role: 'admin',
		created_at: '',
		sso_authenticated: true,
		sso_identity_linked: true,
		sso_required: false
	};
	getMock.mockReset();
	// SAFETY: This component only reads the billing status fixture.
	getMock.mockResolvedValue({ data: status, response: new Response() } as never);
});

it('reveals Plan & usage when navigation reuses cached billing data', async () => {
	queryClient.setQueryData(billingQueryKeys.status('workspace-a'), status);
	const screen = await renderBilling();
	await expect.element(screen.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
	expect(screen.container.querySelector('[data-slot="page-content"]')).toHaveAttribute(
		'aria-busy',
		'false'
	);
	expect(getMock).not.toHaveBeenCalled();
});

it('shows the delayed loader for a cold read and clears it when billing arrives', async () => {
	type BillingResponse = { data: typeof status; response: Response };
	let complete!: (value: BillingResponse) => void;
	// SAFETY: The deferred request resolves below with the same billing status response.
	getMock.mockReturnValue(
		new Promise<BillingResponse>((resolve) => {
			complete = resolve;
		}) as never
	);
	const screen = await renderBilling();
	await expect.element(screen.getByRole('status')).toBeVisible();
	complete({ data: status, response: new Response() });
	await expect.element(screen.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
	expect(screen.container.querySelector('[data-slot="page-content"]')).toHaveAttribute(
		'aria-busy',
		'false'
	);
});

it('keeps cached billing visible and reports a failed background refresh', async () => {
	queryClient.setQueryData(billingQueryKeys.status('workspace-a'), status);
	const screen = await renderBilling();
	// SAFETY: Billing refresh receives an API error envelope without success data.
	getMock.mockResolvedValue({
		error: { detail: 'Billing unavailable' },
		response: new Response(null, { status: 400 })
	} as never);
	await queryClient.invalidateQueries({ queryKey: billingQueryKeys.status('workspace-a') });
	await expect.element(screen.getByText('Billing unavailable')).toBeVisible();
	await expect.element(screen.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
	expect(screen.container.querySelector('[data-slot="page-content"]')).toHaveAttribute(
		'aria-busy',
		'false'
	);
});
