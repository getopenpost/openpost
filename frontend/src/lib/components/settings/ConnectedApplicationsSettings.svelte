<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type Installation = components['schemas']['ExternalInstallationResponse'];
	type PendingRevocation = { installationID: string; workspaceID?: string };

	let installations = $state<Installation[]>([]);
	let loading = $state(true);
	let error = $state('');
	let pendingRevocation = $state<PendingRevocation | null>(null);
	let confirmOpen = $state(false);

	function workspaceName(workspaceID: string) {
		return (
			workspaceCtx.workspaces.find((workspace) => workspace.id === workspaceID)?.name ?? workspaceID
		);
	}

	async function load() {
		loading = true;
		error = '';
		const { data, error: apiError } = await client.GET('/external-applications/installations');
		if (apiError) error = apiError.detail ?? m.settings_connected_apps_load_failed();
		else installations = data ?? [];
		loading = false;
	}

	function requestRevocation(installationID: string, workspaceID?: string) {
		pendingRevocation = { installationID, workspaceID };
		confirmOpen = true;
	}

	async function confirmRevocation() {
		if (!pendingRevocation) return { ok: false };
		const request = pendingRevocation.workspaceID
			? client.DELETE('/external-applications/installations/{id}/workspaces/{workspace_id}', {
					params: {
						path: {
							id: pendingRevocation.installationID,
							workspace_id: pendingRevocation.workspaceID
						}
					}
				})
			: client.DELETE('/external-applications/installations/{id}', {
					params: { path: { id: pendingRevocation.installationID } }
				});
		const { error: apiError } = await request;
		if (apiError) return { ok: false, message: apiError.detail ?? m.settings_action_failed() };
		await load();
		pendingRevocation = null;
		return { ok: true };
	}

	onMount(load);
</script>

<div class="mt-6 border-t pt-6">
	<SectionHeader
		title={m.settings_connected_apps()}
		description={m.settings_connected_apps_body()}
		themeIconRole="link"
		class="mb-4"
	/>

	{#if error}
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={load}>{m.common_retry()}</Button>
			{/snippet}
		</InlineNotice>
	{:else if loading}
		<PageLoading layout="list" label={m.common_loading()} items={2} />
	{:else if installations.filter((installation) => installation.status === 'active').length === 0}
		<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
			{m.settings_connected_apps_empty()}
		</p>
	{:else}
		<div class="space-y-3">
			{#each installations.filter((installation) => installation.status === 'active') as installation (installation.id)}
				<div class="rounded-md border p-4">
					<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div class="min-w-0">
							<h3 class="font-medium">{installation.application_name}</h3>
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each installation.scopes.split(/\s+/).filter(Boolean) as scope (scope)}
									<Badge variant="secondary">{scope}</Badge>
								{/each}
							</div>
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="text-destructive hover:text-destructive"
							onclick={() => requestRevocation(installation.id)}
						>
							{m.settings_disconnect()}
						</Button>
					</div>
					<div class="mt-4 space-y-2 border-t pt-3">
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{m.settings_connected_workspaces()}
						</p>
						{#each installation.workspace_ids ?? [] as workspaceID (workspaceID)}
							<div class="flex min-h-10 items-center justify-between gap-3 text-sm">
								<span class="truncate">{workspaceName(workspaceID)}</span>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => requestRevocation(installation.id, workspaceID)}
								>
									{m.settings_remove()}
								</Button>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<DestructiveConfirmDialog
	bind:open={confirmOpen}
	title={pendingRevocation?.workspaceID
		? m.settings_remove_connected_workspace()
		: m.settings_disconnect_app()}
	description={pendingRevocation?.workspaceID
		? m.settings_remove_connected_workspace_body()
		: m.settings_disconnect_app_body()}
	confirmLabel={pendingRevocation?.workspaceID ? m.settings_remove() : m.settings_disconnect()}
	onConfirm={confirmRevocation}
/>
