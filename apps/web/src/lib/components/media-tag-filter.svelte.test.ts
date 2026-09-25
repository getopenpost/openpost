import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MediaTagFilter from './media-tag-filter.svelte';

describe('media tag filter group', () => {
	it('exposes the filter group with its accessible name', async () => {
		const screen = await render(MediaTagFilter, {
			tags: [
				{ id: 't1', name: 'launch', item_count: 3, workspace_id: 'w1', created_at: '' },
				{ id: 't2', name: 'product', item_count: 1, workspace_id: 'w1', created_at: '' }
			],
			onChange: vi.fn()
		});

		const group = screen.getByRole('group', { name: /filter media by tag/i });
		await expect.element(group).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /launch/ })).toBeVisible();
	});

	it('marks the selected tag with aria-pressed', async () => {
		const screen = await render(MediaTagFilter, {
			tags: [{ id: 't1', name: 'launch', item_count: 3, workspace_id: 'w1', created_at: '' }],
			selectedIds: ['t1'],
			onChange: vi.fn()
		});

		const button = screen.getByRole('button', { name: /launch/ });
		await expect.element(button).toHaveAttribute('aria-pressed', 'true');
	});
});
