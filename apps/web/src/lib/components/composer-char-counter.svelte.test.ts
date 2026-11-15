import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ComposerCharCounter from './composer-char-counter.svelte';

const limits = [{ platform: 'Bluesky', key: 'bluesky', limit: 10 }];

it('offers AI shortening on hover only when the text is over a limit', async () => {
	const onShorten = vi.fn();
	const screen = await render(ComposerCharCounter, {
		content: 'This text is far too long',
		limits,
		onShorten
	});
	await userEvent.hover(screen.getByText('25/10'));
	await page.getByRole('button', { name: 'Shorten with AI' }).click();
	expect(onShorten).toHaveBeenCalledWith(limits[0]);
});

it('hides AI shortening while the text fits', async () => {
	const screen = await render(ComposerCharCounter, {
		content: 'Short',
		limits,
		onShorten: vi.fn()
	});
	await userEvent.hover(screen.getByText('5/10'));
	await expect.element(page.getByText('Character limits')).toBeVisible();
	expect(page.getByRole('button', { name: 'Shorten with AI' }).elements()).toHaveLength(0);
});
