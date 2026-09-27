<script lang="ts">
	import type { SocialAccount } from '@openpost/query-catalog';
	import SocialAccountIdentity from '$lib/components/social-account-identity.svelte';
	import type { Source, Connection } from './api';
	import { createConnection, deleteConnection } from './api';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import Choice from './choice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	let {
		source,
		workspaceID,
		connections,
		accounts,
		onchange
	}: {
		source: Source;
		workspaceID: string;
		connections: Connection[];
		accounts: SocialAccount[];
		onchange: (source: Source) => void;
	} = $props();
	let deleteOpen = $state(false),
		deleting = $state<Connection | null>(null);
	let adding = $state(false),
		name = $state(''),
		token = $state(''),
		busy = $state(false),
		error = $state('');
	async function connect() {
		busy = true;
		error = '';
		try {
			const connection = await createConnection(workspaceID, name, token);
			token = '';
			adding = false;
			onchange({ ...source, connection_id: connection.id });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-5">
	<div class="space-y-2">
		<Label for="workflow-source">{m.workflows_source()}</Label><Choice
			id="workflow-source"
			value={source.kind}
			options={[
				{ value: 'manual', label: m.workflows_manual() },
				{ value: 'github_release', label: m.workflows_github() },
				{ value: 'rss', label: m.workflows_rss() },
				{ value: 'rendition_published', label: m.workflows_published() }
			]}
			onchange={(kind) => onchange({ kind: kind as Source['kind'] })}
		/>
	</div>
	{#if source.kind === 'github_release'}
		<div class="space-y-2">
			<Label for="workflow-repository">{m.workflows_repository()}</Label><Input
				id="workflow-repository"
				value={source.repository ?? ''}
				placeholder="owner/repository"
				oninput={(event) => onchange({ ...source, repository: event.currentTarget.value })}
			/>
			<p class="text-xs text-muted-foreground">{m.workflows_repository_help()}</p>
		</div>
		<div class="space-y-2">
			<Label for="workflow-connection">{m.workflows_connection()}</Label><Choice
				id="workflow-connection"
				value={source.connection_id || 'public'}
				options={[
					{ value: 'public', label: m.workflows_public_access() },
					...connections.map((connection) => ({ value: connection.id, label: connection.name }))
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
		<Button
			variant="outline"
			disabled={workspaceCtx.currentWorkspace?.role !== 'admin'}
			onclick={() => (adding = !adding)}>{m.workflows_add_connection()}</Button
		>
		{#if adding}<form
				class="space-y-3 rounded-lg border p-3"
				onsubmit={(event) => {
					event.preventDefault();
					void connect();
				}}
			>
				<div class="space-y-2">
					<Label for="workflow-connection-name">{m.workflows_connection_name()}</Label><Input
						id="workflow-connection-name"
						bind:value={name}
						required
						maxlength={100}
					/>
				</div>
				<div class="space-y-2">
					<Label for="workflow-token">{m.workflows_token()}</Label><Input
						id="workflow-token"
						type="password"
						autocomplete="off"
						bind:value={token}
						required
					/>
					<p class="text-xs text-muted-foreground">{m.workflows_token_help()}</p>
				</div>
				{#if error}<InlineNotice tone="error" message={error} />{/if}<Button
					type="submit"
					disabled={busy || !token || !name}>{m.workflows_save_connection()}</Button
				>
			</form>{/if}
		{#if workspaceCtx.currentWorkspace?.role === 'admin' && connections.length}<details
				class="space-y-2 text-sm"
			>
				<summary class="cursor-pointer">{m.workflows_connection()}</summary
				>{#each connections as connection}<div class="flex items-center justify-between gap-2">
						<span class="truncate">{connection.name}</span><Button
							variant="ghost"
							size="icon-sm"
							disabled={connection.id === source.connection_id}
							aria-label={`${m.common_delete()}: ${connection.name}`}
							onclick={() => {
								deleting = connection;
								deleteOpen = true;
							}}><ThemeIcon role="delete" class="size-4" /></Button
						>
					</div>{/each}
			</details>{/if}
	{:else if source.kind === 'rss'}
		<div class="space-y-2">
			<Label for="workflow-feed">{m.workflows_feed_url()}</Label><Input
				id="workflow-feed"
				type="url"
				value={source.url ?? ''}
				placeholder="https://example.com/feed.xml"
				oninput={(event) => onchange({ ...source, url: event.currentTarget.value })}
			/>
		</div>
	{:else if source.kind === 'rendition_published'}
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
			: source.kind === 'rendition_published'
				? m.workflows_published_help()
				: m.workflows_source_poll_help()}
	</p>
</div>

<DestructiveConfirmDialog
	bind:open={deleteOpen}
	title={`${m.common_delete()}: ${deleting?.name ?? ''}`}
	description={m.workflows_delete_connection_help()}
	onConfirm={async () => {
		if (!deleting) return { ok: false };
		await deleteConnection(workspaceID, deleting.id);
		return { ok: true };
	}}
/>
