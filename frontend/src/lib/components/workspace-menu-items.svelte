<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import type { Workspace } from '$lib/api/client';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { workspaceColor } from '$lib/workspace-color';

	interface Props {
		touchSize?: boolean;
		onSelect?: () => void;
		onCreate?: () => void;
		showLabel?: boolean;
		showSettings?: boolean;
	}

	let {
		touchSize = false,
		onSelect,
		onCreate,
		showLabel = true,
		showSettings = true
	}: Props = $props();
	const itemClass = $derived(touchSize ? 'min-h-11 gap-3' : 'gap-3 py-2');
	const unsavedChanges = getOptionalUnsavedChanges();

	function initials(value: string) {
		const parts = value.split(/[\s._-]+/).filter(Boolean);
		return ((parts[0]?.[0] ?? 'O') + (parts[1]?.[0] ?? '')).toUpperCase();
	}

	function avatarURL(workspace: Workspace) {
		return getAuthenticatedMediaURL(
			((workspace as Workspace & { avatar_url?: string }).avatar_url ?? '').trim()
		);
	}

	async function switchWorkspace(workspace: Workspace) {
		if (workspace.id !== workspaceCtx.currentWorkspace?.id) {
			if (unsavedChanges && !unsavedChanges.confirmDiscard()) return;
			const switched = await workspaceCtx.setWorkspace(workspace);
			if (!switched) return;
		}
		onSelect?.();
	}

	function createWorkspace() {
		onSelect?.();
		onCreate?.();
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
		<span
			class="size-2 shrink-0 rounded-full ring-1 ring-foreground/10"
			style:background-color={workspaceColor(workspace)}
			aria-hidden="true"
		></span>
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
{#if onCreate || showSettings}
	<DropdownMenu.Separator />
{/if}
{#if onCreate}
	<DropdownMenu.Item class={touchSize ? 'min-h-11' : ''} onclick={createWorkspace}>
		<PlusIcon class="mr-2 size-4 text-muted-foreground" />
		{m.onboarding_submit()}
	</DropdownMenu.Item>
{/if}
{#if showSettings}
	<DropdownMenu.Item class={touchSize ? 'min-h-11' : ''} onclick={openWorkspaceSettings}>
		<SettingsIcon class="mr-2 size-4 text-muted-foreground" />
		{m.sidebar_workspace_settings()}
	</DropdownMenu.Item>
{/if}
