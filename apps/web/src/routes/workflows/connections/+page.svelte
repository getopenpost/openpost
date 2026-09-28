<script lang="ts">
	import { createQuery } from '@tanstack/svelte-query';
	import { workflowConnectionsQueryOptions } from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		createConnection,
		rotateConnection,
		deleteConnection,
		type Connection
	} from '$lib/workflows/api';
	import PageContainer from '$lib/components/page-container.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import Choice from '$lib/workflows/choice.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	const workspaceID = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const canAdmin = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const query = createQuery(() => workflowConnectionsQueryOptions(workflowQueryAPI, workspaceID));
	let rotating = $state<Connection | null>(null);
	let dialogOrigin: HTMLElement | null = null;
	let adding = $state(false),
		name = $state(''),
		token = $state(''),
		host = $state(''),
		header = $state('X-API-Key'),
		kind = $state<'github' | 'bearer' | 'header' | 'basic'>('github'),
		search = $state(''),
		error = $state(''),
		busy = $state(false),
		deleteOpen = $state(false),
		deleting = $state<Connection | null>(null);
	const connections = $derived(
		(query.data ?? []).filter((connection) =>
			`${connection.name} ${connection.kind} ${connection.host}`
				.toLowerCase()
				.includes(search.toLowerCase())
		)
	);
	async function save() {
		busy = true;
		error = '';
		try {
			if (rotating) await rotateConnection(workspaceID, rotating.id, token);
			else
				await createConnection(workspaceID, name, token, {
					kind,
					host,
					header_name: kind === 'header' ? header : ''
				});
			rotating = null;
			token = '';
			name = '';
			adding = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{m.workflows_connections()} · OpenPost</title></svelte:head>
<PageContainer
	title={m.workflows_connections()}
	description={m.workflows_connections_help()}
	themeIconRole="link"
	loading={query.isPending && !query.error}
>
	{#snippet actions()}<Button
			id="workflow-add-connection"
			disabled={!canAdmin}
			onclick={() => {
				rotating = null;
				adding = true;
				error = '';
				token = '';
			}}><ThemeIcon role="add" class="size-4" />{m.workflows_connection_add()}</Button
		>{/snippet}
	{#snippet navigation()}<div class="flex flex-wrap items-center gap-3 border-b pb-3">
			<Button variant="ghost" size="sm" href="/workflows"
				><ThemeIcon role="arrow-left" class="size-4" />{m.workflows_back()}</Button
			><Input
				class="ml-auto max-w-xs"
				aria-label={m.settings_instance_search()}
				placeholder={m.settings_instance_search()}
				bind:value={search}
			/>
		</div>{/snippet}
	{#if (!adding && error) || query.error}<InlineNotice
			tone="error"
			message={error || String(query.error)}
		/>{/if}

	<div class="divide-y rounded-lg border">
		{#each connections as connection}<div class="flex items-center gap-3 p-4">
				<ThemeIcon role={connection.kind === 'github' ? 'github' : 'link'} class="size-5" />
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-sm font-medium">{connection.name}</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						{connection.kind} · {connection.host || 'api.github.com'}
					</p>
				</div>
				<Button
					size="sm"
					variant="ghost"
					disabled={!canAdmin}
					onclick={() => {
						rotating = connection;
						error = '';
						kind = connection.kind as typeof kind;
						adding = true;
						token = '';
					}}>{m.workflows_rotate_secret()}</Button
				><Button
					size="icon-sm"
					variant="ghost"
					disabled={!canAdmin}
					aria-label={`${m.common_delete()}: ${connection.name}`}
					onclick={() => {
						deleting = connection;
						deleteOpen = true;
					}}><ThemeIcon role="delete" class="size-4" /></Button
				>
			</div>{/each}{#if !connections.length}<p class="p-6 text-sm text-muted-foreground">
				{m.workflows_no_connections()}
			</p>{/if}
	</div>
</PageContainer>
<Dialog.Root
	bind:open={adding}
	onOpenChange={(open) => {
		if (!open) {
			token = '';
			error = '';
		}
	}}
>
	<Dialog.Content
		class="max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-lg"
		onOpenAutoFocus={() => {
			dialogOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		}}
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			(dialogOrigin?.isConnected
				? dialogOrigin
				: document.getElementById('workflow-add-connection')
			)?.focus();
		}}
	>
		<Dialog.Header class="pr-10 text-left">
			<Dialog.Title
				>{rotating
					? `${m.workflows_rotate_secret()}: ${rotating.name}`
					: m.workflows_connection_add()}</Dialog.Title
			>
			<Dialog.Description>{m.workflows_connections_help()}</Dialog.Description>
		</Dialog.Header>
		{#if error}<InlineNotice tone="error" message={error} />{/if}
		{@render credentialForm()}
	</Dialog.Content>
</Dialog.Root>

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

{#snippet credentialForm()}
	<form
		class="space-y-4"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		{#if !rotating}<div class="space-y-2">
				<Label for="connection-name">{m.workflows_connection_name()}</Label><Input
					id="connection-name"
					required
					maxlength={100}
					bind:value={name}
				/>
			</div>
			<div class="space-y-2">
				<Label for="connection-kind">{m.workflows_connection_kind()}</Label><Choice
					id="connection-kind"
					label={m.workflows_connection_kind()}
					value={kind}
					options={[
						{ value: 'github', label: 'GitHub' },
						{ value: 'bearer', label: m.workflows_connection_bearer() },
						{ value: 'header', label: m.workflows_connection_header_auth() },
						{ value: 'basic', label: m.workflows_connection_basic() }
					]}
					onchange={(value) => (kind = value as typeof kind)}
				/>
			</div>
			{#if kind !== 'github'}<div class="space-y-2">
					<Label for="connection-host">{m.workflows_connection_host()}</Label><Input
						id="connection-host"
						required
						bind:value={host}
						placeholder="api.example.com"
					/>
					<p class="text-xs text-muted-foreground">{m.workflows_connection_host_help()}</p>
				</div>{/if}
			{#if kind === 'header'}<div class="space-y-2">
					<Label for="connection-header">{m.workflows_connection_header()}</Label><Input
						id="connection-header"
						required
						bind:value={header}
					/>
				</div>{/if}
		{/if}
		<div class="space-y-2">
			<Label for="connection-secret">{m.workflows_connection_secret()}</Label><Input
				id="connection-secret"
				type="password"
				autocomplete="new-password"
				required
				bind:value={token}
			/>{#if kind === 'basic'}<p class="text-xs text-muted-foreground">
					{m.workflows_connection_basic_help()}
				</p>{/if}
		</div>
		<div class="flex gap-2">
			<Button type="submit" disabled={busy}>{m.workflows_save_connection()}</Button><Button
				variant="ghost"
				onclick={() => {
					adding = false;
					token = '';
				}}>{m.common_cancel()}</Button
			>
		</div>
	</form>
{/snippet}
