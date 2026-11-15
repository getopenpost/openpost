import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ComposerValidationMenu from './composer-validation-menu.svelte';

it('explains publishing blockers on the trigger and opens the affected field', async () => {
	const issue = {
		id: 'missing-media',
		severity: 'error' as const,
		message: 'Add an image for this destination.',
		field: 'media'
	};
	const onSelect = vi.fn();
	const screen = await render(ComposerValidationMenu, { issues: [issue], onSelect });
	const trigger = screen.getByRole('button', { name: /Check before publishing/ });
	await expect.element(trigger).toHaveTextContent('Issues to review: 1');
	await trigger.click();
	await page.getByRole('button', { name: 'Edit: Add an image for this destination.' }).click();
	expect(onSelect).toHaveBeenCalledWith(issue);
});

it('offers AI shortening only for character-limit issues', async () => {
	const limitIssue = {
		id: 'x-limit',
		severity: 'error' as const,
		code: 'text_too_long',
		message: 'Text is over the 280 character limit',
		field: 'body'
	};
	const mediaIssue = {
		id: 'missing-media',
		severity: 'error' as const,
		code: 'media_required',
		message: 'Add an image for this destination.'
	};
	const onShorten = vi.fn();
	const screen = await render(ComposerValidationMenu, {
		issues: [limitIssue, mediaIssue],
		onShorten
	});
	await screen.getByRole('button', { name: /Check before publishing/ }).click();
	const buttons = page.getByRole('button', { name: 'Shorten with AI' });
	await expect.element(buttons).toBeVisible();
	expect(buttons.elements()).toHaveLength(1);
	await buttons.click();
	expect(onShorten).toHaveBeenCalledWith(limitIssue);
});
