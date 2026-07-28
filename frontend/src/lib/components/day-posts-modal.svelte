<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { client, type Post } from '$lib/api/client';
	import { workspaceClock } from '$lib/components/compose/schedule-timezone';
	import { ui } from '$lib/stores/ui.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import type { DateValue } from '@internationalized/date';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import CalendarIcon from 'lucide-svelte/icons/calendar-days';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import MoreIcon from 'lucide-svelte/icons/ellipsis';
	import { getStatusColor } from '$lib/utils';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';

	let posts = $state.raw<Post[]>([]);
	let loading = $state(false);
	let error = $state('');
	let open = $state(false);
	let deleteDialogOpen = $state(false);
	let postToDelete = $state.raw<Post | null>(null);
	let loadRequestSequence = 0;

	const currentDate = $derived<DateValue | undefined>(ui.dayPostsDate);
	const dateStr = $derived(currentDate ? currentDate.toString() : '');
	const currentWorkspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const viewerTimeZone = $derived(
		workspaceCtx.settingsWorkspaceID === currentWorkspaceId
			? workspaceCtx.settings.timezone || 'UTC'
			: 'UTC'
	);
	const isFutureDay = $derived.by(() => {
		if (!currentDate) return false;
		return currentDate.compare(workspaceClock(viewerTimeZone).date) >= 0;
	});
	const formattedDate = $derived.by(() => {
		if (!currentDate) return '';
		return currentDate.toDate(viewerTimeZone).toLocaleDateString(getLocaleTag(), {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			timeZone: viewerTimeZone
		});
	});

	$effect(() => {
		open = ui.isDayPostsOpen;
		if (open && dateStr && currentWorkspaceId) {
			void loadPosts(dateStr, currentWorkspaceId);
		}
	});

	function handleOpenChange(isOpen: boolean) {
		open = isOpen;
		if (!isOpen) {
			loadRequestSequence++;
			loading = false;
			ui.closeDayPosts();
		}
	}

	async function loadPosts(date: string, workspaceId = currentWorkspaceId) {
		if (!workspaceId) return;
		const requestSequence = ++loadRequestSequence;
		const isCurrentRequest = () =>
			requestSequence === loadRequestSequence &&
			ui.isDayPostsOpen &&
			dateStr === date &&
			(workspaceCtx.currentWorkspace?.id ?? '') === workspaceId;
		loading = true;
		error = '';
		try {
			const { data, error: responseError } = await client.GET('/posts', {
				params: { query: { date, ...(workspaceId ? { workspace_id: workspaceId } : {}) } }
			});
			if (responseError) throw new Error(m.day_posts_load_failed());
			if (!isCurrentRequest()) return;
			posts = (data ?? [])
				.filter((post) => !post.parent_post_id)
				.toSorted(
					(a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
				);
		} catch (cause) {
			if (!isCurrentRequest()) return;
			error = cause instanceof Error ? cause.message : m.day_posts_load_failed();
		} finally {
			if (isCurrentRequest()) loading = false;
		}
	}

	function getTime(value: string) {
		return new Date(value).toLocaleTimeString(getLocaleTag(), {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
			timeZone: viewerTimeZone
		});
	}

	function postExcerpt(post: Post) {
		const text = post.content || m.calendar_untitled_post();
		return text.length > 100 ? `${text.slice(0, 100).trim()}…` : text;
	}

	function statusLabel(status: string) {
		switch (status.toLowerCase()) {
			case 'published':
				return m.activity_status_published();
			case 'failed':
				return m.activity_status_failed();
			case 'scheduled':
				return m.activity_status_scheduled();
			case 'publishing':
				return m.activity_status_publishing();
			case 'completed':
				return m.activity_status_completed();
			case 'processing':
				return m.activity_status_processing();
			case 'pending':
				return m.activity_status_pending();
			case 'draft':
				return m.activity_status_draft();
			default:
				return status;
		}
	}

	function handleNewPost() {
		ui.closeDayPosts();
		const params = new URLSearchParams();
		if (dateStr) params.set('date', dateStr);
		if (workspaceCtx.currentWorkspace?.id)
			params.set('workspace_id', workspaceCtx.currentWorkspace.id);
		const target = `/?${params.toString()}`;
		goto(resolve(target as '/'));
	}

	function handleEdit(postId: string) {
		ui.closeDayPosts();
		goto(resolve(`/posts/${postId}` as '/'));
	}

	function requestDelete(post: Post) {
		postToDelete = post;
		deleteDialogOpen = true;
	}

	async function handleDelete() {
		const post = postToDelete;
		if (!post) return;
		try {
			const { error: responseError } = await client.DELETE('/posts/{id}', {
				params: { path: { id: post.id } }
			});
			if (responseError) throw new Error(responseError.detail || m.day_posts_delete_failed());
			await loadPosts(dateStr);
			ui.triggerRefresh();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.day_posts_delete_failed();
		}
	}
</script>

<Sheet.Root {open} onOpenChange={handleOpenChange}>
	<Sheet.Content side="right" class="w-full! p-0 sm:max-w-lg!" data-testid="day-posts-drawer">
		<Sheet.Header class="border-b px-4 py-4 pr-14 sm:px-5">
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<Sheet.Title class="truncate text-base font-semibold">{formattedDate}</Sheet.Title>
					<Sheet.Description class="mt-1 text-sm">
						{m.day_posts_scheduled_count({ count: posts.length })}
					</Sheet.Description>
				</div>
				{#if isFutureDay}
					<Button size="sm" onclick={handleNewPost}>
						<PlusIcon class="mr-1.5 size-4" />
						{m.day_posts_new_for_day()}
					</Button>
				{/if}
			</div>
		</Sheet.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-5">
			{#if loading}
				<PageLoading layout="list" label={m.common_loading()} items={3} />
			{:else if error}
				<InlineNotice tone="error" message={error} class="my-4">
					{#snippet actions()}
						<Button variant="outline" size="sm" onclick={() => loadPosts(dateStr)}>
							{m.common_retry()}
						</Button>
					{/snippet}
				</InlineNotice>
			{:else if posts.length === 0}
				<EmptyState
					icon={CalendarIcon}
					title={m.day_posts_empty()}
					actionLabel={isFutureDay ? m.day_posts_new_for_day() : undefined}
					onAction={isFutureDay ? handleNewPost : undefined}
					headingLevel={3}
					size="sm"
					variant="muted"
				/>
			{:else}
				<div class="divide-y">
					{#each posts as post (post.id)}
						{@const destinations = post.destinations ?? []}
						{@const visibleDestinations = destinations.slice(0, 5)}
						{@const hiddenDestinationCount = Math.max(0, destinations.length - 5)}
						<article class="flex items-start gap-3 py-4">
							<time
								class="w-12 shrink-0 pt-0.5 font-mono text-xs font-medium text-muted-foreground"
							>
								{getTime(post.scheduled_at)}
							</time>
							<button
								type="button"
								class="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								onclick={() => handleEdit(post.id)}
							>
								<p class="line-clamp-2 text-sm leading-6">{postExcerpt(post)}</p>
								<div class="mt-2 flex flex-wrap items-center gap-2">
									<span
										class={[
											'rounded-sm px-1.5 py-0.5 text-[11px] font-medium capitalize',
											getStatusColor(post.status)
										]}>{statusLabel(post.status)}</span
									>
									{#if destinations.length > 0}
										<span
											class="flex items-center -space-x-1"
											role="img"
											aria-label={m.day_posts_destination_count({ count: destinations.length })}
											data-testid="day-post-destinations"
										>
											{#each visibleDestinations as destination (destination.social_account_id)}
												<span
													class="flex size-6 items-center justify-center rounded-full border border-border bg-background ring-2 ring-background"
												>
													<PlatformIcon platform={destination.platform} class="size-3.5" />
												</span>
											{/each}
											{#if hiddenDestinationCount > 0}
												<span
													class="flex size-6 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background"
												>
													+{hiddenDestinationCount}
												</span>
											{/if}
										</span>
									{/if}
								</div>
							</button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon"
											class="size-11"
											aria-label={m.day_posts_actions()}><MoreIcon class="size-4" /></Button
										>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onclick={() => handleEdit(post.id)}
										><PencilIcon
											class="mr-2 size-4"
										/>{m.day_posts_edit_in_composer()}</DropdownMenu.Item
									>
									<DropdownMenu.Separator />
									<DropdownMenu.Item class="text-destructive" onclick={() => requestDelete(post)}
										><TrashIcon
											class="mr-2 size-4"
										/>{m.day_posts_delete_action()}</DropdownMenu.Item
									>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</article>
					{/each}
				</div>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.day_posts_delete_confirm()}
	description={m.day_posts_delete_body()}
	onConfirm={handleDelete}
/>
