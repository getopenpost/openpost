<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import {
		activityPublicationsQueryOptions,
		postImportPageQueryOptions,
		type SocialAccount
	} from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import { postImportQueryAPI } from '$lib/query/post-imports';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import Choice from './choice.svelte';
	import type { Source } from './api';
	import { m } from '$lib/paraglide/messages';
	let {
		source,
		accounts,
		onchange,
		instagramOnly = false
	}: {
		source: Source;
		accounts: SocialAccount[];
		onchange: (source: Source) => void;
		instagramOnly?: boolean;
	} = $props();
	const ws = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const accountID = $derived(source.account_ids?.[0] ?? '');
	const eligible = $derived(
		accounts.filter(
			(account) => account.platform !== 'x' && (!instagramOnly || account.platform === 'instagram')
		)
	);
	const selected = $derived(accounts.find((account) => account.id === accountID));
	let search = $state(''),
		cursor = $state(''),
		previous = $state<string[]>([]);
	const posts = createQuery(() => ({
		...activityPublicationsQueryOptions(queryAPI, ws, 'published', { limit: 50, search }),
		enabled: Boolean(ws && accountID && source.post_scope === 'selected')
	}));
	const imported = createQuery(() => ({
		...postImportPageQueryOptions(postImportQueryAPI, ws, accountID, cursor),
		enabled: Boolean(
			ws && accountID && source.post_scope === 'selected' && selected?.platform === 'instagram'
		)
	}));
	const scheduled = createQuery(() => ({
		...activityPublicationsQueryOptions(queryAPI, ws, 'scheduled', { limit: 50, search }),
		enabled: Boolean(ws && accountID && source.post_scope === 'selected')
	}));
	const nativePosts = $derived(imported.data?.posts ?? []);
	const options = $derived([
		{ value: '', label: m.workflows_required() },
		...[...(posts.data?.items ?? []), ...(scheduled.data?.items ?? [])].flatMap((post) =>
			(post.renditions ?? [])
				.filter(
					(r) => r.social_account_id === accountID && ['published', 'scheduled'].includes(r.status)
				)
				.map((r) => ({
					value: 'r:' + r.id,
					label: (post.title || post.source_text || m.workflows_post()).slice(0, 100)
				}))
		),
		...nativePosts.map((post) => ({
			value: 'p:' + post.external_id,
			label: (post.title || post.text || post.external_url).slice(0, 100)
		}))
	]);
	const value = $derived(
		source.rendition_ids?.[0]
			? 'r:' + source.rendition_ids[0]
			: source.post_ids?.[0]
				? 'p:' + source.post_ids[0]
				: ''
	);
	const visibleOptions = $derived(
		options.some((option) => option.value === value)
			? options
			: [...options, { value, label: m.workflows_comment_post() }]
	);
</script>

<div class="space-y-4">
	<p class="text-sm text-muted-foreground">{m.workflows_comment_source_help()}</p>
	<div class="space-y-2">
		<Label for="comment-account">{m.accounts_heading()}</Label><Choice
			id="comment-account"
			value={accountID}
			options={[
				{ value: '', label: m.workflows_required() },
				...eligible.map((account) => ({
					value: account.id,
					label: `${account.account_username || account.platform} · ${account.platform}`
				}))
			]}
			onchange={(id) => {
				cursor = '';
				previous = [];
				onchange({ ...source, account_ids: id ? [id] : [], rendition_ids: [], post_ids: [] });
			}}
		/>
	</div>
	{#if !eligible.length}<InlineNotice
			tone="info"
			message={m.workflows_comment_empty_accounts()}
		/>{/if}
	<div class="space-y-2">
		<Label for="comment-scope">{m.workflows_comment_scope()}</Label><Choice
			id="comment-scope"
			value={source.post_scope ?? 'all'}
			options={[
				{ value: 'selected', label: m.workflows_comment_selected_posts() },
				{ value: 'all', label: m.workflows_comment_any_post() }
			]}
			onchange={(post_scope) =>
				onchange({
					...source,
					post_scope: post_scope as Source['post_scope'],
					rendition_ids: [],
					post_ids: []
				})}
		/>
	</div>
	{#if source.post_scope === 'selected'}
		<div class="space-y-2">
			<Label for="comment-post-search">{m.workflows_comment_search_posts()}</Label><Input
				id="comment-post-search"
				bind:value={search}
			/>
		</div>
		<div class="space-y-2">
			<Label for="comment-post">{m.workflows_comment_post()}</Label><Choice
				id="comment-post"
				{value}
				options={visibleOptions}
				onchange={(value) =>
					onchange({
						...source,
						rendition_ids: value.startsWith('r:') ? [value.slice(2)] : [],
						post_ids: value.startsWith('p:') ? [value.slice(2)] : []
					})}
			/>
			<p class="text-xs text-muted-foreground">{m.workflows_comment_posts_help()}</p>
		</div>
		{#if imported.data?.next_cursor || previous.length}<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					disabled={!previous.length || imported.isFetching}
					onclick={() => {
						cursor = previous.at(-1) ?? '';
						previous = previous.slice(0, -1);
					}}>{m.workflows_comment_previous_posts()}</Button
				><Button
					variant="outline"
					disabled={!imported.data?.next_cursor || imported.isFetching}
					onclick={() => {
						previous = [...previous, cursor];
						cursor = imported.data?.next_cursor ?? '';
					}}>{m.workflows_comment_next_posts()}</Button
				>
			</div>{/if}
	{/if}
	{#if posts.isError || imported.isError}<InlineNotice
			tone="error"
			message={m.workflows_load_failed()}
		/>{/if}
	<div class="space-y-2">
		<Label for="comment-keywords">{m.workflows_comment_keywords()}</Label><Input
			id="comment-keywords"
			value={(source.keywords ?? []).join(', ')}
			onchange={(event) =>
				onchange({
					...source,
					keywords: event.currentTarget.value
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				})}
		/>
		<p class="text-xs text-muted-foreground">{m.workflows_comment_keywords_help()}</p>
	</div>
	<details class="space-y-4">
		<summary class="min-h-11 cursor-pointer py-2 text-sm font-medium"
			>{m.workflows_configure()}</summary
		>
		<div class="space-y-2">
			<Label for="comment-exclude">{m.workflows_comment_exclude()}</Label><Input
				id="comment-exclude"
				value={(source.excluded_keywords ?? []).join(', ')}
				onchange={(event) =>
					onchange({
						...source,
						excluded_keywords: event.currentTarget.value
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					})}
			/>
		</div>
		<div class="space-y-2">
			<Label for="comment-match">{m.workflows_comment_match()}</Label><Choice
				id="comment-match"
				value={source.match_mode ?? 'word'}
				options={[
					{ value: 'word', label: m.workflows_comment_word() },
					{ value: 'exact', label: m.workflows_comment_exact() },
					{ value: 'contains', label: m.workflows_comment_contains() }
				]}
				onchange={(match_mode) =>
					onchange({ ...source, match_mode: match_mode as Source['match_mode'] })}
			/>
		</div>
		<div class="space-y-2">
			<Label for="comment-daily">{m.workflows_comment_daily_limit()}</Label><Input
				id="comment-daily"
				type="number"
				min={1}
				max={1000}
				value={source.daily_limit ?? 20}
				oninput={(event) => onchange({ ...source, daily_limit: Number(event.currentTarget.value) })}
			/>
		</div>
		<div class="space-y-2">
			<Label for="comment-priority">{m.workflows_comment_priority()}</Label><Input
				id="comment-priority"
				type="number"
				min={1}
				max={100}
				value={source.priority ?? 50}
				oninput={(event) => onchange({ ...source, priority: Number(event.currentTarget.value) })}
			/>
			<p class="text-xs text-muted-foreground">{m.workflows_comment_priority_help()}</p>
		</div>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><Checkbox
				checked={source.top_level_only ?? true}
				onCheckedChange={(checked) => onchange({ ...source, top_level_only: checked })}
			/>{m.workflows_comment_top_level()}</label
		>
	</details>
</div>
