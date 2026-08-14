import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dayPostsSource = readFileSync(new URL('./day-posts-modal.svelte', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('./sidebar-planner.svelte', import.meta.url), 'utf8');
const composerSource = readFileSync(new URL('./compose-text-post.svelte', import.meta.url), 'utf8');
const mediaSource = readFileSync(
	new URL('../../routes/media/+page.svelte', import.meta.url),
	'utf8'
);
const editorsSource = readFileSync(
	new URL('../../routes/editors/+page.svelte', import.meta.url),
	'utf8'
);

describe('destructive consumer completion contract', () => {
	it('announces day-post deletion and restores a surviving heading for confirmed and direct actions', () => {
		expect(dayPostsSource).toContain('successMessage: m.day_posts_delete_success()');
		expect(dayPostsSource).toContain('bind:this={deleteReturnFocus}');
		expect(dayPostsSource).toContain('returnFocus: deleteReturnFocus');
		expect(dayPostsSource).not.toContain('returnFocus={deleteReturnFocus}');
		expect(dayPostsSource.match(/error = cause instanceof Error \? cause\.message/g)).toHaveLength(
			1
		);
	});

	it('announces sidebar draft deletion and restores the surviving drafts heading', () => {
		expect(sidebarSource).toContain('successMessage: m.sidebar_delete_draft_success()');
		expect(sidebarSource).toContain('bind:this={draftDeleteReturnFocus}');
		expect(sidebarSource).toContain('returnFocus: draftDeleteReturnFocus');
		expect(sidebarSource).not.toContain('returnFocus={draftDeleteReturnFocus}');
		expect(sidebarSource).not.toContain('draftDeleteError');
		expect(sidebarSource).not.toContain("import AppToast from '$lib/components/app-toast.svelte'");
	});

	it('returns one completion contract for every composer delete surface', () => {
		expect(composerSource).toContain('successMessage: m.compose_delete_success()');
		expect(composerSource).toContain("returnFocus: document.getElementById('post-textarea-0')");
		expect(composerSource).toContain('await onDeleted?.()');
		expect(composerSource).not.toContain('await onDeleted?.();\n\t\t\tawait tick();');
		expect(composerSource.match(/onclick={requestDraftDelete}/g)).toHaveLength(2);
		expect(composerSource.match(/onDelete={draftId \|\| publicationOnlyEdit/g)).toHaveLength(2);
	});

	it('announces media and editor catalog deletion exactly once through dialog outcomes', () => {
		const mediaDelete = mediaSource.slice(
			mediaSource.indexOf('async function deleteSelectedBatch'),
			mediaSource.indexOf('async function downloadMedia')
		);
		expect(mediaDelete).toContain('message: m.media_deleted_partial');
		expect(mediaDelete).toContain('successMessage: deletedCountLabel');
		expect(mediaDelete).not.toContain('notify(');

		const catalogDelete = editorsSource.slice(
			editorsSource.indexOf('async function confirmDelete'),
			editorsSource.indexOf('function requestRenameDesign')
		);
		expect(catalogDelete).toContain('successMessage:');
		expect(catalogDelete).toContain('message: errorMessage(');
		expect(catalogDelete).not.toContain('notify(');
	});
});
