<script lang="ts">
	import { resolve } from '$app/paths';
	import { notificationInbox } from '$lib/stores/notifications.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import BellIcon from '@lucide/svelte/icons/bell';

	let { compact = false }: { compact?: boolean } = $props();
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const inbox = $derived(notificationInbox.snapshot(workspaceId));
	const unreadCount = $derived(inbox.unreadCount);

	$effect(() => {
		const currentWorkspace = workspaceId;
		if (!currentWorkspace) return;
		void notificationInbox.ensureLoaded(currentWorkspace);
		return notificationInbox.startAutoRefresh(currentWorkspace);
	});
</script>

{#if compact}
	<a
			href={resolve('/inbox/notifications' as '/')}
		class="relative inline-flex size-8 items-center justify-center rounded-md text-sidebar-foreground/62 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
		aria-label={m.notifications_bell_label({ count: unreadCount })}
		title={m.notifications_heading()}
		data-testid="sidebar-notifications"
		data-cuelume-toggle="tick"
	>
		<BellIcon class="size-4" />
		{#if unreadCount > 0}
			<span
				class="absolute end-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-sidebar"
				aria-hidden="true"
			></span>
			<span class="sr-only">{m.notifications_unread_count({ count: unreadCount })}</span>
		{/if}
	</a>
{:else}
	<Sidebar.MenuItem>
		<Sidebar.MenuButton
			class="relative h-10 text-sm"
			tooltipContent={m.notifications_bell_label({ count: unreadCount })}
		>
			{#snippet child({ props })}
				<a
					{...props}
					href={resolve('/inbox/notifications' as '/')}
					aria-label={m.notifications_bell_label({ count: unreadCount })}
				>
					<BellIcon class="size-4" />
					<span>{m.notifications_heading()}</span>
					{#if unreadCount > 0}
						<span
							class="ms-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-primary-foreground"
							aria-label={m.notifications_unread_count({ count: unreadCount })}
						>
							{unreadCount > 99 ? '99+' : unreadCount}
						</span>
					{/if}
				</a>
			{/snippet}
		</Sidebar.MenuButton>
	</Sidebar.MenuItem>
{/if}
