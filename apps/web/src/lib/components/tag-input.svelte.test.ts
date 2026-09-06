import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TagInput from './tag-input.svelte';

describe('tag input interactions', () => {
	it('arms the last tag before removing it and announces the change', async () => {
		const onChange = vi.fn();
		const screen = await render(TagInput, {
			id: 'tags',
			value: 'launch, product',
			onChange
		});
		const input = screen.getByRole('textbox');

		input
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		await expect.element(screen.getByRole('status')).toHaveTextContent(/Backspace again/i);
		expect(onChange).not.toHaveBeenCalled();
		input
			.element()
			.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, repeat: true })
			);
		expect(onChange).not.toHaveBeenCalled();

		input
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
		expect(onChange).toHaveBeenCalledWith('launch');
		await expect.element(screen.getByRole('status')).toHaveTextContent(/removed/i);
	});

	it('rejects duplicate tags without changing the destination string', async () => {
		const onChange = vi.fn();
		const screen = await render(TagInput, {
			id: 'tags',
			value: 'launch',
			onChange
		});
		const input = screen.getByRole('textbox');

		await input.fill('Launch');
		input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

		expect(onChange).not.toHaveBeenCalled();
		await expect.element(screen.getByRole('status')).toHaveTextContent(/already added/i);
	});

	it('does not commit a composing Enter key', async () => {
		const onChange = vi.fn();
		const screen = await render(TagInput, {
			id: 'tags',
			value: '',
			onChange
		});
		const input = screen.getByRole('textbox');

		input.element().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		await input.fill('東京');
		input.element().dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Enter',
				bubbles: true,
				isComposing: true
			})
		);
		expect(onChange).not.toHaveBeenCalled();

		input.element().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onChange).toHaveBeenCalledWith('東京');
	});
});
