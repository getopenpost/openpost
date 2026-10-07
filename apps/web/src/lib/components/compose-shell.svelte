<script lang="ts">
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import ComposeTextPost from './compose-text-post.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		prepareToolDraft,
		removeToolDraft,
		type PreparedToolDraft
	} from '$lib/composer/tool-draft-storage';
	import InlineNotice from './inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	let {
		onHandoffSelected,
		hideSetupGuideOnDesktop = false
	}: { onHandoffSelected?: () => void; hideSetupGuideOnDesktop?: boolean } = $props();

	const initialScheduleDate = $derived(page.url.searchParams.get('date'));
	const initialScheduleTime = $derived(page.url.searchParams.get('time'));
	const initialWorkspaceId = $derived(page.url.searchParams.get('workspace_id'));
	const initialAccountIds = $derived(
		(page.url.searchParams.get('account_ids') ?? '').split(',').filter(Boolean)
	);
	const initialMediaIds = $derived(page.url.searchParams.getAll('media_id'));
	const composerResetCounter = $derived(ui.composerResetCounter);
	const toolDraftToken = $derived(page.url.searchParams.get('tool_draft') ?? '');
	const toolDraftActor = $derived($auth.user?.id ?? '');
	const toolDraftWorkspace = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	let toolDraftConsumed = $state(false);
	let toolDraft = $state.raw<PreparedToolDraft | null>(null);
	let toolDraftLoading = $state(false);
	let toolDraftError = $state('');
	let toolDraftAttempt = $state(0);
	let loadedToolDraftToken = '';
	let importedComposerResetCounter = -1;
	const initialComposerResetCounter = ui.composerResetCounter;

	$effect(() => {
		const token = toolDraftToken;
		const actor = toolDraftActor;
		const workspace = toolDraftWorkspace;
		void toolDraftAttempt;
		if (token && composerResetCounter !== initialComposerResetCounter) {
			handleComposerReset();
			return;
		}
		if (toolDraftConsumed) return;
		if (!token || !actor || !workspace || loadedToolDraftToken === token) return;
		const controller = new AbortController();
		toolDraftLoading = true;
		toolDraftError = '';
		void prepareToolDraft(token, actor, workspace, controller.signal)
			.then((draft) => {
				if (controller.signal.aborted) return;
				toolDraft = draft;
				if (draft) {
					loadedToolDraftToken = token;
					importedComposerResetCounter = initialComposerResetCounter;
				} else toolDraftError = m.tool_draft_missing();
			})
			.catch((cause) => {
				if (controller.signal.aborted) return;
				toolDraftError =
					cause instanceof Error && cause.message === 'tool_draft_workspace_changed'
						? m.tool_draft_workspace_changed()
						: m.tool_draft_prepare_failed();
			})
			.finally(() => {
				if (!controller.signal.aborted) toolDraftLoading = false;
			});
		return () => controller.abort();
	});

	function handleComposerReset() {
		toolDraftConsumed = true;
		toolDraft = null;
		ui.clearActiveComposerDraft();
		replaceState(resolve('/'), {});
	}

	function handlePublicationDraftCreated(id: string) {
		toolDraftConsumed = true;
		if (loadedToolDraftToken) void removeToolDraft(loadedToolDraftToken);
		toolDraft = null;
		ui.setActiveComposerDraft(id);
		replaceState(resolveAppPath(`/publications/${encodeURIComponent(id)}`), {});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background" data-testid="compose-shell">
	{#if toolDraftToken && !toolDraftConsumed && (toolDraftLoading || toolDraftError || !toolDraft)}
		<div class="mx-auto w-full max-w-lg p-5">
			{#if toolDraftError}
				<InlineNotice tone="error" message={toolDraftError}>
					{#snippet actions()}<Button variant="outline" onclick={() => toolDraftAttempt++}
							>{m.common_retry()}</Button
						>{/snippet}
				</InlineNotice>
			{:else}<p role="status">{m.tool_draft_preparing()}</p>{/if}
		</div>
	{:else}
		{#key composerResetCounter}
			<div data-testid="text-thread-composer-shell" class="flex min-h-0 flex-1 flex-col">
				<ComposeTextPost
					initialToolDraft={composerResetCounter === importedComposerResetCounter
						? toolDraft
						: null}
					{initialScheduleDate}
					{initialScheduleTime}
					{initialWorkspaceId}
					{initialAccountIds}
					{initialMediaIds}
					{onHandoffSelected}
					{hideSetupGuideOnDesktop}
					onSuccess={handleComposerReset}
					onDeleted={handleComposerReset}
					onDraftCreated={handlePublicationDraftCreated}
				/>
			</div>
		{/key}
	{/if}
</div>
