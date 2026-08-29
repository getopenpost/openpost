<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { auth } from '$lib/stores/auth';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { getAuthenticatedMediaURL } from '$lib/media-url';
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
	import CreateWorkspaceDialog from './create-workspace-dialog.svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import ComposeIcon from '@lucide/svelte/icons/square-pen';
	import PostsIcon from '@lucide/svelte/icons/files';
	import CommunicationsIcon from '@lucide/svelte/icons/messages-square';
	import AnalyticsIcon from '@lucide/svelte/icons/chart-no-axes-combined';
	import GrowthIcon from '@lucide/svelte/icons/user-round-plus';
	import MediaIcon from '@lucide/svelte/icons/images';
	import EditorsIcon from '@lucide/svelte/icons/clapperboard';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import MoreHorizontalIcon from '@lucide/svelte/icons/ellipsis';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { Workspace } from '$lib/api/client';
	import NotificationBell from './notification-bell.svelte';
	import { Button } from '$lib/components/ui/button';

	let authState = $derived($auth);
	let createWorkspaceOpen = $state(false);
	let profileMenuOpen = $state(false);
	let workspaceNavigationExpanded = $state(true);
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
	const sidebarNavigationItems = $derived(
		navigationItems.filter((item) =>
			['calendar', 'publications', 'communications', 'growth', 'analytics', 'media'].includes(item.id)
		)
	);
	const workspaceNavigationItems = $derived([
		...navigationItems.filter((item) =>
			['calendar', 'publications', 'communications', 'growth', 'analytics', 'media'].includes(item.id)
		)
	]);
	const showDesktopPlanner = $derived(!sidebar.isMobile && sidebar.state === 'expanded');
	const workspaceNavigationToggleLabel = $derived(
		workspaceNavigationExpanded
			? m.sidebar_collapse_workspace_navigation()
			: m.sidebar_expand_workspace_navigation()
	);

	function navigationIcon(id: PrimaryNavigationItem['id']) {
		switch (id) {
			case 'new':
				return ComposeIcon;
			case 'calendar':
				return CalendarIcon;
			case 'publications':
				return PostsIcon;
			case 'analytics':
				return AnalyticsIcon;
			case 'growth':
				return GrowthIcon;
			case 'communications':
				return CommunicationsIcon;
			case 'media':
				return MediaIcon;
			case 'editors':
				return EditorsIcon;
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
			case 'publications':
				return m.sidebar_activity();
			case 'analytics':
				return m.sidebar_analytics();
			case 'growth':
				return m.sidebar_grow();
			case 'communications':
				return m.sidebar_communications();
			case 'media':
				return m.sidebar_media();
			case 'editors':
				return m.editors_title();
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
		return getAuthenticatedMediaURL(workspace?.avatar_url.trim() ?? '');
	}

	function workspaceInitials(workspace: Workspace | null | undefined) {
		return initials(workspace?.name || 'Workspace');
	}

	function openCreateWorkspace() {
		sidebar.setOpenMobile(false);
		createWorkspaceOpen = true;
	}

	function navigate(href: string) {
		sidebar.setOpenMobile(false);
		if (href === '/') {
			if (!ui.startNewPost()) return;
			if (currentPath === '/') return;
		}
		goto(resolveAppPath(href));
	}

	function handleNewPostClick(event: MouseEvent) {
		sidebar.setOpenMobile(false);
		if (!ui.startNewPost() || currentPath === '/') event.preventDefault();
	}

	function isSidebarNavigationItemActive(item: PrimaryNavigationItem) {
		return isNavigationItemActive(item, currentPath);
	}
</script>

<Sidebar.Root collapsible="icon" class="pt-[env(safe-area-inset-top)]">
	<Sidebar.Header class="gap-2 border-b border-sidebar-border p-2" data-testid="app-sidebar">
		<div class="flex h-8 items-center gap-2">
			<a
				href={resolve('/')}
				class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				aria-label={m.sidebar_openpost_home()}
				data-testid="sidebar-home-brand"
			>
				<Logo width={26} height={26} showText={sidebar.state !== 'collapsed'} decorative />
			</a>

			{#if sidebar.state !== 'collapsed'}
				<div class="ms-auto flex shrink-0 items-center gap-0.5">
					<NotificationBell compact />
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="inline-flex size-8 items-center justify-center rounded-md hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[state=open]:bg-sidebar-accent"
									aria-label={`${m.sidebar_switch_workspace()}: ${currentWorkspaceName}`}
									title={m.sidebar_switch_workspace()}
									data-testid="workspace-menu-trigger"
								>
									<Avatar.Root class="size-7 rounded-md">
										{#if currentWorkspaceAvatarURL}
											<Avatar.Image src={currentWorkspaceAvatarURL} alt={currentWorkspaceName} />
										{/if}
										<Avatar.Fallback
											class="rounded-md bg-sidebar-accent text-[10px] font-semibold text-sidebar-foreground"
										>
											{currentWorkspaceInitials}
										</Avatar.Fallback>
									</Avatar.Root>
									<span class="sr-only">{currentWorkspaceName}</span>
								</button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content class="w-64" side="right" align="start" sideOffset={6}>
							<WorkspaceMenuItems
								onCreate={openCreateWorkspace}
								onSelect={() => sidebar.setOpenMobile(false)}
							/>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			{/if}
		</div>

		<Button
			href={resolve('/')}
			size="sm"
			class="h-10 w-full gap-2 group-data-[collapsible=icon]:px-0"
			aria-label={m.sidebar_new_post()}
			data-testid="sidebar-new-post"
			onclick={handleNewPostClick}
		>
			<ComposeIcon class="size-4" />
			{#if sidebar.state !== 'collapsed'}<span>{m.sidebar_new_post()}</span>{/if}
		</Button>
	</Sidebar.Header>

	<Sidebar.Content class={showDesktopPlanner ? 'overflow-hidden pt-2' : 'px-2 py-3'}>
		{#if showDesktopPlanner}
			<SidebarPlanner onNavigate={navigate} />
		{:else}
			<Sidebar.Group class="p-0">
				<Sidebar.GroupContent>
					<Sidebar.Menu class="gap-0.5">
						{#each sidebarNavigationItems as item (item.id)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={isSidebarNavigationItemActive(item)}
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
				<div class="flex items-center justify-center">
					<button
						type="button"
						class="inline-flex size-6 items-center justify-center rounded-md text-sidebar-foreground/48 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
						aria-expanded={workspaceNavigationExpanded}
						aria-controls="sidebar-workspace-navigation"
						aria-label={workspaceNavigationToggleLabel}
						title={workspaceNavigationToggleLabel}
						onclick={() => (workspaceNavigationExpanded = !workspaceNavigationExpanded)}
					>
						<ChevronDownIcon
							class={[
								'size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none',
								!workspaceNavigationExpanded && '-rotate-180'
							]}
						/>
					</button>
				</div>
				<div
					id="sidebar-workspace-navigation"
					data-testid="sidebar-workspace-navigation"
					class={[
						'workspace-navigation-collapse',
						workspaceNavigationExpanded && 'workspace-navigation-expanded'
					]}
					aria-hidden={!workspaceNavigationExpanded}
					inert={!workspaceNavigationExpanded}
				>
					<div>
						<Sidebar.Menu class="gap-0.5">
							{#each workspaceNavigationItems as item (item.id)}
								<Sidebar.MenuItem>
									<Sidebar.MenuButton
										isActive={isSidebarNavigationItemActive(item)}
										class="h-8 gap-2 px-2 text-xs"
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
				</div>
			</div>
		{/if}
		<Sidebar.Menu
			class={showDesktopPlanner ? 'border-t border-sidebar-border pt-1' : ''}
			data-testid="sidebar-secondary-navigation"
		>
			{#if !showDesktopPlanner}
				<Sidebar.MenuItem>
					<Sidebar.MenuButton
						class="h-10 text-sm"
						tooltipContent={m.editors_title()}
						isActive={currentPath.startsWith('/editors')}
						onclick={() => navigate('/editors')}
					>
						<EditorsIcon class="size-4" />
						<span>{m.editors_title()}</span>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			{/if}
			{#if sidebar.state === 'collapsed'}
				<NotificationBell />
			{/if}
			<Sidebar.MenuItem>
				<DropdownMenu.Root bind:open={profileMenuOpen}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Sidebar.MenuButton
								{...props}
								size="lg"
								class="data-[state=open]:bg-sidebar-accent"
								tooltipContent={m.sidebar_profile_appearance()}
								data-testid="profile-menu-trigger"
							>
								<Avatar.Root class="size-8 rounded-md">
									{#if userAvatarURL}<Avatar.Image src={userAvatarURL} alt={userDisplayName} />{/if}
									<Avatar.Fallback
										class="rounded-md bg-sidebar-accent text-xs font-semibold text-sidebar-foreground"
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
								<MoreHorizontalIcon class="ms-auto size-4 text-sidebar-foreground/70" />
							</Sidebar.MenuButton>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content
						class="w-60"
						side={sidebar.isMobile ? 'bottom' : 'right'}
						align="end"
						sideOffset={6}
					>
						<AccountPreferencesMenu
							showDestinations={sidebar.state === 'collapsed'}
							showEditors={showDesktopPlanner}
							showSettings
							onCreateWorkspace={openCreateWorkspace}
							onNavigate={() => {
								profileMenuOpen = false;
								sidebar.setOpenMobile(false);
							}}
						/>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>

<CreateWorkspaceDialog bind:open={createWorkspaceOpen} />

<style>
	.workspace-navigation-collapse {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows 220ms cubic-bezier(0.25, 1, 0.5, 1),
			opacity 140ms ease-out;
	}

	.workspace-navigation-collapse > div {
		min-height: 0;
		overflow: hidden;
	}

	.workspace-navigation-expanded {
		grid-template-rows: 1fr;
		opacity: 1;
	}
</style>
