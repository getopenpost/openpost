<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import CheckIcon from 'lucide-svelte/icons/check';
	import SettingsIcon from 'lucide-svelte/icons/settings';
	import type { Workspace } from '$lib/api/client';

	interface Props {
		touchSize?: boolean;
		onSelect?: () => void;
		showLabel?: boolean;
		showSettings?: boolean;
	}

	let { touchSize = false, onSelect, showLabel = true, showSettings = true }: Props = $props();
	const itemClass = $derived(touchSize ? 'min-h-11 gap-3' : 'gap-3 py-2');

	function initials(value: string) {
		const parts = value.split(/[\s._-]+/).filter(Boolean);
		return ((parts[0]?.[0] ?? 'O') + (parts[1]?.[0] ?? '')).toUpperCase();
	}

	function avatarURL(workspace: Workspace) {
		return ((workspace as Workspace & { avatar_url?: string }).avatar_url ?? '').trim();
	}

	async function switchWorkspace(workspace: Workspace) {
		if (workspace.id !== workspaceCtx.currentWorkspace?.id) {
			await workspaceCtx.setWorkspace(workspace);
		}
		onSelect?.();
	}

	function openWorkspaceSettings() {
		onSelect?.();
		goto(resolve('/settings?tab=general' as '/'));
	}
</script>

{#if showLabel}<DropdownMenu.Label>{m.sidebar_switch_workspace()}</DropdownMenu.Label>{/if}
{#each workspaceCtx.workspaces as workspace (workspace.id)}
	<DropdownMenu.Item class={itemClass} onclick={() => switchWorkspace(workspace)}>
		<Avatar.Root class="size-8 rounded-md">
			{@const imageURL = avatarURL(workspace)}
			{#if imageURL}<Avatar.Image src={imageURL} alt={workspace.name} />{/if}
			<Avatar.Fallback class="rounded-md bg-muted text-xs">
				{initials(workspace.name)}
			</Avatar.Fallback>
		</Avatar.Root>
		<span class="min-w-0 flex-1 truncate">{workspace.name}</span>
		{#if workspace.id === workspaceCtx.currentWorkspace?.id}
			<CheckIcon class="size-4 text-primary" />
		{/if}
	</DropdownMenu.Item>
{/each}
{#if workspaceCtx.workspaces.length === 0}
	<DropdownMenu.Item disabled class={touchSize ? 'min-h-11' : ''}>
		{m.sidebar_no_workspaces()}
	</DropdownMenu.Item>
{/if}
{#if showSettings}
	<DropdownMenu.Separator />
	<DropdownMenu.Item class={touchSize ? 'min-h-11' : ''} onclick={openWorkspaceSettings}>
		<SettingsIcon class="mr-2 size-4 text-muted-foreground" />
		{m.sidebar_workspace_settings()}
	</DropdownMenu.Item>
{/if}
