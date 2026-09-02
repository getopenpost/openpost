import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CommunicationsNavigation from './communications-navigation.svelte';

describe('CommunicationsNavigation', () => {
	it('gives each route tab one state-change cue', async () => {
		const screen = render(CommunicationsNavigation, { active: 'engagement' });
		const navigation = screen.getByTestId('communications-navigation');
		const tabs = navigation.getByRole('link');

		for (const tab of await tabs.all()) {
			await expect.element(tab).toHaveAttribute('data-cuelume-toggle', 'toggle');
		}
		const icons = navigation.element().querySelectorAll('[data-theme-icon]');
		expect(Array.from(icons, (icon) => icon.getAttribute('data-theme-icon'))).toEqual([
			'communications',
			'mail',
			'notification'
		]);
	});
});
