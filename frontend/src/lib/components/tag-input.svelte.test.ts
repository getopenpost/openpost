import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import TagInput from './tag-input.svelte';

describe('TagInput', () => {
	it('adds trimmed tags with Enter', async () => {
		const onChange = vi.fn();
		const screen = await render(TagInput, {
			props: {
				id: 'youtube-tags',
				value: 'OpenPost, social publishing',
				onChange
			}
		});

		const input = screen.getByPlaceholder('Type a tag, then press Enter');
		await input.fill('  launch  ');
		await input.click();
		await userEvent.keyboard('{Enter}');

		expect(onChange).toHaveBeenCalledWith('OpenPost, social publishing, launch');
	});

	it('removes a tag with an accessible action', async () => {
		const onChange = vi.fn();
		const screen = await render(TagInput, {
			props: {
				id: 'youtube-tags',
				value: 'OpenPost, social publishing',
				onChange
			}
		});

		await screen.getByRole('button', { name: 'Remove OpenPost' }).click();

		expect(onChange).toHaveBeenCalledWith('social publishing');
	});
});
