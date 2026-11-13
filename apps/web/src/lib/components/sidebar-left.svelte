<script lang="ts">
	import { appBranding } from '$lib/app-branding.svelte';
	import { sidebarPreferences } from '$lib/stores/sidebar-preferences.svelte';
	import { publicationView } from '$lib/stores/publication-view.svelte';
	import { ideate } from '$lib/post-builder/ideate.svelte';
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
		makeNavigation,
		overviewNavigation,
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
	const withPresentation = (item: PrimaryNavigationItem) => ({
		...item,
		label: navigationLabel(item.id),
		icon: navigationIcon(item.id)
	});
	const overviewItems = $derived(overviewNavigation.map(withPresentation));
	const makeItems = $derived(
		makeNavigation
			.filter((item) => item.id !== 'ideate' || workspaceCtx.currentWorkspace?.can_edit)
			.map(withPresentation)
	);
	const footerItems = $derived(
		primaryNavigation
			.filter((item) => item.id === 'accounts' || item.id === 'settings')
			.map(withPresentation)
	);
	const showDrafts = $derived(
		sidebarPreferences.draftsVisible && !sidebar.isMobile && sidebar.state === 'expanded'
	);

	function navigationIcon(id: PrimaryNavigationItem['id']): ThemeIconRole {
		switch (id) {
			case 'new':
				return 'compose';
			case 'publications':
				return 'publications';
			case 'analytics':
				return 'analytics';
			case 'ideate':
				return 'sparkles';
			case 'communications':
				return 'communications';
			case 'media':
				return 'media';
			case 'workflows':
				return 'repeat';
			case 'studio':
				return 'editors';
			case 'accounts':
				return 'organization';
			default:
				return 'settings';
		}
	}

	function navigationLabel(id: PrimaryNavigationItem['id']) {
		switch (id) {
			case 'new':
				return m.sidebar_new_post();
			case 'publications':
				return m.sidebar_activity();
			case 'analytics':
				return m.sidebar_analytics();
			case 'ideate':
				return m.nav_ideas();
			case 'communications':
				return m.sidebar_communications();
			case 'media':
				return m.sidebar_media();
			case 'workflows':
				return m.nav_automations();
			case 'studio':
				return m.nav_studio();
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
		if (href === '/ideate') {
			ideate.show();
			return;
		}
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

{#snippet navigationList(items: ReturnType<typeof withPresentation>[], testId: string)}
	<Sidebar.Group class="shrink-0 p-0">
		<Sidebar.GroupContent>
			<Sidebar.Menu class="gap-0.5" data-testid={testId}>
				{#each items as item (item.id)}
					<Sidebar.MenuItem>
						<Sidebar.MenuButton
							isActive={isSidebarNavigationItemActive(item)}
							class="h-9 text-sm [@media(pointer:coarse)]:h-11"
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
{/snippet}

<Sidebar.Root collapsible="icon" class="pt-[env(safe-area-inset-top)]">
	<Sidebar.Header class="gap-2 p-2" data-testid="app-sidebar">
		<div class="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
			<a
				href={resolve('/publications')}
				class="flex size-9 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
				aria-label={m.app_branding_home({ name: appBranding.profile.display_name })}
				data-testid="sidebar-home-brand"
			>
				<Logo width={24} height={24} showText={false} decorative />
			</a>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-start group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center hover:bg-navigation-hover focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none data-[state=open]:bg-navigation-hover"
							aria-label={`${m.sidebar_switch_workspace()}: ${currentWorkspaceName}`}
							title={m.sidebar_switch_workspace()}
							data-testid="workspace-menu-trigger"
						>
							{#if sidebar.state === 'collapsed'}
								<Avatar.Root class="size-7 rounded-md">
									{#if currentWorkspaceAvatarURL}
										<Avatar.Image src={currentWorkspaceAvatarURL} alt={currentWorkspaceName} />
									{/if}
									<Avatar.Fallback
										class="rounded-md bg-sidebar-accent text-xs font-semibold text-sidebar-foreground"
									>
										{currentWorkspaceInitials}
									</Avatar.Fallback>
								</Avatar.Root>
							{:else}
								<span class="min-w-0 flex-1 truncate text-sm font-semibold"
									>{currentWorkspaceName}</span
								>
								<ThemeIcon role="chevron-down" class="size-4 shrink-0 text-sidebar-foreground/60" />
							{/if}
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-64" side="bottom" align="start" sideOffset={6}>
					<WorkspaceMenuItems
						onCreate={openCreateWorkspace}
						onSelect={() => sidebar.setOpenMobile(false)}
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<NotificationBell compact />
		</div>

		{#if workspaceCtx.currentWorkspace?.can_edit}
			<Button
				href={resolve('/')}
				variant="focal"
				size="sm"
				class="w-full gap-2 group-data-[collapsible=icon]:px-0"
				aria-label={m.sidebar_new_post()}
				data-testid="sidebar-new-post"
				onclick={handleNewPostClick}
			>
				<ThemeIcon role="compose" class="size-4" />
				{#if sidebar.state !== 'collapsed'}<span>{m.sidebar_new_post()}</span>{/if}
			</Button>
		{/if}
	</Sidebar.Header>

	<Sidebar.Content class="gap-4 overflow-y-auto px-2 py-2">
		{@render navigationList(overviewItems, 'sidebar-workspace-navigation')}
		{@render navigationList(makeItems, 'sidebar-make-navigation')}
		{#if showDrafts}<SidebarPlanner onNavigate={navigate} />{/if}
	</Sidebar.Content>

	<Sidebar.Footer class="p-2" data-testid="sidebar-workspace-footer">
		{@render navigationList(footerItems, 'sidebar-footer-navigation')}
		<Sidebar.Menu data-testid="sidebar-secondary-navigation">
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
