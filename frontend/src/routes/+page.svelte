<script lang="ts">
	import { page } from '$app/state';
	import { onDestroy, onMount } from 'svelte';
	import ComposeShell from '$lib/components/compose-shell.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import WorkspaceSetupGuide from '$lib/components/workspace-setup-guide.svelte';
	import { CreationModeSwitch, PostBuilderPage } from '$lib/components/post-builder';
	import {
		createOpenPostBuilderClient,
		hasComposerIntent,
		localizedPostBuilderCopy,
		type PostBuilderCreationMode
	} from '$lib/post-builder';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';

	const builderClient = createOpenPostBuilderClient();
	const builderCopy = $derived(localizedPostBuilderCopy());
	let handoffSelected = $state(false);
	let availabilityLoading = $state(true);
	let builderEnabled = $state(false);
	let discoveryEnabled = $state(false);
	let creationMode = $state<PostBuilderCreationMode>('manual');
	let availabilityController: AbortController | null = null;

	function shouldOpenManualComposer(): boolean {
		return hasComposerIntent(page.url, {
			activeDraftId: ui.activeComposerDraftId,
			hasPendingPrompt: Boolean(ui.pendingPrompt)
		});
	}

	onMount(() => {
		const controller = new AbortController();
		availabilityController = controller;
		void builderClient
			.availability({ signal: controller.signal })
			.then((availability) => {
				if (controller.signal.aborted) return;
				builderEnabled = availability.builderEnabled;
				discoveryEnabled = availability.discoveryEnabled;
				creationMode =
					availability.builderEnabled && !shouldOpenManualComposer() ? 'builder' : 'manual';
			})
			.catch(() => {
				if (controller.signal.aborted) return;
				builderEnabled = false;
				discoveryEnabled = false;
				creationMode = 'manual';
			})
			.finally(() => {
				if (!controller.signal.aborted) availabilityLoading = false;
			});
	});

	onDestroy(() => availabilityController?.abort());
</script>

<svelte:head>
	<title>OpenPost</title>
</svelte:head>

<div
	class="flex flex-1 flex-col"
	class:overflow-hidden={!builderEnabled || creationMode === 'manual'}
	class:overflow-y-auto={builderEnabled && creationMode === 'builder'}
>
	{#if workspaceCtx.currentWorkspace}
		<WorkspaceSetupGuide
			workspaceID={workspaceCtx.currentWorkspace.id}
			wrapperClass="mx-auto hidden w-full max-w-6xl px-4 pt-5 md:block lg:px-8"
		/>
	{/if}
	{#if handoffSelected && creationMode === 'manual'}
		<div class="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
			<InlineNotice
				tone="success"
				message={m.accounts_callback_composer_selection_success()}
				class="mb-4"
			/>
		</div>
	{/if}
	{#if availabilityLoading}
		<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
			<PageLoading layout="composer" label={m.common_loading()} />
		</div>
	{:else if builderEnabled && workspaceCtx.currentWorkspace}
		<div class="flex justify-center px-4 pt-5 sm:px-6">
			<CreationModeSwitch
				value={creationMode}
				copy={builderCopy}
				onChange={(mode) => (creationMode = mode)}
			/>
		</div>
		{#if creationMode === 'builder'}
			{#key workspaceCtx.currentWorkspace.id}
				<PostBuilderPage
					workspaceId={workspaceCtx.currentWorkspace.id}
					{discoveryEnabled}
					client={builderClient}
				/>
			{/key}
		{:else}
			<ComposeShell hideSetupGuideOnDesktop onHandoffSelected={() => (handoffSelected = true)} />
		{/if}
	{:else}
		<ComposeShell hideSetupGuideOnDesktop onHandoffSelected={() => (handoffSelected = true)} />
	{/if}
</div>
