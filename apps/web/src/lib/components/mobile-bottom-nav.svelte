<script lang="ts">
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import {
		isMoreNavigationRoute,
		isNavigationItemActive,
		mobileNavigation,
		primaryNavigation
	} from '$lib/app-navigation';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';
	import MobileMoreMenu from './mobile-more-menu.svelte';
	import { publicationView } from '$lib/stores/publication-view.svelte';

	const items = $derived(
		workspaceCtx.currentWorkspace?.can_edit
			? mobileNavigation
			: [
					...mobileNavigation.filter((item) => item.id !== 'new'),
					...primaryNavigation.filter((item) => item.id === 'analytics')
				]
	);
	let moreMenuOpen = $state(false);
	let moreMenuContent = $state<HTMLDivElement | null>(null);

	function focusMoreMenuOnOpen(event: Event) {
		if (!moreMenuContent) return;
		event.preventDefault();
		// Floating-layer setup must not replace a keyboard choice made while opening.
		if (!moreMenuContent.contains(moreMenuContent.ownerDocument.activeElement)) {
			moreMenuContent.focus({ preventScroll: true });
		}
	}
	const pathname = $derived(String(page.url.pathname));

	function iconFor(id: (typeof items)[number]['id']): ThemeIconRole {
		switch (id) {
			case 'analytics':
				return 'analytics';
			case 'communications':
				return 'communications';
			case 'publications':
				return 'publications';
			default:
				return 'add';
		}
	}

	function labelFor(id: (typeof items)[number]['id']) {
		switch (id) {
			case 'analytics':
				return m.sidebar_analytics();
			case 'new':
				return m.sidebar_new();
			case 'communications':
				return m.sidebar_communications();
			case 'publications':
				return m.sidebar_activity();
			default:
				return '';
		}
	}

	const moreActive = $derived(isMoreNavigationRoute(pathname));

	function navigate(item: (typeof items)[number]) {
		if (item.id === 'new') {
			if (!ui.startNewPost()) return;
			if (pathname === '/') return;
		}
		goto(resolveAppPath(item.id === 'publications' ? publicationView.href : item.href));
	}
</script>

<nav
	data-slot="mobile-bottom-nav"
	class="fixed inset-x-0 bottom-0 z-30 border-t bg-background/96 px-2 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
	aria-label={m.sidebar_primary_navigation()}
>
	<ul class="grid min-h-[calc(var(--mobile-bottom-nav-height)-0.6rem)] grid-cols-4">
		{#each items as item (item.id)}
			{@const icon = iconFor(item.id)}
			{@const active = isNavigationItemActive(item, pathname)}
			<li>
				{#if item.id === 'new'}
					<button
						type="button"
						class="flex min-h-[var(--theme-touch-target)] w-full flex-col items-center justify-center gap-0.5 rounded-md text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						onclick={() => navigate(item)}
						aria-label={m.sidebar_new_post()}
					>
						<ThemeIcon role="add" class="size-5" />
						<span class="text-xs leading-none font-medium">{labelFor(item.id)}</span>
					</button>
				{:else}
					<button
						type="button"
						data-theme-navigation-item
						data-active={active}
						data-cuelume-toggle="select"
						class={[
							'flex min-h-[var(--theme-touch-target)] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							active ? 'text-foreground' : 'text-muted-foreground'
						]}
						onclick={() => navigate(item)}
						aria-current={active ? 'page' : undefined}
					>
						<ThemeIcon role={icon} class="size-5" />
						<span class="max-w-full truncate text-xs leading-none font-medium"
							>{labelFor(item.id)}</span
						>
					</button>
				{/if}
			</li>
		{/each}
		<li>
			<DropdownMenu.Root bind:open={moreMenuOpen}>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							data-theme-navigation-item
							data-active={moreActive}
							class={[
								'flex min-h-[var(--theme-touch-target)] w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								moreActive ? 'text-foreground' : 'text-muted-foreground'
							]}
							aria-current={moreActive ? 'page' : undefined}
						>
							<ThemeIcon role="menu" class="size-5" />
							<span class="max-w-full truncate text-xs leading-none font-medium"
								>{m.sidebar_more()}</span
							>
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content
					bind:ref={moreMenuContent}
					onOpenAutoFocus={focusMoreMenuOnOpen}
					onCloseAutoFocus={(event) => {
						if (moreMenuOpen) event.preventDefault();
					}}
					class="mb-1 max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain border-border bg-popover! p-1 before:hidden"
					side="top"
					align="end"
					sideOffset={8}
				>
					<MobileMoreMenu
						onNavigate={() => {
							moreMenuOpen = false;
						}}
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</li>
	</ul>
</nav>
