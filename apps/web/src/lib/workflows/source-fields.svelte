<script lang="ts">
	import type { SocialAccount } from '@openpost/query-catalog';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import type { Source, Connection } from './api';
	import Choice from './choice.svelte';
	import Field from './field.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	let {
		source,
		connections,
		accounts,
		onchange
	}: {
		source: Source;
		connections: Connection[];
		accounts: SocialAccount[];
		onchange: (source: Source) => void;
	} = $props();
</script>

<div class="space-y-5">
	<div class="space-y-2">
		<Label for="workflow-source">{m.workflows_source()}</Label><Choice
			id="workflow-source"
			value={source.kind}
			options={[
				{ value: 'manual', label: m.workflows_manual() },
				{ value: 'interval', label: m.workflows_interval() },
				{ value: 'publication_created', label: m.workflows_post_created() },
				{ value: 'rendition_failed', label: m.workflows_post_failed() },
				{ value: 'github_release', label: m.workflows_github() },
				{ value: 'rss', label: m.workflows_rss() },
				{ value: 'rendition_published', label: m.workflows_published() }
			]}
			onchange={(kind) =>
				onchange({
					kind: kind as Source['kind'],
					...(kind === 'interval' ? { interval_minutes: 1440 } : {})
				})}
		/>
	</div>
	{#if source.kind === 'interval'}<div class="space-y-2">
			<Field
				id="workflow-interval"
				label={m.workflows_interval_minutes()}
				numeric
				required
				min={5}
				max={43200}
				value={{ literal: source.interval_minutes ?? '' }}
				onchange={(value) => onchange({ ...source, interval_minutes: Number(value.literal) })}
			/>
			<p class="text-xs text-muted-foreground">{m.workflows_interval_help()}</p>
		</div>
	{:else if source.kind === 'github_release'}
		<div class="space-y-2">
			<Label for="workflow-repository">{m.workflows_repository()}</Label><Input
				id="workflow-repository"
				value={source.repository ?? ''}
				aria-invalid={!source.repository?.trim()}
				aria-describedby={!source.repository?.trim() ? 'workflow-repository-error' : undefined}
				placeholder="owner/repository"
				oninput={(event) => onchange({ ...source, repository: event.currentTarget.value })}
			/>
			<p class="text-xs text-muted-foreground">{m.workflows_repository_help()}</p>
			{#if !source.repository?.trim()}<p
					id="workflow-repository-error"
					class="text-xs text-destructive"
				>
					{m.workflows_required()}
				</p>{/if}
		</div>
		<div class="space-y-2">
			<Label for="workflow-connection">{m.workflows_connection()}</Label><Choice
				id="workflow-connection"
				value={source.connection_id || 'public'}
				options={[
					{ value: 'public', label: m.workflows_public_access() },
					...connections
						.filter((connection) => connection.kind === 'github')
						.map((connection) => ({ value: connection.id, label: connection.name }))
				]}
				onchange={(connection_id) =>
					onchange({ ...source, connection_id: connection_id === 'public' ? '' : connection_id })}
			/>
		</div>
		<label class="flex min-h-11 items-center gap-2 text-sm"
			><Checkbox
				checked={source.include_prereleases ?? false}
				onCheckedChange={(checked) =>
					onchange({ ...source, include_prereleases: checked === true })}
			/>{m.workflows_prereleases()}</label
		>
		<Button variant="outline" href="/workflows/connections"
			>{m.workflows_manage_connections()}</Button
		>
	{:else if source.kind === 'rss'}
		<div class="space-y-2">
			<Label for="workflow-feed">{m.workflows_feed_url()}</Label><Input
				id="workflow-feed"
				type="url"
				value={source.url ?? ''}
				aria-invalid={!source.url?.trim()}
				aria-describedby={!source.url?.trim() ? 'workflow-feed-error' : undefined}
				placeholder="https://example.com/feed.xml"
				oninput={(event) => onchange({ ...source, url: event.currentTarget.value })}
			/>{#if !source.url?.trim()}<p id="workflow-feed-error" class="text-xs text-destructive">
					{m.workflows_required()}
				</p>{/if}
		</div>
	{:else if source.kind === 'rendition_published' || source.kind === 'rendition_failed'}
		<fieldset class="space-y-2">
			<legend class="text-sm font-medium">{m.repost_source_accounts()}</legend>
			<label class="flex min-h-11 items-center gap-2 text-sm"
				><Checkbox
					checked={!source.account_ids?.length}
					onCheckedChange={() => onchange({ ...source, account_ids: [] })}
				/>{m.repost_any_compatible_source()}</label
			>
			{#each accounts as account (account.id)}<label
					class="flex min-h-11 items-center gap-3 text-sm"
					><Checkbox
						checked={source.account_ids?.includes(account.id) ?? false}
						onCheckedChange={(checked) =>
							onchange({
								...source,
								account_ids: checked
									? [...(source.account_ids ?? []), account.id]
									: (source.account_ids ?? []).filter((id) => id !== account.id)
							})}
					/><SocialAccountIdentity
						name={account.account_username || account.platform}
						platform={account.platform}
					/></label
				>{/each}
		</fieldset>
	{/if}
	<p class="text-sm leading-6 text-muted-foreground">
		{source.kind === 'manual'
			? m.workflows_manual_help()
			: source.kind === 'publication_created'
				? m.workflows_created_help()
				: source.kind === 'rendition_failed'
					? m.workflows_failed_help()
					: source.kind === 'interval'
						? m.workflows_interval_help()
						: source.kind === 'rendition_published'
							? m.workflows_published_help()
							: m.workflows_source_poll_help()}
	</p>
</div>
