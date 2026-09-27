import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import '../../../routes/layout.css';
import ToolbarGroup from './toolbar-group.svelte';

function buttonSnippet(text: string) {
	return createRawSnippet(() => ({
		render: () => `<button type="button">${text}</button>`
	}));
}

describe('ToolbarGroup landmark', () => {
	it('exposes a named toolbar when a label is provided', async () => {
		const screen = await render(ToolbarGroup, {
			ariaLabel: 'Editing tools',
			children: buttonSnippet('Mark in')
		});
		const toolbar = screen.getByRole('toolbar', { name: 'Editing tools' });
		await expect.element(toolbar).toBeVisible();
		await expect.element(toolbar.getByRole('button', { name: 'Mark in' })).toBeVisible();
	});

	it('renders no toolbar landmark without a label so assistive technology is not given a bare toolbar', async () => {
		const screen = await render(ToolbarGroup, {
			children: buttonSnippet('Mark in')
		});
		expect(screen.container.querySelector('[role="toolbar"]')).toBeNull();
		await expect.element(screen.getByRole('button', { name: 'Mark in' })).toBeVisible();
	});
});
