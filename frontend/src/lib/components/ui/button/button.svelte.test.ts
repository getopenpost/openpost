import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Button from './button.svelte';

function textSnippet(text: string) {
	return createRawSnippet(() => ({ render: () => text }));
}

describe('Button', () => {
	it('adds an audible down-and-up cue to tactile variants', async () => {
		const screen = render(Button, { children: textSnippet('Publish now') });
		const button = screen.getByRole('button', { name: 'Publish now' });

		await expect.element(button).toHaveAttribute('data-cuelume-press', 'press');
		await expect.element(button).toHaveAttribute('data-cuelume-release', 'release');
	});

	it('keeps routine ghost controls quiet', async () => {
		const screen = render(Button, { variant: 'ghost', children: textSnippet('Dismiss') });
		const button = screen.getByRole('button', { name: 'Dismiss' });

		await expect.element(button).not.toHaveAttribute('data-cuelume-press');
		await expect.element(button).not.toHaveAttribute('data-cuelume-release');
	});
});
