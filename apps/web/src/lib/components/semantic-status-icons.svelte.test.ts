import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InlineNotice from './inline-notice.svelte';
import SaveIndicator from './save-indicator.svelte';

describe('semantic status icons', () => {
	it('keeps notice meaning protected while theming the dismiss action', async () => {
		const screen = await render(InlineNotice, {
			tone: 'warning',
			message: 'Check this setting',
			onDismiss: vi.fn(),
			dismissLabel: 'Dismiss notice'
		});

		expect(
			screen.container.querySelector('[data-protected-icon]')?.getAttribute('data-protected-icon')
		).toBe('warning');
		const dismiss = screen.getByRole('button', { name: 'Dismiss notice' });
		expect(
			dismiss.element().querySelector('[data-theme-icon]')?.getAttribute('data-theme-icon')
		).toBe('close');
	});

	it('keeps save progress and success glyphs independent of the selected icon pack', async () => {
		const screen = await render(SaveIndicator, {
			saving: true,
			saved: false,
			savingLabel: 'Saving',
			savedLabel: 'Saved'
		});

		expect(
			screen.container.querySelector('[data-protected-icon]')?.getAttribute('data-protected-icon')
		).toBe('loading');
		await screen.rerender({
			saving: false,
			saved: true,
			savingLabel: 'Saving',
			savedLabel: 'Saved'
		});
		expect(
			screen.container.querySelector('[data-protected-icon]')?.getAttribute('data-protected-icon')
		).toBe('success');
	});
});
