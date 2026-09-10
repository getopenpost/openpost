<script lang="ts">
	import { publicationView } from '$lib/stores/publication-view.svelte';
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
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';
	import type { Workspace } from '$lib/api/client';
	import NotificationBell from './notification-bell.svelte';
	import { Button } from '$lib/components/ui/button';

	let authState = $derived($auth);
	let createWorkspaceOpen = $state(false);
	let profileMenuOpen = $state(false);
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
	const workspaceNavigationItems = $derived(
		navigationItems.filter((item) =>
			['publications', 'communications', 'analytics', 'media'].includes(item.id)
		)
	);
	const sidebarNavigationItems = $derived(workspaceNavigationItems);
	const moreNavigationItems = $derived(
		navigationItems.filter((item) => ['growth', 'editors'].includes(item.id))
	);
	const showDesktopPlanner = $derived(!sidebar.isMobile && sidebar.state === 'expanded');

	function navigationIcon(id: PrimaryNavigationItem['id']): ThemeIconRole {
		switch (id) {
			case 'new':
				return 'compose';
			case 'calendar':
				return 'calendar';
			case 'publications':
				return 'publications';
			case 'analytics':
				return 'analytics';
			case 'growth':
				return 'growth';
			case 'communications':
				return 'communications';
			case 'media':
				return 'media';
			case 'editors':
				return 'editors';
			default:
				return 'settings';
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
		goto(resolveAppPath(href === '/publications' ? publicationView.href : href));
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
		<div class="flex items-center gap-2 group-data-[collapsible=icon]:flex-col">
			<a
				href={resolve('/')}
				class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				aria-label={m.sidebar_openpost_home()}
				data-testid="sidebar-home-brand"
			>
				<Logo width={26} height={26} showText={sidebar.state !== 'collapsed'} decorative />
			</a>

			<div class="ms-auto flex shrink-0 items-center gap-0.5">
				{#if sidebar.state !== 'collapsed'}<NotificationBell compact />{/if}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								type="button"
								class="inline-flex size-8 items-center justify-center rounded-md hover:bg-navigation-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[state=open]:bg-sidebar-accent"
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
		</div>

		<div class="flex items-stretch gap-1 group-data-[collapsible=icon]:flex-col">
			<Button
				href={resolve('/')}
				variant="focal"
				size="sm"
				class="min-w-0 flex-1 gap-2 group-data-[collapsible=icon]:px-0"
				aria-label={m.sidebar_new_post()}
				data-testid="sidebar-new-post"
				onclick={handleNewPostClick}
			>
				<ThemeIcon role="compose" class="size-4" />
				{#if sidebar.state !== 'collapsed'}<span>{m.sidebar_new_post()}</span>{/if}
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}<Button
							{...props}
							variant="outline"
							size="sm"
							class="w-9 px-0 group-data-[collapsible=icon]:w-full"
							aria-label={m.sidebar_new()}
							data-testid="sidebar-new-post-menu"
							><ThemeIcon role="chevron-down" class="size-4" /></Button
						>{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start">
					<DropdownMenu.Item onclick={() => navigate('/image-editor')}
						><ThemeIcon role="image" class="size-4" />{m.image_editor_title()}</DropdownMenu.Item
					>
					<DropdownMenu.Item onclick={() => navigate('/video-editor')}
						><ThemeIcon role="video" class="size-4" />{m.video_editor_title()}</DropdownMenu.Item
					>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
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
									<ThemeIcon role={item.icon} class="size-4" />
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
			<Sidebar.Menu class="gap-0.5" data-testid="sidebar-workspace-navigation">
				{#each workspaceNavigationItems as item (item.id)}
					<Sidebar.MenuItem
						><Sidebar.MenuButton
							class="h-9 text-sm [@media(pointer:coarse)]:h-11"
							tooltipContent={item.label}
							isActive={isSidebarNavigationItemActive(item)}
							onclick={() => navigate(item.href)}
							><ThemeIcon role={item.icon} class="size-4" /><span>{item.label}</span
							></Sidebar.MenuButton
						></Sidebar.MenuItem
					>
				{/each}
			</Sidebar.Menu>
		{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}<Sidebar.MenuButton
						{...props}
						class="h-9 [@media(pointer:coarse)]:h-11"
						tooltipContent={m.sidebar_more()}
						isActive={moreNavigationItems.some(isSidebarNavigationItemActive)}
						><ThemeIcon role="more-horizontal" class="size-4" /><span>{m.sidebar_more()}</span
						></Sidebar.MenuButton
					>{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="right" align="end" class="w-52">
				{#each moreNavigationItems as item (item.id)}
					<DropdownMenu.Item
						class="min-h-9 gap-3 [@media(pointer:coarse)]:min-h-11"
						onclick={() => navigate(item.href)}
						><ThemeIcon role={item.icon} class="size-4" />{item.label}</DropdownMenu.Item
					>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Sidebar.Menu
			class={showDesktopPlanner ? 'border-t border-sidebar-border pt-1' : ''}
			data-testid="sidebar-secondary-navigation"
		>
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
								<ThemeIcon
									role="more-horizontal"
									class="ms-auto size-4 text-sidebar-foreground/70"
								/>
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
