import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import MediaTagPicker from './media-tag-picker.svelte';

describe('media tag picker new-tag input', () => {
	it('gives the new-tag input an explicit accessible name', async () => {
		const screen = await render(MediaTagPicker, {
			props: {
				tags: [],
				selectedIds: [],
				canEdit: true,
				onToggle: vi.fn(),
				onCreate: vi.fn()
			}
		});

		await screen.getByRole('button', { name: m.media_add_tag() }).click();

		const nameField = screen.getByPlaceholder(m.media_new_tag());
		await expect.element(nameField).toHaveAttribute('aria-label', m.media_new_tag());

		await nameField.fill('launch');
		await expect
			.element(screen.getByRole('textbox', { name: m.media_new_tag() }))
			.toHaveValue('launch');
	});
});
