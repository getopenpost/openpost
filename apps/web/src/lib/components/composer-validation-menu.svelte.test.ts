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

it('does not show a publishing warning when there are no issues', async () => {
	const screen = await render(ComposerValidationMenu, { issues: [] });
	await expect
		.element(screen.getByRole('button', { name: /Check before publishing/ }))
		.not.toBeInTheDocument();
});
