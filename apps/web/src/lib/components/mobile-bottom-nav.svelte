<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import {
		isMoreNavigationRoute,
		isNavigationItemActive,
		mobileNavigation
	} from '$lib/app-navigation';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';
	import AccountPreferencesMenu from './account-preferences-menu.svelte';

	const items = mobileNavigation;
	let moreMenuOpen = $state(false);
	const pathname = $derived(String(page.url.pathname));

	function iconFor(id: (typeof items)[number]['id']): ThemeIconRole {
		switch (id) {
			case 'calendar':
				return 'calendar';
			case 'publications':
				return 'publications';
			case 'media':
				return 'media';
			default:
				return 'add';
		}
	}

	function labelFor(id: (typeof items)[number]['id']) {
		switch (id) {
			case 'new':
				return m.sidebar_new();
			case 'calendar':
				return m.sidebar_calendar();
			case 'publications':
				return m.sidebar_activity();
			case 'media':
				return m.sidebar_media();
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
		goto(resolveAppPath(item.href));
	}
</script>

<nav
	data-slot="mobile-bottom-nav"
	class="fixed inset-x-0 bottom-0 z-30 border-t bg-background/96 px-2 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
	aria-label={m.sidebar_primary_navigation()}
>
	<ul class="grid min-h-[calc(var(--mobile-bottom-nav-height)-0.6rem)] grid-cols-5">
		{#each items as item (item.id)}
			{@const icon = iconFor(item.id)}
			{@const active = isNavigationItemActive(item, pathname)}
			<li>
				<button
					type="button"
					data-theme-navigation-item
					data-active={active}
					data-cuelume-toggle={item.id === 'new' ? 'release' : 'tick'}
					class={[
						'flex min-h-[var(--theme-touch-target)] w-full items-center justify-center rounded-md px-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
						item.id === 'new'
							? 'text-primary'
							: active
								? 'bg-accent text-foreground'
								: 'text-muted-foreground'
					]}
					onclick={() => navigate(item)}
					aria-current={active ? 'page' : undefined}
					aria-label={labelFor(item.id)}
				>
					<span
						class={item.id === 'new'
							? 'flex size-10 items-center justify-center rounded-lg border border-primary bg-primary text-primary-foreground shadow-[0_4px_12px_-6px_color-mix(in_oklch,var(--primary)_80%,black)] transition-[transform,box-shadow] duration-100 active:translate-y-px active:shadow-sm'
							: 'flex size-7 items-center justify-center'}
					>
						<ThemeIcon role={icon} class={item.id === 'new' ? 'size-6' : 'size-5'} />
					</span>
				</button>
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
								'flex min-h-[var(--theme-touch-target)] w-full items-center justify-center rounded-md px-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								moreActive ? 'bg-accent text-foreground' : 'text-muted-foreground'
							]}
							aria-current={moreActive ? 'page' : undefined}
							aria-label={m.sidebar_more()}
						>
							<span class="flex size-7 items-center justify-center">
								<ThemeIcon role="menu" class="size-5" />
							</span>
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content
					class="mb-1 max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain border-border bg-popover! p-1 before:hidden"
					side="top"
					align="end"
					sideOffset={8}
				>
					<AccountPreferencesMenu
						showDestinations
						inlineAppearance
						onNavigate={() => {
							moreMenuOpen = false;
						}}
					/>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</li>
	</ul>
</nav>
