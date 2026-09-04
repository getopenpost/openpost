import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Button from './button.svelte';

function textSnippet(text: string) {
	return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));
}

describe('Button', () => {
	it('exposes stable semantic intents without leaking visual variants to callers', async () => {
		const screen = render(Button, {
			intent: 'ordinary',
			children: textSnippet('Save draft')
		});
		const button = screen.getByRole('button', { name: 'Save draft' });

		await expect.element(button).toHaveAttribute('data-action-intent', 'ordinary');
		await expect.element(button).toHaveClass(/bg-action-ordinary/);
	});

	it('plays one cue when a primary action completes', async () => {
		const screen = render(Button, { children: textSnippet('Publish now') });
		const button = screen.getByRole('button', { name: 'Publish now' });

		await expect.element(button).toHaveAttribute('data-cuelume-toggle', 'release');
		await expect.element(button).toHaveAttribute('data-action-intent', 'primary');
		await expect.element(button).not.toHaveAttribute('data-cuelume-press');
		await expect.element(button).not.toHaveAttribute('data-cuelume-release');
	});
});
