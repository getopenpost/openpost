<script lang="ts">
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { WorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	let { gate }: { gate: WorkspaceGate } = $props();
</script>

{#if gate.state === 'initializing'}
	<PageLoading label={m.editors_loading()} />
{:else if gate.state === 'unavailable'}
	<div class="max-w-md text-center">
		<h1 class="text-lg font-semibold">{m.video_editor_gate_unavailable_title()}</h1>
		<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
			{m.video_editor_gate_unavailable_body()}
		</p>
		<Button class="mt-6" onclick={() => history.back()}>{m.video_editor_go_back()}</Button>
	</div>
{:else if gate.state === 'pick' || gate.state === 'reconnect'}
	<div
		class="w-full max-w-md rounded-xl border border-[oklch(0.25_0.015_55)] bg-[oklch(0.2_0.01_50)] p-8 text-center"
	>
		<FolderPlusIcon class="mx-auto size-10 text-[oklch(0.66_0.14_45)]" aria-hidden="true" />
		<h1 class="mt-4 text-lg font-semibold">
			{gate.state === 'pick'
				? m.video_editor_gate_pick_title()
				: m.video_editor_gate_reconnect_title()}
		</h1>
		<p class="mt-2 text-sm text-[oklch(0.65_0.015_55)]">
			{gate.state === 'pick'
				? m.video_editor_gate_pick_body()
				: m.video_editor_gate_reconnect_body({ folder: gate.workspaceName })}
		</p>
		{#if gate.error}
			<InlineNotice tone="error" class="mt-4 text-left">{gate.error}</InlineNotice>
		{/if}
		<div class="mt-6 flex flex-col items-center gap-2">
			{#if gate.state === 'pick'}
				<Button onclick={() => gate.pickFolder()} disabled={gate.busy}>
					{#if gate.busy}
						<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
					{:else}
						<FolderPlusIcon class="size-4" aria-hidden="true" />
					{/if}
					{m.video_editor_gate_pick_cta()}
				</Button>
			{:else}
				<Button onclick={() => gate.reconnect()} disabled={gate.busy}>
					{#if gate.busy}
						<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
					{:else}
						<RefreshCwIcon class="size-4" aria-hidden="true" />
					{/if}
					{m.video_editor_gate_reconnect_cta()}
				</Button>
				<Button variant="ghost" size="sm" onclick={() => gate.chooseDifferentFolder()}>
					{m.video_editor_gate_different_folder()}
				</Button>
			{/if}
		</div>
	</div>
{/if}
