<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { WorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';

	let { gate }: { gate: WorkspaceGate } = $props();
	let open = $state(false);
	let confirmRemoveId = $state<string | null>(null);

	$effect(() => {
		if (!open) confirmRemoveId = null;
	});

	async function switchWorkspace(workspaceId: string): Promise<void> {
		await gate.switchWorkspace(workspaceId);
		if (gate.state === 'ready') open = false;
	}

	async function removeWorkspace(workspaceId: string): Promise<void> {
		await gate.forgetWorkspace(workspaceId);
		confirmRemoveId = null;
		if (gate.state !== 'ready') open = false;
	}

	async function addWorkspace(): Promise<void> {
		await gate.pickFolder();
		if (gate.state === 'ready') open = false;
	}
</script>

{#if gate.state === 'ready' && gate.workspaceName}
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					type="button"
					variant="outline"
					size="sm"
					class="min-h-9 max-w-[min(15rem,48vw)] gap-2 border-[oklch(0.3_0.015_55)] bg-[oklch(0.18_0.01_55)] px-3 text-xs text-[var(--video-editor-text)] hover:bg-[oklch(0.23_0.012_55)] max-[640px]:min-h-11"
					aria-haspopup="dialog"
					aria-expanded={open}
					title={m.video_editor_workspace_folder()}
				>
					<ThemeIcon role="workspace" class="size-3.5 shrink-0" />
					<span class="truncate">{gate.workspaceName}</span>
					<ThemeIcon
						role="chevron-down"
						class={`size-3.5 shrink-0 text-[var(--video-editor-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
					/>
				</Button>
			{/snippet}
		</Popover.Trigger>

		<Popover.Content
			align="end"
			sideOffset={8}
			role="dialog"
			aria-label={m.video_editor_workspaces()}
			class="video-editor-theme w-[min(22rem,calc(100vw-1rem))] border-[oklch(0.3_0.015_55)] bg-[oklch(0.18_0.01_55)] p-2 text-[var(--video-editor-text)]"
		>
			<p
				class="px-2 py-1.5 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
			>
				{m.video_editor_workspaces()}
			</p>

			<div class="flex flex-col">
				{#each gate.knownWorkspaces as workspace (workspace.id)}
					{@const isActive = workspace.id === gate.activeWorkspaceId}
					{@const isConfirming = workspace.id === confirmRemoveId}
					<div
						class="flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[oklch(0.23_0.012_55)] max-[640px]:min-h-11"
					>
						<ThemeIcon
							role="workspace"
							class="size-3.5 shrink-0 text-[var(--video-editor-muted)]"
						/>
						<span class="min-w-0 flex-1 truncate text-xs" title={workspace.name}>
							{workspace.name}
						</span>
						{#if isActive}
							<span
								class="flex shrink-0 items-center gap-1 text-[10px] text-[var(--video-editor-focus)]"
							>
								<ThemeIcon role="check" class="size-3" />
								{m.video_editor_workspace_active()}
							</span>
						{/if}

						{#if isConfirming}
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="h-8 px-2 text-xs max-[640px]:h-10"
								disabled={gate.busy}
								onclick={() => (confirmRemoveId = null)}
							>
								{m.common_cancel()}
							</Button>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								class="h-8 px-2 text-xs max-[640px]:h-10"
								disabled={gate.busy}
								onclick={() => removeWorkspace(workspace.id)}
							>
								{m.video_editor_workspace_remove()}
							</Button>
						{:else}
							{#if !isActive}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-8 px-2 text-xs max-[640px]:h-10"
									disabled={gate.busy}
									onclick={() => switchWorkspace(workspace.id)}
								>
									{m.video_editor_workspace_switch()}
								</Button>
							{/if}
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								class="shrink-0 text-[var(--video-editor-muted)] hover:text-destructive max-[640px]:size-10"
								disabled={gate.busy}
								aria-label={m.video_editor_workspace_remove_named({ name: workspace.name })}
								onclick={() => (confirmRemoveId = workspace.id)}
							>
								<ThemeIcon role="delete" class="size-3.5" />
							</Button>
						{/if}
					</div>
				{/each}
			</div>

			<div class="my-1 h-px bg-[oklch(0.28_0.014_55)]"></div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="min-h-9 w-full justify-start gap-2 px-2 text-xs max-[640px]:min-h-11"
				disabled={gate.busy}
				onclick={addWorkspace}
			>
				<ThemeIcon role="add" class="size-3.5" />
				{m.video_editor_workspace_add()}
			</Button>
			{#if gate.error}
				<p class="px-2 pt-2 text-xs text-destructive" role="alert">{gate.error}</p>
			{/if}
		</Popover.Content>
	</Popover.Root>
{/if}
