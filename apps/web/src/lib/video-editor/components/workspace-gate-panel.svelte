<script lang="ts">
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import type { WorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';

	let { gate, variant = 'standalone' }: { gate: WorkspaceGate; variant?: 'standalone' | 'inline' } =
		$props();

	const unavailableCopy = $derived.by(() => {
		switch (gate.browserSupport?.issue) {
			case 'secure-context':
				return {
					title: m.video_editor_gate_secure_context_title(),
					body: m.video_editor_gate_secure_context_body()
				};
			case 'filesystem-blocked':
				return {
					title: m.video_editor_gate_filesystem_blocked_title(),
					body: m.video_editor_gate_filesystem_blocked_body()
				};
			case 'storage-blocked':
				return {
					title: m.video_editor_gate_storage_blocked_title(),
					body: m.video_editor_gate_storage_blocked_body()
				};
			case 'media-api':
				return {
					title: m.video_editor_gate_media_api_title(),
					body: m.video_editor_gate_media_api_body()
				};
			default:
				return {
					title: m.video_editor_gate_unavailable_title(),
					body: m.video_editor_gate_filesystem_api_body()
				};
		}
	});
</script>

{#if gate.state === 'initializing'}
	<PageLoading label={m.editors_loading()} />
{:else if gate.state === 'unavailable'}
	<div class="max-w-md text-center">
		<svelte:element this={variant === 'inline' ? 'h2' : 'h1'} class="text-sm font-semibold"
			>{unavailableCopy.title}</svelte:element
		>
		<p class="mt-2 max-w-[65ch] text-xs text-[var(--video-editor-muted)]">
			{unavailableCopy.body}
		</p>
		<div class="mt-4 flex flex-wrap justify-center gap-2">
			<Button onclick={() => location.reload()}>{m.video_editor_gate_reload()}</Button>
			<Button variant="outline" onclick={() => history.back()}>{m.video_editor_go_back()}</Button>
		</div>
	</div>
{:else if gate.state === 'pick' || gate.state === 'reconnect'}
	<div
		class={variant === 'inline'
			? 'w-full border-t border-[var(--video-editor-border)] bg-transparent px-0 py-6 text-left'
			: 'w-full max-w-md rounded-xl border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-5 text-center'}
	>
		<ThemeIcon
			role="workspace"
			class={variant === 'inline' ? 'hidden' : 'mx-auto size-6 text-[var(--video-editor-primary)]'}
		/>
		<svelte:element
			this={variant === 'inline' ? 'h2' : 'h1'}
			class={variant === 'inline' ? 'text-base font-semibold' : 'mt-3 text-sm font-semibold'}
		>
			{gate.state === 'pick'
				? m.video_editor_gate_pick_title()
				: m.video_editor_gate_reconnect_title()}
		</svelte:element>
		<p
			class={variant === 'inline'
				? 'mt-2 max-w-[65ch] text-xs leading-relaxed text-[var(--video-editor-muted)]'
				: 'mx-auto mt-2 max-w-[65ch] text-xs text-[var(--video-editor-muted)]'}
		>
			{gate.state === 'pick'
				? m.video_editor_gate_pick_body()
				: m.video_editor_gate_reconnect_body({ folder: gate.workspaceName })}
		</p>
		{#if gate.error}
			<InlineNotice tone="error" class="mt-4 text-left">{gate.error}</InlineNotice>
		{/if}
		<div
			class={variant === 'inline'
				? 'mt-4 flex flex-col items-start gap-2'
				: 'mt-4 flex flex-col items-center gap-2'}
		>
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
