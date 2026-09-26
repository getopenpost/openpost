<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { postImportQueryKey, postImportQueryOptions } from '@openpost/query-catalog';
	import { client } from '$lib/api/client';
	import { queryClient } from '$lib/query/client';
	import { postImportQueryAPI } from '$lib/query/post-imports';
	import { readQueryErrorMessage } from '$lib/query/error-message';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	let { workspaceID, accountID }: { workspaceID: string; accountID: string } = $props();
	const imports = createQuery(() => ({
		...postImportQueryOptions(postImportQueryAPI, workspaceID, accountID),
		refetchInterval: 60_000
	}));
	let saving = $state(false);
	let saveError = $state('');
	let extraPosts = $state<
		Array<{ id: string; title: string; text: string; external_url: string; published_at: string }>
	>([]);
	let nextCursor = $state<string | null>(null);
	let loadingMore = $state(false);
	let loadMoreError = $state('');
	let accountKey = $state('');
	$effect(() => {
		const key = `${workspaceID}:${accountID}`;
		if (accountKey === key) return;
		accountKey = key;
		extraPosts = [];
		nextCursor = null;
		loadMoreError = '';
	});
	let posts = $derived.by(() => {
		const seen = new Set<string>();
		return [...(imports.data?.posts ?? []), ...extraPosts].filter((post) => {
			if (seen.has(post.id)) return false;
			seen.add(post.id);
			return true;
		});
	});

	async function loadMore() {
		const cursor = nextCursor ?? imports.data?.next_cursor;
		if (!cursor || loadingMore) return;
		const requestWorkspaceID = workspaceID;
		const requestAccountID = accountID;
		loadingMore = true;
		loadMoreError = '';
		try {
			const { data, error } = await client.GET('/accounts/{account_id}/post-imports', {
				params: {
					path: { account_id: requestAccountID },
					query: { workspace_id: requestWorkspaceID, cursor }
				}
			});
			if (error || !data) throw new Error(m.account_imports_load_failed());
			if (workspaceID === requestWorkspaceID && accountID === requestAccountID) {
				extraPosts = [...extraPosts, ...(data.posts ?? [])];
				nextCursor = data.next_cursor ?? '';
			}
		} catch {
			if (workspaceID === requestWorkspaceID && accountID === requestAccountID) {
				loadMoreError = m.account_imports_load_failed();
			}
		} finally {
			loadingMore = false;
		}
	}

	async function setEnabled(enabled: boolean) {
		if (saving) return;
		saving = true;
		saveError = '';
		const requestWorkspaceID = workspaceID;
		const requestAccountID = accountID;
		try {
			const { data, error } = await client.PUT('/accounts/{account_id}/post-imports', {
				params: { path: { account_id: requestAccountID } },
				body: { workspace_id: requestWorkspaceID, enabled }
			});
			if (error || !data) throw new Error(m.account_imports_save_failed());
			queryClient.setQueryData(postImportQueryKey(requestWorkspaceID, requestAccountID), data);
		} catch {
			if (workspaceID === requestWorkspaceID && accountID === requestAccountID) {
				saveError = m.account_imports_save_failed();
			}
		} finally {
			saving = false;
		}
	}
</script>

{#snippet postList(items: typeof posts, cursor: string | undefined)}
	{#if items.length > 0}
		<ul class="divide-y rounded-lg border bg-card">
			{#each items as post (post.id)}
				<li class="space-y-1 px-3 py-2">
					{#if post.external_url}
						<a
							class="focus-ring line-clamp-2 text-sm font-medium underline-offset-2 hover:underline"
							href={post.external_url}
							target="_blank"
							rel="noopener noreferrer"
						>
							{post.title || post.text}
						</a>
					{:else}
						<p class="line-clamp-2 text-sm font-medium">{post.title || post.text}</p>
					{/if}
					<p class="text-xs text-muted-foreground">
						{new Date(post.published_at).toLocaleDateString()}
					</p>
				</li>
			{/each}
		</ul>
		{#if cursor}
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={loadingMore}
				onclick={() => void loadMore()}
			>
				{m.account_imports_load_more()}
			</Button>
		{/if}
		{#if loadMoreError}<InlineNotice tone="error" message={loadMoreError} />{/if}
	{:else}
		<p class="text-xs text-muted-foreground">{m.account_imports_empty()}</p>
	{/if}
{/snippet}

{#snippet settingsContent(data: NonNullable<typeof imports.data>)}
	{#if saveError}
		<InlineNotice tone="error" message={saveError} />
	{/if}
	<div class="space-y-3 rounded-lg border bg-card p-3">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p class="text-sm font-medium">{m.account_imports_toggle()}</p>
			<Button
				type="button"
				variant={data.enabled ? 'outline' : 'default'}
				size="sm"
				class="min-h-11 sm:min-h-9"
				disabled={saving || !data.supported}
				onclick={() => void setEnabled(!data.enabled)}
			>
				{data.enabled ? m.account_imports_turn_off() : m.account_imports_turn_on()}
			</Button>
		</div>
		{#if !data.supported}
			<p class="text-xs text-muted-foreground">{data.unavailable_reason}</p>
		{:else if data.enabled && !data.last_success_at}
			<p class="text-xs text-muted-foreground">{m.account_imports_waiting()}</p>
		{/if}
		{#if data.failure_message}
			<p class="text-xs text-destructive" role="status">{data.failure_message}</p>
		{/if}
	</div>
	{@render postList(posts, nextCursor ?? data.next_cursor)}
{/snippet}

<section class="space-y-3" aria-labelledby="account-imports-heading">
	<div class="space-y-1">
		<h3 id="account-imports-heading" class="text-sm font-semibold">
			{m.account_imports_heading()}
		</h3>
		<p class="text-xs leading-5 text-muted-foreground">{m.account_imports_description()}</p>
	</div>
	{#if imports.isPending}
		<p class="text-sm text-muted-foreground">{m.common_loading()}</p>
	{:else if imports.error}
		<InlineNotice
			tone="error"
			message={readQueryErrorMessage(imports.error) ?? m.account_imports_load_failed()}
		>
			{#snippet actions()}
				<Button type="button" variant="outline" size="sm" onclick={() => void imports.refetch()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else if imports.data}
		{@render settingsContent(imports.data)}
	{/if}
</section>
