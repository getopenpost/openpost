<script lang="ts">
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import type { WorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';

	let { gate, variant = 'standalone' }: { gate: WorkspaceGate; variant?: 'standalone' | 'inline' } =
		$props();
</script>

{#if gate.state === 'initializing'}
	<PageLoading label={m.editors_loading()} />
{:else if gate.state === 'unavailable'}
	<div class="max-w-md text-center">
		<svelte:element this={variant === 'inline' ? 'h2' : 'h1'} class="text-lg font-semibold"
			>{m.video_editor_gate_unavailable_title()}</svelte:element
		>
		<p class="mt-2 text-sm text-[var(--video-editor-muted)]">
			{m.video_editor_gate_unavailable_body()}
		</p>
		<Button class="mt-6" onclick={() => history.back()}>{m.video_editor_go_back()}</Button>
	</div>
{:else if gate.state === 'pick' || gate.state === 'reconnect'}
	<div
		class:inline={variant === 'inline'}
		class="w-full max-w-md rounded-xl border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-8 text-center"
	>
		<ThemeIcon role="workspace" class="mx-auto size-10 text-[var(--video-editor-primary)]" />
		<svelte:element this={variant === 'inline' ? 'h2' : 'h1'} class="mt-4 text-lg font-semibold">
			{gate.state === 'pick'
				? m.video_editor_gate_pick_title()
				: m.video_editor_gate_reconnect_title()}
		</svelte:element>
		<p class="mt-2 text-sm text-[var(--video-editor-muted)]">
			{gate.state === 'pick'
				? m.video_editor_gate_pick_body()
				: m.video_editor_gate_reconnect_body({ folder: gate.workspaceName })}
		</p>
		{#if gate.error}
			<InlineNotice tone="error" class="mt-4 text-left">{gate.error}</InlineNotice>
		{/if}
		<div class="gate-actions mt-6 flex flex-col items-center gap-2">
			{#if gate.state === 'pick'}
				<Button
					variant={variant === 'inline' ? 'outline' : 'default'}
					onclick={() => gate.pickFolder()}
					disabled={gate.busy}
				>
					{#if gate.busy}
						<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
					{:else}
						<ThemeIcon role="workspace" class="size-4" />
					{/if}
					{m.video_editor_gate_pick_cta()}
				</Button>
			{:else}
				<Button onclick={() => gate.reconnect()} disabled={gate.busy}>
					{#if gate.busy}
						<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
					{:else}
						<ThemeIcon role="refresh" class="size-4" />
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

<style>
	.inline {
		max-width: none;
		padding: 24px 0;
		border-width: 1px 0 0;
		border-radius: 0;
		background: transparent;
		text-align: left;
	}
	.inline > :global(svg) {
		display: none;
	}
	.inline :global(h2) {
		margin-top: 0;
		font-size: 16px;
	}
	.inline > p {
		max-width: 65ch;
		line-height: 1.6;
	}
	.inline .gate-actions {
		align-items: flex-start;
		margin-top: 16px;
	}
</style>
