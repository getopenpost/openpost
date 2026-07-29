import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import DraftConflictDialog from './draft-conflict-dialog.svelte';

const conflict = {
	code: 'draft_revision_conflict' as const,
	detail: 'Draft changed elsewhere',
	conflict: {
		aggregate_type: 'publication' as const,
		aggregate_id: 'publication-1',
		expected_revision: 2,
		current_revision: 3,
		status: 'draft',
		changed_by_name: 'Alex',
		changed_domains: ['destinations', 'media']
	}
};

describe('DraftConflictDialog', () => {
	it.each([
		['reload', m.draft_conflict_reload()],
		['copy', m.draft_conflict_copy()],
		['overwrite', m.draft_conflict_overwrite()]
	] as const)('runs the selected %s recovery action', async (action, label) => {
		const callbacks = {
			reload: vi.fn(),
			copy: vi.fn(),
			overwrite: vi.fn()
		};
		const screen = await render(DraftConflictDialog, {
			open: true,
			conflict,
			onReload: callbacks.reload,
			onSaveCopy: callbacks.copy,
			onOverwrite: callbacks.overwrite
		});

		await expect.element(screen.getByText('destinations, media')).toBeVisible();
		await expect
			.element(screen.getByText(m.draft_conflict_changed_by({ name: 'Alex' })))
			.toBeVisible();
		await screen.getByRole('button', { name: label }).click();
		expect(callbacks[action]).toHaveBeenCalledOnce();
	});
});
