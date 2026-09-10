<script lang="ts">
	import { tick } from 'svelte';
	import { primaryNavigation } from '$lib/app-navigation';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import WorkspaceMenuItems from './workspace-menu-items.svelte';
	import AccountPreferencesMenu from './account-preferences-menu.svelte';
	const destinations = $derived(
		primaryNavigation.filter((item) => ['analytics', 'growth', 'editors'].includes(item.id))
	);
	let { onNavigate }: { onNavigate: () => void } = $props();
	let section = $state<'main' | 'workspace' | 'profile'>('main');
	let backItem = $state<HTMLDivElement | null>(null);
	let workspaceItem = $state<HTMLDivElement | null>(null);
	let profileItem = $state<HTMLDivElement | null>(null);

	async function openSection(event: Event, next: 'workspace' | 'profile') {
		event.preventDefault();
		section = next;
		await tick();
		backItem?.focus();
	}

	async function goBack(event: Event) {
		event.preventDefault();
		const previous = section;
		section = 'main';
		await tick();
		(previous === 'workspace' ? workspaceItem : profileItem)?.focus();
	}
</script>

{#if section !== 'main'}
	<DropdownMenu.Item class="min-h-11 gap-3" bind:ref={backItem} onSelect={goBack}
		><ThemeIcon role="chevron-left" class="size-4" />{m.common_back()}</DropdownMenu.Item
	>
	<DropdownMenu.Separator />
{/if}
{#if section === 'workspace'}
	<WorkspaceMenuItems touchSize onSelect={onNavigate} />
{:else if section === 'profile'}
	<AccountPreferencesMenu {onNavigate} />
{:else}
	{#each destinations as item (item.id)}
		<DropdownMenu.Item
			class="min-h-11 gap-3"
			onclick={() => {
				onNavigate();
				goto(resolveAppPath(item.href));
			}}
			><ThemeIcon
				role={item.id === 'analytics' ? 'analytics' : item.id === 'growth' ? 'growth' : 'editors'}
				class="size-4"
			/>{item.id === 'analytics'
				? m.sidebar_analytics()
				: item.id === 'growth'
					? m.sidebar_grow()
					: m.editors_title()}</DropdownMenu.Item
		>
	{/each}
	<DropdownMenu.Separator />
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		bind:ref={workspaceItem}
		onSelect={(event) => openSection(event, 'workspace')}
		><ThemeIcon role="organization" class="size-4" />{m.sidebar_workspace()}<ThemeIcon
			role="chevron-right"
			class="ml-auto size-4"
		/></DropdownMenu.Item
	>
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		bind:ref={profileItem}
		onSelect={(event) => openSection(event, 'profile')}
		><ThemeIcon role="user" class="size-4" />{m.personal_profile()}<ThemeIcon
			role="chevron-right"
			class="ml-auto size-4"
		/></DropdownMenu.Item
	>
{/if}
