import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ComposeShell from './compose-shell.svelte';

vi.mock('$lib/api/client', () => ({
	client: {
		GET: vi.fn(async () => ({ data: [], error: null })),
		POST: vi.fn(async () => ({ data: null, error: null })),
		PUT: vi.fn(async () => ({ data: null, error: null })),
		DELETE: vi.fn(async () => ({ data: null, error: null }))
	},
	getToken: () => null
}));

describe('ComposeShell', () => {
	it('uses the text-and-thread composer for the default post intent', async () => {
		const screen = await render(ComposeShell);
		const modeSelect = screen.getByTestId('composer-mode-select');

		await expect.element(modeSelect).toBeVisible();
		await expect.element(screen.getByTestId('text-thread-composer-shell')).toBeVisible();
		await expect.element(modeSelect).toHaveTextContent('Post');
		await expect.element(screen.getByRole('button', { name: 'Add post' })).toBeVisible();
		expect(screen.container.textContent).not.toContain('Save draft');
		expect(screen.container.textContent).not.toContain('Format-first composer');
		expect(screen.container.textContent).not.toContain('Renditions');
		expect(screen.container.textContent).not.toContain('Source text');
	});
});
