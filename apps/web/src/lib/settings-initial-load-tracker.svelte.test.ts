import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SettingsInitialLoadTestHarness from './settings-initial-load-test-harness.svelte';
import { SETTINGS_INITIAL_LOAD_PARTICIPANT } from './settings-initial-load.svelte';

describe('registerSettingsInitialLoad', () => {
	it('re-registers a mounted participant when its tab scope resets', async () => {
		const workspaceA = {
			key: 'schedule:workspace-a',
			participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
		} as const;
		const screen = await render(SettingsInitialLoadTestHarness, {
			plan: workspaceA,
			pending: false
		});
		const state = screen.getByTestId('settings-initial-loading');

		await expect.element(state).toHaveAttribute('data-loading', 'false');

		await screen.rerender({
			plan: {
				key: 'schedule:workspace-b',
				participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
			},
			pending: false
		});
		await expect.element(state).toHaveAttribute('data-loading', 'false');

		await screen.rerender({
			plan: {
				key: 'schedule:workspace-c',
				participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
			},
			pending: true
		});
		await expect.element(state).toHaveAttribute('data-loading', 'true');

		await screen.rerender({
			plan: {
				key: 'schedule:workspace-c',
				participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
			},
			pending: false
		});
		await expect.element(state).toHaveAttribute('data-pending', 'false');
		await expect.element(state).toHaveAttribute('data-loading', 'false');
	});
});
