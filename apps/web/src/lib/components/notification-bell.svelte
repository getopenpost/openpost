<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { notificationInbox, type Notification } from '$lib/stores/notifications.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import { presentNotification, isSafeLocalNotificationHref } from '$lib/notification-presentation';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from './empty-state.svelte';
	import InlineNotice from './inline-notice.svelte';
	import PageLoading from './page-loading.svelte';
	import { ThemeIcon } from '$lib/themes/icons';

	let { compact = false }: { compact?: boolean } = $props();
	let open = $state(false);
	let pending = $state('');
	let content = $state<HTMLDivElement | null>(null);
	let error = $state('');
	const workspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const inbox = $derived(notificationInbox.snapshot(workspaceId));
	const unreadCount = $derived(inbox.unreadCount);
	const unreadItems = $derived(inbox.items.filter((item) => !item.read_at));

	$effect(() => {
		const currentWorkspace = workspaceId;
		open = false;
		error = '';
		if (!currentWorkspace) return;
		untrack(() => void notificationInbox.ensureLoaded(currentWorkspace));
	});

	async function markRead(input: { ids?: string[]; all?: boolean }) {
		const requestedWorkspace = workspaceId;
		if (!requestedWorkspace || pending) return false;
		const focused = content?.ownerDocument.activeElement;
		const focusedRow =
			focused instanceof HTMLElement ? focused.closest('[data-notification-id]') : null;
		const restoreFocus =
			focused instanceof HTMLElement &&
			content?.contains(focused) &&
			(input.all || input.ids?.includes(focusedRow?.getAttribute('data-notification-id') ?? ''));
		// Keep focus inside the popover before its focused row is disabled or removed.
		if (restoreFocus) content?.focus();
		pending = input.all ? 'all' : (input.ids?.[0] ?? '');
		error = '';
		const result = await notificationInbox.markRead(requestedWorkspace, input);
		pending = '';
		if (workspaceId !== requestedWorkspace) return false;
		if (!result.ok) {
			error = input.all ? m.notifications_mark_all_failed() : m.notifications_mark_read_failed();
		}
		await tick();
		if (restoreFocus && content && content.ownerDocument.activeElement === content) {
			const next = result.ok
				? (content.querySelector<HTMLElement>('[data-notification-id] button:not(:disabled)') ??
					content.querySelector<HTMLElement>('a[href]') ??
					content)
				: focused;
			if (next instanceof HTMLElement && next.isConnected) next.focus();
		}
		return result.ok;
	}

	function localHref(notification: Notification): string | undefined {
		const href =
			notification.href ||
			presentNotification(notification).actions.find((action) => !action.operation && action.href)
				?.href;
		return isSafeLocalNotificationHref(href) ? href : undefined;
	}

	async function openNotification(notification: Notification) {
		const requestedWorkspace = workspaceId;
		const href = localHref(notification);
		if (!href || !(await markRead({ ids: [notification.id] }))) return;
		if (workspaceId !== requestedWorkspace) return;
		open = false;
		await goto(resolveAppPath(href));
	}

	function timestamp(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(date);
	}
</script>

{#snippet badge()}
	{#if unreadCount > 0}
		<span
			class={compact
				? 'ms-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold text-primary-foreground'
				: 'ms-auto min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-center text-[10px] font-semibold text-primary-foreground'}
			aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span
		>
	{/if}
{/snippet}

<Popover.Root bind:open>
	{#if compact}
		<Popover.Trigger
			class="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:h-8 md:min-w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
			aria-label={m.notifications_bell_label({ count: unreadCount })}
			title={m.notifications_heading()}
			data-testid="sidebar-notifications"
		>
			<ThemeIcon role="notification" class="size-4" />
			{@render badge()}
		</Popover.Trigger>
	{:else}
		<Sidebar.MenuItem>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						{...props}
						class="relative h-10 text-sm"
						aria-label={m.notifications_bell_label({ count: unreadCount })}
						tooltipContent={m.notifications_bell_label({ count: unreadCount })}
					>
						<ThemeIcon role="notification" class="size-4" />
						<span>{m.notifications_heading()}</span>
						{@render badge()}
					</Sidebar.MenuButton>
				{/snippet}
			</Popover.Trigger>
		</Sidebar.MenuItem>
	{/if}
	<Popover.Content
		bind:ref={content}
		align="start"
		side="bottom"
		collisionPadding={8}
		class="flex max-h-[min(36rem,var(--bits-popover-content-available-height))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden p-0"
		aria-label={m.notifications_heading()}
		data-testid="notification-panel"
	>
		<div class="flex shrink-0 items-center justify-between gap-2 border-b p-3">
			<div class="min-w-0">
				<h2 class="text-sm font-semibold">{m.notifications_heading()}</h2>
				<p class="text-xs text-muted-foreground" role="status">
					{m.notifications_unread_count({ count: unreadCount })}
				</p>
			</div>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={m.common_close()}
				onclick={() => (open = false)}><ThemeIcon role="close" class="size-4" /></Button
			>
		</div>
		<div class="min-h-0 overflow-y-auto overscroll-contain">
			{#if error || inbox.error}
				<div class="p-3">
					<InlineNotice
						tone="error"
						message={error || inbox.error || m.notifications_load_failed()}
					>
						{#snippet actions()}
							{#if inbox.error}<Button
									variant="outline"
									size="sm"
									disabled={inbox.loading}
									onclick={() => void notificationInbox.refresh(workspaceId)}
									>{m.common_retry()}</Button
								>{/if}
						{/snippet}
					</InlineNotice>
				</div>
			{/if}
			{#if !inbox.initialized && !inbox.error}
				<div class="p-3"><PageLoading layout="list" items={3} label={m.common_loading()} /></div>
			{:else if inbox.initialized && !inbox.error && unreadItems.length === 0}
				<div class="p-3">
					<EmptyState
						themeIconRole="notification"
						title={inbox.unreadCount === 0
							? m.notifications_empty_title()
							: m.notifications_no_results_title()}
						description={inbox.unreadCount === 0
							? m.notifications_empty_description()
							: m.notifications_no_results_description()}
						variant="muted"
						headingLevel={3}
					/>
				</div>
			{:else}
				<div class="divide-y">
					{#each unreadItems as notification (notification.id)}
						{@const presentation = presentNotification(notification)}
						<article class="p-3" data-notification-id={notification.id}>
							{#if localHref(notification)}
								<button
									type="button"
									class="block min-h-11 w-full rounded-md text-start hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
									disabled={pending !== ''}
									onclick={() => void openNotification(notification)}
								>
									<span class="block text-sm font-medium break-words">{presentation.title}</span>
									{#if presentation.body}<span
											class="mt-1 block text-sm leading-5 break-words text-muted-foreground"
											>{presentation.body}</span
										>{/if}
								</button>
							{:else}
								<p class="text-sm font-medium break-words">{presentation.title}</p>
								{#if presentation.body}<p
										class="mt-1 text-sm leading-5 break-words text-muted-foreground"
									>
										{presentation.body}
									</p>{/if}
							{/if}
							<div class="mt-2 flex items-center justify-between gap-2">
								<time datetime={notification.created_at} class="text-xs text-muted-foreground"
									>{timestamp(notification.created_at)}</time
								>
								<Button
									variant="ghost"
									size="sm"
									disabled={pending !== ''}
									onclick={() => void markRead({ ids: [notification.id] })}
									>{m.notifications_mark_read()}</Button
								>
							</div>
						</article>
					{/each}
				</div>
			{/if}
			{#if inbox.nextCursor}
				<div class="p-3">
					<Button
						variant="outline"
						size="sm"
						class="w-full"
						disabled={inbox.loadingMore}
						onclick={() => void notificationInbox.loadMore(workspaceId)}
						>{inbox.loadingMore
							? m.notifications_loading_more()
							: m.notifications_load_more()}</Button
					>
					{#if inbox.loadMoreError}<InlineNotice
							tone="error"
							message={m.notifications_load_more_failed()}
						/>{/if}
				</div>
			{/if}
		</div>
		<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t p-3">
			<Button
				variant="ghost"
				size="sm"
				disabled={unreadCount === 0 || pending !== ''}
				onclick={() => void markRead({ all: true })}>{m.notifications_mark_all_read()}</Button
			>
			<Button
				variant="outline"
				size="sm"
				href={resolve('/inbox/notifications?status=all' as '/')}
				onclick={() => (open = false)}>{m.notifications_reset_filter()}</Button
			>
		</div>
	</Popover.Content>
</Popover.Root>
