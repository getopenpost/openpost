<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		isNavigationItemActive,
		primaryNavigation,
		type PrimaryNavigationItem
	} from '$lib/app-navigation';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import Logo from './Logo.svelte';
	import SidebarPlanner from './sidebar-planner.svelte';
	import AccountPreferencesMenu from './account-preferences-menu.svelte';
	import WorkspaceMenuItems from './workspace-menu-items.svelte';
	import CalendarIcon from 'lucide-svelte/icons/calendar-days';
	import ComposeIcon from 'lucide-svelte/icons/square-pen';
	import PostsIcon from 'lucide-svelte/icons/files';
	import MediaIcon from 'lucide-svelte/icons/images';
	import AccountsIcon from 'lucide-svelte/icons/users';
	import SettingsIcon from 'lucide-svelte/icons/settings';
	import ChevronsUpDownIcon from 'lucide-svelte/icons/chevrons-up-down';
	import type { Workspace } from '$lib/api/client';

	let authState = $derived($auth);
	const sidebar = Sidebar.useSidebar();
	const currentPath = $derived(page.url.pathname);
	const currentWorkspaceName = $derived(
		workspaceCtx.currentWorkspace?.name ?? m.sidebar_select_workspace()
	);
	const currentWorkspaceAvatarURL = $derived(workspaceAvatarURL(workspaceCtx.currentWorkspace));
	const currentWorkspaceInitials = $derived(workspaceInitials(workspaceCtx.currentWorkspace));
	const userDisplayName = $derived(
		authState.user?.display_name || authState.user?.email?.split('@')[0] || m.common_untitled_user()
	);
	const userAvatarURL = $derived(authState.user?.avatar_url ?? '');
	const userInitials = $derived(initials(userDisplayName || authState.user?.email || 'User'));
	const navigationItems = $derived(
		primaryNavigation.map((item) => ({
			...item,
			label: navigationLabel(item.id),
			icon: navigationIcon(item.id)
		}))
	);
	const sidebarNavigationItems = $derived(navigationItems.filter((item) => item.id !== 'new'));
	const workspaceNavigationItems = $derived(
		navigationItems.filter((item) => ['posts', 'media', 'accounts', 'settings'].includes(item.id))
	);
	const showDesktopPlanner = $derived(!sidebar.isMobile && sidebar.state === 'expanded');
	const showHomeBrand = $derived(currentPath === '/' && !ui.activeComposerDraftId);

	function navigationIcon(id: PrimaryNavigationItem['id']) {
		switch (id) {
			case 'new':
				return ComposeIcon;
			case 'calendar':
				return CalendarIcon;
			case 'posts':
				return PostsIcon;
			case 'media':
				return MediaIcon;
			case 'accounts':
				return AccountsIcon;
			default:
				return SettingsIcon;
		}
	}

	function navigationLabel(id: PrimaryNavigationItem['id']) {
		switch (id) {
			case 'new':
				return m.sidebar_new_post();
			case 'calendar':
				return m.sidebar_calendar();
			case 'posts':
				return m.sidebar_activity();
			case 'media':
				return m.sidebar_media();
			case 'accounts':
				return m.sidebar_accounts();
			case 'settings':
				return m.sidebar_settings();
		}
	}

	function initials(value: string) {
		const parts = value
			.replace(/@.*/, '')
			.split(/[\s._-]+/)
			.filter(Boolean);
		return ((parts[0]?.[0] ?? 'O') + (parts[1]?.[0] ?? '')).toUpperCase();
	}

	function workspaceAvatarURL(workspace: Workspace | null | undefined) {
		return (
			(workspace as (Workspace & { avatar_url?: string }) | null | undefined)?.avatar_url ?? ''
		).trim();
	}

	function workspaceInitials(workspace: Workspace | null | undefined) {
		return initials(workspace?.name || 'Workspace');
	}

	function navigate(href: string) {
		sidebar.setOpenMobile(false);
		if (href === '/') ui.startNewPost();
		goto(resolve(href as '/'));
	}
</script>

<Sidebar.Root collapsible="icon" class="pt-[env(safe-area-inset-top)]">
	<Sidebar.Header class="gap-2 border-b border-sidebar-border p-2" data-testid="app-sidebar">
		<div class="relative h-10 overflow-hidden rounded-md">
			<a
				href={resolve('/')}
				class={[
					'sidebar-context-swap absolute inset-0 flex items-center gap-2 rounded-md px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
					!showHomeBrand && 'pointer-events-none'
				]}
				data-swap-position={showHomeBrand ? 'active' : 'before'}
				aria-label={m.sidebar_openpost_home()}
				aria-hidden={!showHomeBrand}
				tabindex={showHomeBrand ? undefined : -1}
				inert={!showHomeBrand}
				data-testid={showHomeBrand ? 'sidebar-home-brand' : undefined}
			>
				<Logo width={26} height={26} showText={sidebar.state !== 'collapsed'} />
			</a>

			<a
				href={resolve('/')}
				class={[
					'sidebar-context-swap absolute inset-0 flex items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-xs group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
					showHomeBrand && 'pointer-events-none'
				]}
				data-swap-position={showHomeBrand ? 'after' : 'active'}
				aria-label={m.sidebar_new_post()}
				aria-hidden={showHomeBrand}
				tabindex={showHomeBrand ? -1 : undefined}
				inert={showHomeBrand}
				data-testid={!showHomeBrand ? 'sidebar-new-post' : undefined}
				onclick={() => ui.startNewPost()}
			>
				<ComposeIcon class="size-4" />
				{#if sidebar.state !== 'collapsed'}<span>{m.sidebar_new_post()}</span>{/if}
			</a>
		</div>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						size="lg"
						class="border border-sidebar-border bg-sidebar-accent/35 data-[state=open]:bg-sidebar-accent"
						tooltipContent={m.sidebar_switch_workspace()}
					>
						<Avatar.Root class="size-8 rounded-md">
							{#if currentWorkspaceAvatarURL}
								<Avatar.Image src={currentWorkspaceAvatarURL} alt={currentWorkspaceName} />
							{/if}
							<Avatar.Fallback class="rounded-md bg-primary/12 text-xs font-semibold text-primary">
								{currentWorkspaceInitials}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid min-w-0 flex-1 text-start leading-tight">
							<span class="truncate text-sm font-medium">{currentWorkspaceName}</span>
							<span class="truncate text-xs text-sidebar-foreground/62"
								>{m.sidebar_workspace()}</span
							>
						</div>
						<ChevronsUpDownIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-64"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="start"
				sideOffset={6}
			>
				<WorkspaceMenuItems onSelect={() => sidebar.setOpenMobile(false)} />
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.Header>

	<Sidebar.Content class={showDesktopPlanner ? 'overflow-hidden py-2' : 'px-2 py-3'}>
		{#if showDesktopPlanner}
			<SidebarPlanner onNavigate={navigate} />
		{:else}
			<Sidebar.Group class="p-0">
				<Sidebar.GroupLabel
					class="px-2 text-[11px] tracking-[0.12em] text-sidebar-foreground/48 uppercase"
				>
					{m.sidebar_publish()}
				</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu class="gap-1">
						{#each sidebarNavigationItems as item (item.id)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={isNavigationItemActive(item, currentPath)}
									class="h-10 text-sm"
									tooltipContent={item.label}
									onclick={() => navigate(item.href)}
								>
									<item.icon class="size-4" />
									<span>{item.label}</span>
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/if}
	</Sidebar.Content>

	<Sidebar.Footer class="border-t border-sidebar-border p-2" data-testid="sidebar-workspace-footer">
		{#if showDesktopPlanner}
			<div class="pb-1">
				<p
					class="flex h-7 items-center px-2 text-[11px] tracking-[0.1em] text-sidebar-foreground/52 uppercase"
				>
					{m.sidebar_workspace()}
				</p>
				<Sidebar.Menu class="grid grid-cols-2 gap-1">
					{#each workspaceNavigationItems as item (item.id)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={isNavigationItemActive(item, currentPath)}
								class="h-9 gap-1.5 px-2 text-xs"
								tooltipContent={item.label}
								onclick={() => navigate(item.href)}
							>
								<item.icon class="size-3.5" />
								<span>{item.label}</span>
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</div>
		{/if}
		<Sidebar.Menu class={showDesktopPlanner ? 'border-t border-sidebar-border pt-1' : ''}>
			<Sidebar.MenuItem>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton
								{...props}
								size="lg"
								class="data-[state=open]:bg-sidebar-accent"
								tooltipContent={m.sidebar_profile_appearance()}
								data-testid="profile-menu-trigger"
							>
								<Avatar.Root class="size-8 rounded-full">
									{#if userAvatarURL}<Avatar.Image src={userAvatarURL} alt={userDisplayName} />{/if}
									<Avatar.Fallback
										class="bg-sidebar-primary text-xs text-sidebar-primary-foreground"
									>
										{userInitials}
									</Avatar.Fallback>
								</Avatar.Root>
								<div class="grid min-w-0 flex-1 text-start leading-tight">
									<span class="truncate text-sm font-medium">{userDisplayName}</span>
									<span class="truncate text-xs text-sidebar-foreground/62"
										>{authState.user?.email}</span
									>
								</div>
								<ChevronsUpDownIcon class="ms-auto size-4" />
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						class="w-60"
						side={sidebar.isMobile ? 'bottom' : 'right'}
						align="end"
						sideOffset={6}
					>
						<AccountPreferencesMenu onNavigate={() => sidebar.setOpenMobile(false)} />
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>

<style>
	.sidebar-context-swap {
		transition:
			transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 200ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.sidebar-context-swap[data-swap-position='active'] {
		transform: translateX(0);
		opacity: 1;
	}

	.sidebar-context-swap[data-swap-position='before'] {
		transform: translateX(-100%);
		opacity: 0;
	}

	.sidebar-context-swap[data-swap-position='after'] {
		transform: translateX(100%);
		opacity: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.sidebar-context-swap {
			transition: none;
		}
	}
</style>
