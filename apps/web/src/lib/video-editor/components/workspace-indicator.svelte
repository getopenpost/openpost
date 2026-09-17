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
					class="h-8 max-w-48 gap-2 border-border bg-card px-2 text-xs text-foreground hover:bg-card-hover [@media(pointer:coarse)]:h-9"
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
			class="video-editor-theme w-56 border-border bg-popover p-2 text-popover-foreground"
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
						class="flex h-8 items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
						onclick={() => {
							if (!isActive && !isConfirming) void switchWorkspace(workspace.id);
						}}
						onkeydown={(event) => {
							if (!isActive && !isConfirming && (event.key === 'Enter' || event.key === ' ')) {
								event.preventDefault();
								void switchWorkspace(workspace.id);
							}
						}}
						role={!isActive && !isConfirming ? 'button' : undefined}
						tabindex={!isActive && !isConfirming ? 0 : undefined}
						aria-label={!isActive && !isConfirming ? m.video_editor_workspace_switch() : undefined}
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
								class="h-8 px-2 text-xs"
								disabled={gate.busy}
								onclick={(event) => {
									event.stopPropagation();
									confirmRemoveId = null;
								}}
							>
								{m.common_cancel()}
							</Button>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								class="h-8 px-2 text-xs"
								disabled={gate.busy}
								onclick={(event) => {
									event.stopPropagation();
									void removeWorkspace(workspace.id);
								}}
							>
								{m.video_editor_workspace_remove()}
							</Button>
						{:else}
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								class="shrink-0 text-[var(--video-editor-muted)] hover:text-destructive"
								disabled={gate.busy}
								aria-label={m.video_editor_workspace_remove_named({ name: workspace.name })}
								onclick={(event) => {
									event.stopPropagation();
									confirmRemoveId = workspace.id;
								}}
							>
								<ThemeIcon role="delete" class="size-3.5" />
							</Button>
						{/if}
					</div>
				{/each}
			</div>

			<div class="my-1 h-px bg-border"></div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="h-8 w-full justify-start gap-2 px-2 text-xs [@media(pointer:coarse)]:h-9"
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
