<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { get } from 'svelte/store';
	import { resolveAppPath } from '$lib/app-path';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import LanguageSwitcher from './language-switcher.svelte';
	import WorkspaceMenuItems from './workspace-menu-items.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { ui } from '$lib/stores/ui.svelte';
	import { openTelemetryPreferences } from '@openpost/telemetry';

	type AppearanceMode = 'system' | 'light' | 'dark';

	interface Props {
		showDestinations?: boolean;
		showEditors?: boolean;
		showSettings?: boolean;
		inlineAppearance?: boolean;
		onNavigate?: () => void;
		onCreateWorkspace?: () => void;
	}

	let {
		showDestinations = false,
		showEditors = showDestinations,
		showSettings = showDestinations,
		inlineAppearance = false,
		onNavigate,
		onCreateWorkspace
	}: Props = $props();
	let workspacesExpanded = $state(false);
	let appearanceExpanded = $state(false);
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
		goto(resolveAppPath(href));
	}

	async function handleLogout() {
		const route = `${window.location.pathname}${window.location.search}`;
		onNavigate?.();
		if (
			!(await auth.logout()) ||
			get(auth).user ||
			`${window.location.pathname}${window.location.search}` !== route
		)
			return;
		await goto(resolveAppPath('/login'));
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
		<ThemeIcon role="organization" class="size-4 text-muted-foreground" />
		<div class="grid min-w-0 flex-1 text-start leading-tight">
			<span class="truncate"
				>{workspaceCtx.currentWorkspace?.name ?? m.sidebar_select_workspace()}</span
			>
			<span class="truncate text-xs text-muted-foreground">{m.sidebar_switch_workspace()}</span>
		</div>
		<ThemeIcon
			role="chevron-down"
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
				href={resolve('/inbox/engagement' as '/')}
				onclick={onNavigate}
			>
				<ThemeIcon role="communications" class="size-4 text-muted-foreground" />
				{m.sidebar_communications()}
			</a>
		{/snippet}
	</DropdownMenu.Item>
	<DropdownMenu.Item>
		{#snippet child({ props })}
			<a
				{...props}
				class={[props.class, 'min-h-11 gap-3']}
				href={resolve('/inbox/notifications' as '/')}
				onclick={onNavigate}
			>
				<ThemeIcon role="notification" class="size-4 text-muted-foreground" />
				{m.notifications_heading()}
			</a>
		{/snippet}
	</DropdownMenu.Item>
	<DropdownMenu.Item>
		{#snippet child({ props })}
			<a
				{...props}
				class={[props.class, 'min-h-11 gap-3']}
				href={resolve('/grow' as '/')}
				onclick={onNavigate}
			>
				<ThemeIcon role="growth" class="size-4 text-muted-foreground" />
				{m.sidebar_grow()}
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
				<ThemeIcon role="analytics" class="size-4 text-muted-foreground" />
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
					<ThemeIcon role="editors" class="size-4 text-muted-foreground" />
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
					<ThemeIcon role="users" class="size-4 text-muted-foreground" />
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
					<ThemeIcon role="settings" class="size-4 text-muted-foreground" />
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
	<ThemeIcon role="user" class="size-4 text-muted-foreground" />
	{m.sidebar_profile_security()}
</DropdownMenu.Item>
{#if inlineAppearance}
	<DropdownMenu.Item
		class={[menuItemClass, 'gap-3']}
		aria-expanded={appearanceExpanded}
		onSelect={(event) => {
			event.preventDefault();
			appearanceExpanded = !appearanceExpanded;
		}}
	>
		<ThemeIcon role="appearance" class="size-4 text-muted-foreground" />
		{m.sidebar_appearance()}
		<span class="ml-auto text-muted-foreground capitalize"
			>{appearanceLabel(userPrefersMode.current as AppearanceMode)}</span
		>
		<ThemeIcon
			role="chevron-down"
			class={`size-4 text-muted-foreground transition-transform ${appearanceExpanded ? 'rotate-180' : ''}`}
		/>
	</DropdownMenu.Item>
	{#if appearanceExpanded}
		<div
			class="grid gap-0.5 border-l border-border/60 pl-8"
			role="group"
			aria-label={m.sidebar_appearance()}
		>
			{#each ['system', 'light', 'dark'] as appearance (appearance)}
				<DropdownMenu.Item
					class={menuItemClass}
					onclick={() => setMode(appearance as AppearanceMode)}
				>
					<span>{appearanceLabel(appearance as AppearanceMode)}</span>
					{#if userPrefersMode.current === appearance}
						<ThemeIcon role="check" class="ml-auto size-4 text-primary" />
					{/if}
				</DropdownMenu.Item>
			{/each}
		</div>
	{/if}
{:else}
	<DropdownMenu.Sub>
		<DropdownMenu.SubTrigger class={menuItemClass}>
			<ThemeIcon role="appearance" class="mr-2 size-4 text-muted-foreground" />
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
						<ThemeIcon role="check" class="ml-auto size-4 text-primary" />
					{/if}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.SubContent>
	</DropdownMenu.Sub>
{/if}
<DropdownMenu.CheckboxItem
	class={menuItemClass}
	data-cuelume-toggle={undefined}
	checked={soundPreferences.enabled}
	onCheckedChange={(checked) => soundPreferences.setEnabled(checked)}
>
	<ThemeIcon role="audio" class="mr-2 size-4 text-muted-foreground" />
	{m.sidebar_interface_sounds()}
</DropdownMenu.CheckboxItem>
<LanguageSwitcher variant="menu" touchSize={showDestinations} />
<DropdownMenu.Item
	class={[menuItemClass, 'gap-3']}
	onclick={() => {
		onNavigate?.();
		openTelemetryPreferences();
	}}
>
	<ThemeIcon role="controls" class="size-4 text-muted-foreground" />
	{m.telemetry_consent_preferences()}
</DropdownMenu.Item>
<DropdownMenu.Item
	class={[menuItemClass, 'gap-3']}
	onclick={() => {
		onNavigate?.();
		ui.openFeedback();
	}}
>
	<ThemeIcon role="feedback" class="size-4 text-muted-foreground" />
	{m.feedback_open()}
</DropdownMenu.Item>
<DropdownMenu.Separator />
<DropdownMenu.Item class={menuItemClass} onclick={handleLogout}>
	<ThemeIcon role="logout" class="mr-2 size-4 text-muted-foreground" />
	{m.sidebar_log_out()}
</DropdownMenu.Item>
