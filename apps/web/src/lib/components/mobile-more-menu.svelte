<script lang="ts">
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { tick } from 'svelte';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { primaryNavigation, type PrimaryNavigationItem } from '$lib/app-navigation';
	import type { ThemeIconRole } from '$lib/themes';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import WorkspaceMenuItems from './workspace-menu-items.svelte';
	import AccountPreferencesMenu from './account-preferences-menu.svelte';
	const destinations = $derived(
		primaryNavigation.filter((item) =>
			['analytics', 'ideate', 'studio', 'media', 'workflows', 'accounts', 'settings'].includes(
				item.id
			)
		)
	);
	let { onNavigate }: { onNavigate: () => void } = $props();

	function itemIcon(id: PrimaryNavigationItem['id']): ThemeIconRole {
		const roles: Partial<Record<PrimaryNavigationItem['id'], ThemeIconRole>> = {
			analytics: 'analytics',
			ideate: 'sparkles',
			studio: 'editors',
			media: 'media',
			workflows: 'repeat',
			accounts: 'organization'
		};
		return roles[id] ?? 'settings';
	}

	function itemLabel(id: PrimaryNavigationItem['id']) {
		const labels: Partial<Record<PrimaryNavigationItem['id'], () => string>> = {
			analytics: m.sidebar_analytics,
			ideate: m.nav_ideas,
			studio: m.nav_studio,
			media: m.sidebar_media,
			workflows: m.nav_automations,
			accounts: m.sidebar_accounts
		};
		return (labels[id] ?? m.sidebar_settings)();
	}
	let section = $state<'main' | 'workspace' | 'profile'>('main');
	let backItem = $state<HTMLDivElement | null>(null);
	let workspaceItem = $state<HTMLDivElement | null>(null);
	let profileItem = $state<HTMLDivElement | null>(null);

	async function openSection(next: 'workspace' | 'profile') {
		section = next;
		await tick();
		backItem?.focus();
	}

	async function goBack() {
		const previous = section;
		section = 'main';
		await tick();
		(previous === 'workspace' ? workspaceItem : profileItem)?.focus();
	}
</script>

{#if section !== 'main'}
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		bind:ref={backItem}
		closeOnSelect={false}
		onSelect={goBack}
		><ThemeIcon role="chevron-left" class="size-4" />{m.common_back()}</DropdownMenu.Item
	>
	<DropdownMenu.Separator />
{/if}
{#if section === 'workspace'}
	<WorkspaceMenuItems touchSize onSelect={onNavigate} />
{:else if section === 'profile'}
	<AccountPreferencesMenu {onNavigate} />
{:else}
	{#each destinations.filter((item) => item.id !== 'ideate' || workspaceCtx.currentWorkspace?.can_edit) as item (item.id)}
		<DropdownMenu.Item
			class="min-h-11 gap-3"
			onclick={() => {
				onNavigate();
				if (item.id === 'ideate') {
					ideate.show();
					return;
				}
				goto(resolveAppPath(item.href));
			}}
			><ThemeIcon role={itemIcon(item.id)} class="size-4" />{itemLabel(item.id)}</DropdownMenu.Item
		>
	{/each}
	<DropdownMenu.Separator />
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		onclick={() => {
			onNavigate();
			ui.openFeedback();
		}}><ThemeIcon role="feedback" class="size-4" />{m.feedback_open()}</DropdownMenu.Item
	>
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		bind:ref={workspaceItem}
		closeOnSelect={false}
		onSelect={() => openSection('workspace')}
		><ThemeIcon role="organization" class="size-4" />{m.sidebar_workspace()}<ThemeIcon
			role="chevron-right"
			class="ml-auto size-4"
		/></DropdownMenu.Item
	>
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		bind:ref={profileItem}
		closeOnSelect={false}
		onSelect={() => openSection('profile')}
		><ThemeIcon role="user" class="size-4" />{m.personal_profile()}<ThemeIcon
			role="chevron-right"
			class="ml-auto size-4"
		/></DropdownMenu.Item
	>
{/if}
