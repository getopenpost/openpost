import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SettingsInitialLoadParticipantHarness from './settings-initial-load-participant-harness.svelte';
import { SETTINGS_INITIAL_LOAD_PARTICIPANT } from './settings-initial-load.svelte';

describe('registerSettingsInitialLoad', () => {
	it('settles a participant whose load finishes after a scope mismatch', async () => {
		// First effect runs report pending=true from the stale scope marker. The load
		// state must stay tracked so the boundary settles once the load completes.
		const plan = {
			key: 'schedule:ws-1',
			participants: [SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule]
		} as const;
		const screen = render(SettingsInitialLoadParticipantHarness, { plan });
		const state = screen.getByTestId('settings-participant-loading');

		await expect.element(state).toHaveAttribute('data-loading', 'false');
	});
});
