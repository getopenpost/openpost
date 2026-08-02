<script lang="ts">
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ComposeTextPost from './compose-text-post.svelte';
	import ComposeFocusedPublication from './compose-focused-publication.svelte';
	import ComposeModeSelect from './compose-mode-select.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { type ComposerModeKey } from './compose/modes';
	import { m } from '$lib/paraglide/messages';

	let selectedMode = $state<ComposerModeKey>('post');
	let lastComposerThreadState = false;
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

	function handlePostDraftCreated(id: string) {
		ui.setActiveComposerDraft(id);
		replaceState(resolve(`/posts/${id}` as '/'), {});
	}

	function handleThreadStateChange(isThread: boolean) {
		if (isThread) {
			selectedMode = 'thread';
		} else if (lastComposerThreadState && selectedMode === 'thread') {
			selectedMode = 'post';
		}
		lastComposerThreadState = isThread;
	}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background" data-testid="compose-shell">
	{#key composerResetCounter}
		{#if selectedMode === 'post' || selectedMode === 'thread'}
			<div data-testid="text-thread-composer-shell" class="flex min-h-0 flex-1 flex-col">
				<ComposeTextPost
					{initialScheduleDate}
					{initialScheduleTime}
					{initialWorkspaceId}
					onSuccess={handleComposerReset}
					onDeleted={handleComposerReset}
					onDraftCreated={handlePostDraftCreated}
					onThreadStateChange={handleThreadStateChange}
				>
					{#snippet modeControl()}
						<ComposeModeSelect
							{selectedMode}
							compactOnNarrow
							onModeChange={(mode) => (selectedMode = mode)}
						/>
					{/snippet}
				</ComposeTextPost>
			</div>
		{:else}
			{#key selectedMode}
				<ComposeFocusedPublication
					mode={selectedMode}
					{initialScheduleDate}
					{initialScheduleTime}
					{initialWorkspaceId}
					onSuccess={handleComposerReset}
					onDraftCreated={handlePublicationDraftCreated}
				>
					{#snippet modeControl()}
						<ComposeModeSelect
							{selectedMode}
							compactOnNarrow
							onModeChange={(mode) => (selectedMode = mode)}
						/>
					{/snippet}
				</ComposeFocusedPublication>
			{/key}
		{/if}
	{/key}
</div>
