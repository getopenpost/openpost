import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../routes/layout.css';
import { instanceSettingsQueryOptions, providerAppsQueryOptions } from '@openpost/query-catalog';
import { adminQueryAPI } from '$lib/query/admin';
import { queryClient } from '$lib/query/client';
import InstanceConfiguration from './instance-configuration.svelte';

afterEach(() => {
	queryClient.clear();
});

it('exposes the configuration section switcher as a named group', async () => {
	queryClient.setQueryData(instanceSettingsQueryOptions(adminQueryAPI).queryKey, {
		settings: []
	});
	queryClient.setQueryData(providerAppsQueryOptions(adminQueryAPI).queryKey, []);
	const screen = await render(InstanceConfiguration, { active: true });

	const group = screen.getByRole('group', { name: 'Configuration sections' });
	await expect.element(group).toBeVisible();
	await expect.element(group.getByRole('button', { name: 'Accounts' })).toBeVisible();
});
