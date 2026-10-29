import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import { page } from 'vitest/browser';
import '../../../../routes/layout.css';
import Button from '@openpost/ui/components/button/button.svelte';

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
	});

	it('binds one release-toggle cue to a primary action', async () => {
		const screen = render(Button, { children: textSnippet('Publish now') });
		const button = screen.getByRole('button', { name: 'Publish now' });

		await expect.element(button).toHaveAttribute('data-cuelume-toggle', 'release');
		await expect.element(button).toHaveAttribute('data-action-intent', 'primary');
		await expect.element(button).not.toHaveAttribute('data-cuelume-press');
		await expect.element(button).not.toHaveAttribute('data-cuelume-release');
	});
	it('keeps stacked action content inside a multiline small button', async () => {
		await page.viewport(1280, 900);
		const screen = render(Button, {
			size: 'sm',
			multiline: true,
			class: 'w-40',
			children: createRawSnippet(() => ({
				render: () =>
					'<span><span style="display:block">Select a destination</span><span style="display:block">A long account name and a setup notice that wraps across several lines.</span></span>'
			}))
		});
		const button = screen.getByRole('button').element();
		const bounds = button.getBoundingClientRect();
		const content = button.firstElementChild!.getBoundingClientRect();
		expect(content.top).toBeGreaterThanOrEqual(bounds.top);
		expect(content.bottom).toBeLessThanOrEqual(bounds.bottom);
		expect(bounds.height).toBeGreaterThan(44);
		await screen.unmount();
	});
});
