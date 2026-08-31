import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LegacyDomainNotice from './legacy-domain-notice.svelte';

describe('LegacyDomainNotice', () => {
	it('offers the equivalent path on the new Hosted origin', async () => {
		const screen = await render(LegacyDomainNotice, {
			url: new URL('https://app.openpost.social/calendar?view=week#scheduled')
		});

		const link = screen.getByRole('link', { name: 'Open app.openpo.st' });
		await expect
			.element(link)
			.toHaveAttribute('href', 'https://app.openpo.st/calendar?view=week#scheduled');
	});

	it('stays hidden on the canonical and self-hosted origins', async () => {
		for (const origin of ['https://app.openpo.st', 'https://social.example.com']) {
			const screen = await render(LegacyDomainNotice, { url: new URL(origin) });
			await expect.element(screen.container).not.toHaveTextContent('OpenPost has moved');
			screen.unmount();
		}
	});
});
