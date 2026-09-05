import { beforeEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { client } from '$lib/api/client';
import { queryClient } from '$lib/query/client';
import SettingsLoadTestBoundary from '$lib/settings-load-test-boundary.svelte';
import { getSettingsInitialLoadPlan } from '$lib/settings-initial-load.svelte';
import OrganizationAuditSettings from './organization-audit-settings.svelte';

const getMock = vi.spyOn(client, 'GET');
beforeEach(() => {
	queryClient.clear();
	getMock.mockReset();
	getMock.mockImplementation(
		async (path) =>
			// SAFETY: The component reads an organization list and empty audit page from these routes.
			({
				data:
					path === '/organizations'
						? [{ id: 'org-alpha', name: 'Alpha', role: 'owner' }]
						: { items: [], next_cursor: '' },
				response: new Response()
			}) as never
	);
});

it.each([true, false])('settles the audit settings boundary, instance=%s', async (instanceWide) => {
	const screen = await render(
		OrganizationAuditSettings,
		{ organizationID: 'org-alpha', active: true, instanceWide },
		{
			wrapper: SettingsLoadTestBoundary,
			wrapperProps: {
				plan: getSettingsInitialLoadPlan(instanceWide ? 'instance-audit' : 'audit', {
					userID: 'owner',
					workspaceID: 'workspace-a',
					organizationID: 'org-alpha'
				})
			}
		}
	);
	await expect
		.element(
			screen.getByTestId(instanceWide ? 'instance-audit-settings' : 'organization-audit-settings')
		)
		.toBeVisible();
	expect(screen.container.querySelector('[data-slot="page-content"]')).toHaveAttribute(
		'aria-busy',
		'false'
	);
});
