<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { instanceStore } from '$lib/stores/instance.svelte';
	import { recreateClient } from '$lib/api/client';
	import { IS_CAPACITOR } from '$lib/env';
	import { m } from '$lib/paraglide/messages';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import LanguageSwitcher from './language-switcher.svelte';
	import WorkspaceMenuItems from './workspace-menu-items.svelte';
	import AnalyticsIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import CommunicationsIcon from '@lucide/svelte/icons/messages-square';
	import EditorsIcon from '@lucide/svelte/icons/clapperboard';
	import BellIcon from '@lucide/svelte/icons/bell';
	import AccountsIcon from '@lucide/svelte/icons/users';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import UserIcon from '@lucide/svelte/icons/user-round';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import ServerIcon from '@lucide/svelte/icons/server';
	import CheckIcon from '@lucide/svelte/icons/check';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square-text';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { ui } from '$lib/stores/ui.svelte';

	type AppearanceMode = 'system' | 'light' | 'dark';

	interface Props {
		showDestinations?: boolean;
		showEditors?: boolean;
		showSettings?: boolean;
		onNavigate?: () => void;
		onCreateWorkspace?: () => void;
	}

	let {
		showDestinations = false,
		showEditors = showDestinations,
		showSettings = showDestinations,
		onNavigate,
		onCreateWorkspace
	}: Props = $props();
	let workspacesExpanded = $state(false);
	const menuItemClass = $derived(showDestinations ? 'min-h-11' : '');

	function appearanceLabel(mode: AppearanceMode) {
		switch (mode) {
			case 'light':
				return m.sidebar_appearance_light();
			case 'dark':
				return m.sidebar_appearance_dark();
			default:
				return m.sidebar_appearance_system();
		}
	}

	function navigate(href: string) {
		onNavigate?.();
		goto(resolve(href as '/'));
	}

	async function handleLogout() {
		onNavigate?.();
		await auth.logout();
		await goto(resolve('/login' as '/'));
	}

	async function handleSwitchServer() {
		onNavigate?.();
		await auth.logout();
		instanceStore().clearInstanceUrl();
		recreateClient();
		await goto(resolve('/connect' as '/'));
	}
</script>

{#if showDestinations}
	<DropdownMenu.Label>{m.sidebar_workspace()}</DropdownMenu.Label>
	<DropdownMenu.Item
		class="min-h-11 gap-3"
		aria-expanded={workspacesExpanded}
		onSelect={(event) => {
			event.preventDefault();
			workspacesExpanded = !workspacesExpanded;
		}}
	>
		<BuildingIcon class="size-4 text-muted-foreground" />
		<div class="grid min-w-0 flex-1 text-start leading-tight">
			<span class="truncate"
				>{workspaceCtx.currentWorkspace?.name ?? m.sidebar_select_workspace()}</span
			>
			<span class="truncate text-xs text-muted-foreground">{m.sidebar_switch_workspace()}</span>
		</div>
		<ChevronDownIcon
			class={`ml-auto size-4 text-muted-foreground transition-transform ${workspacesExpanded ? 'rotate-180' : ''}`}
		/>
	</DropdownMenu.Item>
	{#if workspacesExpanded}
		<div
			class="border-l border-border/60 pl-2"
			role="group"
			aria-label={m.sidebar_switch_workspace()}
		>
			<WorkspaceMenuItems
				touchSize
				showLabel={false}
				onCreate={onCreateWorkspace}
				onSelect={() => {
					workspacesExpanded = false;
					onNavigate?.();
				}}
			/>
		</div>
	{/if}
	<DropdownMenu.Item>
		{#snippet child({ props })}
			<a
				{...props}
				class={[props.class, 'min-h-11 gap-3']}
				href={resolve('/engagement' as '/')}
				onclick={onNavigate}
			>
				<CommunicationsIcon class="size-4 text-muted-foreground" />
				{m.sidebar_communications()}
			</a>
		{/snippet}
	</DropdownMenu.Item>
	<DropdownMenu.Item>
		{#snippet child({ props })}
			<a
				{...props}
				class={[props.class, 'min-h-11 gap-3']}
				href={resolve('/notifications' as '/')}
				onclick={onNavigate}
			>
				<BellIcon class="size-4 text-muted-foreground" />
				{m.notifications_heading()}
			</a>
		{/snippet}
	</DropdownMenu.Item>
	<DropdownMenu.Item>
		{#snippet child({ props })}
			<a
				{...props}
				class={[props.class, 'min-h-11 gap-3']}
				href={resolve('/analytics' as '/')}
				onclick={onNavigate}
			>
				<AnalyticsIcon class="size-4 text-muted-foreground" />
				{m.sidebar_analytics()}
			</a>
		{/snippet}
	</DropdownMenu.Item>
	<DropdownMenu.Separator />
{/if}

{#if showEditors || showSettings}
	{#if showEditors}
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a
					{...props}
					class={[props.class, menuItemClass, 'gap-3']}
					href={resolve('/editors' as '/')}
					onclick={onNavigate}
				>
					<EditorsIcon class="size-4 text-muted-foreground" />
					{m.editors_title()}
				</a>
			{/snippet}
		</DropdownMenu.Item>
	{/if}
	{#if showSettings}
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a
					{...props}
					class={[props.class, menuItemClass, 'gap-3']}
					href={resolve('/settings?tab=accounts' as '/')}
					onclick={onNavigate}
				>
					<AccountsIcon class="size-4 text-muted-foreground" />
					{m.sidebar_accounts()}
				</a>
			{/snippet}
		</DropdownMenu.Item>
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a
					{...props}
					class={[props.class, menuItemClass, 'gap-3']}
					href={resolve('/settings' as '/')}
					onclick={onNavigate}
				>
					<SettingsIcon class="size-4 text-muted-foreground" />
					{m.sidebar_settings()}
				</a>
			{/snippet}
		</DropdownMenu.Item>
	{/if}
	<DropdownMenu.Separator />
{/if}

<DropdownMenu.Item
	class={[menuItemClass, 'gap-3']}
	onclick={() => navigate('/settings?tab=profile')}
>
	<UserIcon class="size-4 text-muted-foreground" />
	{m.sidebar_profile_security()}
</DropdownMenu.Item>
<DropdownMenu.Sub>
	<DropdownMenu.SubTrigger class={menuItemClass}>
		<PaletteIcon class="mr-2 size-4 text-muted-foreground" />
		{m.sidebar_appearance()}
		<span class="ml-auto text-muted-foreground capitalize"
			>{appearanceLabel(userPrefersMode.current as AppearanceMode)}</span
		>
	</DropdownMenu.SubTrigger>
	<DropdownMenu.SubContent class="w-44">
		{#each ['system', 'light', 'dark'] as appearance (appearance)}
			<DropdownMenu.Item
				class={menuItemClass}
				onclick={() => setMode(appearance as AppearanceMode)}
			>
				<span>{appearanceLabel(appearance as AppearanceMode)}</span>
				{#if userPrefersMode.current === appearance}
					<CheckIcon class="ml-auto size-4 text-primary" />
				{/if}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.SubContent>
</DropdownMenu.Sub>
<DropdownMenu.CheckboxItem
	class={menuItemClass}
	checked={soundPreferences.enabled}
	onCheckedChange={(checked) => soundPreferences.setEnabled(checked)}
>
	<Volume2Icon class="mr-2 size-4 text-muted-foreground" />
	{m.sidebar_interface_sounds()}
</DropdownMenu.CheckboxItem>
<LanguageSwitcher variant="menu" touchSize={showDestinations} />
<DropdownMenu.Item
	class={[menuItemClass, 'gap-3']}
	onclick={() => {
		onNavigate?.();
		ui.openFeedback();
	}}
>
	<MessageSquareIcon class="size-4 text-muted-foreground" />
	{m.feedback_open()}
</DropdownMenu.Item>
{#if IS_CAPACITOR}
	<DropdownMenu.Separator />
	<DropdownMenu.Item class={menuItemClass} onclick={handleSwitchServer}>
		<ServerIcon class="mr-2 size-4 text-muted-foreground" />
		{m.sidebar_change_server()}
	</DropdownMenu.Item>
{/if}
<DropdownMenu.Separator />
<DropdownMenu.Item class={menuItemClass} onclick={handleLogout}>
	<LogOutIcon class="mr-2 size-4 text-muted-foreground" />
	{m.sidebar_log_out()}
</DropdownMenu.Item>
