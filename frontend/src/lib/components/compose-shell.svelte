<script lang="ts">
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ComposeTextPost from './compose-text-post.svelte';
	import { ui } from '$lib/stores/ui.svelte';

	const initialScheduleDate = $derived(page.url.searchParams.get('date'));
	const initialScheduleTime = $derived(page.url.searchParams.get('time'));
	const initialWorkspaceId = $derived(page.url.searchParams.get('workspace_id'));
	const composerResetCounter = $derived(ui.composerResetCounter);

	function handleComposerReset() {
		ui.clearActiveComposerDraft();
		replaceState(resolve('/'), {});
	}

	function handlePublicationDraftCreated(id: string) {
		ui.setActiveComposerDraft(id);
		replaceState(resolve(`/publications/${encodeURIComponent(id)}` as '/'), {});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background" data-testid="compose-shell">
	{#key composerResetCounter}
		<div data-testid="text-thread-composer-shell" class="flex min-h-0 flex-1 flex-col">
			<ComposeTextPost
				{initialScheduleDate}
				{initialScheduleTime}
				{initialWorkspaceId}
				onSuccess={handleComposerReset}
				onDeleted={handleComposerReset}
				onDraftCreated={handlePublicationDraftCreated}
			/>
		</div>
	{/key}
</div>
