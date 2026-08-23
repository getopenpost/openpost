import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SettingsNavigation from './settings-navigation.svelte';

describe('SettingsNavigation', () => {
	it('plays one tab cue for each desktop settings destination', async () => {
		const screen = render(SettingsNavigation, { active: 'profile' });
		const navigation = screen.getByTestId('settings-navigation');
		const destinations = navigation.getByRole('link');

		await expect.element(destinations.first()).toHaveAttribute('data-cuelume-toggle', 'toggle');
		for (const destination of await destinations.all()) {
			await expect.element(destination).toHaveAttribute('data-cuelume-toggle', 'toggle');
		}
	});

	it('shows one section at a time without a second sidebar or search box', async () => {
		const screen = render(SettingsNavigation, { active: 'general' });
		const navigation = screen.getByTestId('settings-navigation');

		await expect
			.element(navigation.getByRole('navigation', { name: 'Settings sections' }))
			.toBeVisible();
		await expect
			.element(navigation.getByRole('link', { name: 'General', exact: true }))
			.toBeVisible();
		await expect
			.element(navigation.getByRole('link', { name: 'Voice profiles', exact: true }))
			.toHaveAttribute('href', '/settings?tab=voices');
		expect(await navigation.getByRole('link', { name: 'Profile', exact: true }).all()).toHaveLength(
			0
		);
		expect(await navigation.getByRole('textbox').all()).toHaveLength(0);
	});
});
