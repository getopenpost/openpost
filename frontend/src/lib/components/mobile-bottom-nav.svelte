<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { isNavigationItemActive, mobileNavigation } from '$lib/app-navigation';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import AccountPreferencesMenu from './account-preferences-menu.svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import ComposeIcon from '@lucide/svelte/icons/plus';
	import PostsIcon from '@lucide/svelte/icons/files';
	import MediaIcon from '@lucide/svelte/icons/images';
	import MoreIcon from '@lucide/svelte/icons/menu';

	const items = mobileNavigation;
	const pathname = $derived(String(page.url.pathname));

	function iconFor(id: (typeof items)[number]['id']) {
		switch (id) {
			case 'calendar':
				return CalendarIcon;
			case 'posts':
				return PostsIcon;
			case 'media':
				return MediaIcon;
			default:
				return ComposeIcon;
		}
	}

	function labelFor(id: (typeof items)[number]['id']) {
		switch (id) {
			case 'new':
				return m.sidebar_new();
			case 'calendar':
				return m.sidebar_calendar();
			case 'posts':
				return m.sidebar_activity();
			case 'media':
				return m.sidebar_media();
			default:
				return '';
		}
	}

	const moreActive = $derived(
		pathname === '/analytics' ||
			pathname.startsWith('/analytics/') ||
			pathname === '/engagement' ||
			pathname.startsWith('/engagement/') ||
			pathname === '/messages' ||
			pathname.startsWith('/messages/') ||
			pathname === '/notifications' ||
			pathname.startsWith('/notifications/') ||
			pathname === '/editors' ||
			pathname.startsWith('/editors/') ||
			pathname.startsWith('/image-editor/') ||
			pathname.startsWith('/video-editor/') ||
			pathname === '/accounts' ||
			pathname.startsWith('/accounts/') ||
			pathname === '/settings' ||
			pathname.startsWith('/settings/')
	);

	function navigate(item: (typeof items)[number]) {
		if (item.id === 'new') {
			if (!ui.startNewPost()) return;
			if (pathname === '/') return;
		}
		goto(resolve(item.href as '/'));
	}
</script>

<nav
	data-slot="mobile-bottom-nav"
	class="fixed inset-x-0 bottom-0 z-30 border-t bg-background/96 px-2 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
	aria-label={m.sidebar_primary_navigation()}
>
	<ul class="grid grid-cols-5">
		{#each items as item (item.id)}
			{@const Icon = iconFor(item.id)}
			{@const active = isNavigationItemActive(item, pathname)}
			<li>
				<button
					type="button"
					data-cuelume-press={item.id === 'new' ? 'press' : undefined}
					data-cuelume-release={item.id === 'new' ? 'release' : undefined}
					data-cuelume-toggle={item.id === 'new' ? undefined : 'tick'}
					class={[
						'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-md px-1 text-[0.625rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
						item.id === 'new'
							? 'text-primary'
							: active
								? 'bg-accent text-foreground'
								: 'text-muted-foreground'
					]}
					onclick={() => navigate(item)}
					aria-current={active ? 'page' : undefined}
				>
					<span
						class={item.id === 'new'
							? 'flex size-9 -translate-y-0.5 items-center justify-center rounded-lg border border-primary bg-primary text-primary-foreground shadow-[0_3px_0_color-mix(in_oklch,var(--primary)_68%,black)] transition-[transform,box-shadow] duration-100 active:translate-y-0.5 active:shadow-[0_1px_0_color-mix(in_oklch,var(--primary)_68%,black)]'
							: 'flex size-5 items-center justify-center'}
					>
						<Icon class={item.id === 'new' ? 'size-5' : 'size-4'} />
					</span>
					<span class="sr-only">{labelFor(item.id)}</span>
				</button>
			</li>
		{/each}
		<li>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class={[
								'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-md px-1 text-[0.625rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
								moreActive ? 'bg-accent text-foreground' : 'text-muted-foreground'
							]}
							aria-current={moreActive ? 'page' : undefined}
							aria-label={m.sidebar_more()}
						>
							<span class="flex size-5 items-center justify-center">
								<MoreIcon class="size-4" />
							</span>
							<span class="sr-only">{m.sidebar_more()}</span>
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content
					class="mb-1 max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain p-1"
					side="top"
					align="end"
					sideOffset={8}
				>
					<AccountPreferencesMenu showDestinations />
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</li>
	</ul>
</nav>
