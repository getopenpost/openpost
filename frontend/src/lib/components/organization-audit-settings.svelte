<script lang="ts">
	import { client } from '$lib/api/client';
	import type { components, operations } from '$lib/api/types';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';
	import { Capacitor } from '@capacitor/core';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';

	type AuditEvent = components['schemas']['OrganizationAuditEvent'];
	type Organization = components['schemas']['OrganizationResponse'];
	type AuditQuery = NonNullable<
		operations['list-organization-audit-events']['parameters']['query']
	>;
	type ResourceType = AuditQuery['resource_type'];

	interface Props {
		organizationID: string;
		active?: boolean;
	}
	let { organizationID, active = false }: Props = $props();
	let organizations = $state.raw<Organization[]>([]);
	let organizationsLoaded = $state(false);
	let organizationsLoading = $state(false);
	let selectedOrganizationID = $state('');
	let items = $state.raw<AuditEvent[]>([]);
	let nextCursor = $state('');
	let loading = $state(false);
	let loadingMore = $state(false);
	let exporting = $state<'json' | 'csv' | ''>('');
	let error = $state('');
	let ownerRequired = $state(false);
	let action = $state('');
	let actorUserID = $state('');
	let resourceType = $state<ResourceType | ''>('');
	let workspaceID = $state('');
	let from = $state('');
	let before = $state('');
	let loadedOrganizationID = '';
	let requestSequence = 0;

	const resourceOptions = $derived([
		{ value: '', label: m.settings_audit_all_resources() },
		{ value: 'workspace_member', label: m.settings_audit_resource_workspace_member() },
		{ value: 'workspace_invitation', label: m.settings_audit_resource_workspace_invitation() },
		{ value: 'provider', label: m.settings_audit_resource_provider() },
		{ value: 'policy', label: m.settings_audit_resource_policy() },
		{ value: 'domain', label: m.settings_audit_resource_domain() },
		{ value: 'session', label: m.settings_audit_resource_session() },
		{ value: 'identity', label: m.settings_audit_resource_identity() },
		{ value: 'reauthentication', label: m.settings_audit_resource_reauthentication() },
		{ value: 'identity_configuration', label: m.settings_audit_resource_identity_configuration() },
		{ value: 'impersonation', label: m.settings_audit_resource_impersonation() },
		{ value: 'billing', label: m.settings_audit_resource_billing() },
		{ value: 'mcp_tool_call', label: m.settings_audit_resource_mcp_tool_call() },
		{ value: 'publication', label: m.settings_audit_resource_publication() },
		{
			value: 'publication_authorization',
			label: m.settings_audit_resource_publication_authorization()
		},
		{ value: 'provider_write', label: m.settings_audit_resource_provider_write() }
	]);
	const organizationOptions = $derived(
		organizations.map((organization) => ({ value: organization.id, label: organization.name }))
	);

	$effect(() => {
		if (active && !organizationsLoaded && !organizationsLoading) void loadOrganizations();
	});

	$effect(() => {
		const target = selectedOrganizationID;
		if (!active || !target || loadedOrganizationID === target) return;
		loadedOrganizationID = target;
		items = [];
		nextCursor = '';
		void loadAudit(false, target);
	});

	async function loadOrganizations() {
		organizationsLoading = true;
		const result = await client.GET('/organizations');
		organizationsLoading = false;
		organizationsLoaded = true;
		if (result.error || !result.data) {
			error = m.settings_audit_load_failed();
			return;
		}
		organizations = result.data.filter((organization) => organization.role === 'owner');
		selectedOrganizationID =
			organizations.find((organization) => organization.id === organizationID)?.id ??
			organizations[0]?.id ??
			'';
		ownerRequired = organizations.length === 0;
		if (ownerRequired) error = m.settings_audit_owner_required();
	}

	function filterQuery(cursor = ''): AuditQuery {
		return {
			workspace_id: workspaceID.trim() || undefined,
			actor_user_id: actorUserID.trim() || undefined,
			action: action.trim() || undefined,
			resource_type: resourceType || undefined,
			from: from ? new Date(from).toISOString() : undefined,
			before: before ? new Date(before).toISOString() : undefined,
			cursor: cursor || undefined,
			limit: 50
		};
	}

	async function loadAudit(append: boolean, target = selectedOrganizationID) {
		if (!target) return;
		const sequence = ++requestSequence;
		if (append) loadingMore = true;
		else loading = true;
		error = '';
		ownerRequired = false;
		const result = await client.GET('/organizations/{id}/audit-events', {
			params: { path: { id: target }, query: filterQuery(append ? nextCursor : '') }
		});
		if (sequence !== requestSequence) return;
		if (result.error || !result.data) {
			ownerRequired = result.response.status === 403;
			error = ownerRequired ? m.settings_audit_owner_required() : m.settings_audit_load_failed();
		} else {
			items = append ? [...items, ...(result.data.items ?? [])] : (result.data.items ?? []);
			nextCursor = result.data.next_cursor ?? '';
		}
		loading = false;
		loadingMore = false;
	}

	function applyFilters() {
		items = [];
		nextCursor = '';
		void loadAudit(false);
	}
	function resetFilters() {
		action = '';
		actorUserID = '';
		resourceType = '';
		workspaceID = '';
		from = '';
		before = '';
		applyFilters();
	}
	async function exportAudit(format: 'json' | 'csv') {
		if (!selectedOrganizationID || exporting) return;
		exporting = format;
		error = '';
		try {
			const params = {
				path: { id: selectedOrganizationID },
				query: { ...filterQuery(), limit: undefined, cursor: undefined }
			};
			const result =
				format === 'json'
					? await client.GET('/organizations/{id}/audit-events/export.json', { params })
					: await client.GET('/organizations/{id}/audit-events/export.csv', {
							params,
							parseAs: 'text'
						});
			if (result.error || result.data === undefined) throw new Error('audit export failed');
			const payload =
				format === 'json' ? JSON.stringify(result.data, null, 2) : String(result.data);
			const mime = format === 'json' ? 'application/json' : 'text/csv';
			const filename = `openpost-organization-audit-${new Date().toISOString().slice(0, 10)}.${format}`;
			await saveExport(new Blob([payload], { type: mime }), filename);
		} catch {
			error = m.settings_audit_export_failed();
		} finally {
			exporting = '';
		}
	}

	async function saveExport(blob: Blob, filename: string) {
		const file = new File([blob], filename, { type: blob.type });
		if (Capacitor.isNativePlatform() && navigator.canShare?.({ files: [file] })) {
			await navigator.share({ files: [file], title: filename });
			return;
		}
		const href = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = href;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(href);
	}
	function formatDate(value: string) {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
			new Date(value)
		);
	}
	function actionLabel(value: string) {
		return value.replaceAll('.', ' · ').replaceAll('_', ' ');
	}
	function changedFieldLabel(event: AuditEvent) {
		return (event.changed_fields ?? [])
			.map((field) =>
				field.previous && field.current
					? `${field.field}: ${field.previous} → ${field.current}`
					: `${field.field}: ${field.current ?? field.previous ?? ''}`
			)
			.join(', ');
	}
</script>

<div class="space-y-6" data-testid="organization-audit-settings">
	<SectionHeader
		title={m.settings_audit_title()}
		description={m.settings_audit_description()}
		icon={HistoryIcon}
	/>
	<InlineNotice tone="info" message={m.settings_audit_privacy_notice()} />
	{#if organizationOptions.length > 1}
		<div class="max-w-md space-y-2">
			<Label for="audit-organization">{m.settings_audit_organization()}</Label>
			<AppSelect
				id="audit-organization"
				bind:value={selectedOrganizationID}
				options={organizationOptions}
			/>
		</div>
	{/if}

	<Card.Root>
		<Card.Header
			><Card.Title class="flex items-center gap-2 text-base"
				><FilterIcon class="size-4" />{m.settings_audit_filters()}</Card.Title
			></Card.Header
		>
		<Card.Content class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			<div class="space-y-2">
				<Label for="audit-action">{m.settings_audit_action()}</Label><Input
					id="audit-action"
					bind:value={action}
					placeholder="member.role_changed"
				/>
			</div>
			<div class="space-y-2">
				<Label for="audit-actor">{m.settings_audit_actor()}</Label><Input
					id="audit-actor"
					bind:value={actorUserID}
					placeholder={m.settings_audit_actor_hint()}
				/>
			</div>
			<div class="space-y-2">
				<Label for="audit-workspace">{m.settings_audit_workspace()}</Label><Input
					id="audit-workspace"
					bind:value={workspaceID}
					placeholder={m.settings_audit_workspace_hint()}
				/>
			</div>
			<div class="space-y-2">
				<Label for="audit-resource">{m.settings_audit_resource()}</Label><AppSelect
					id="audit-resource"
					bind:value={resourceType}
					options={resourceOptions}
				/>
			</div>
			<div class="space-y-2">
				<Label for="audit-from">{m.settings_audit_from()}</Label><Input
					id="audit-from"
					type="datetime-local"
					bind:value={from}
				/>
			</div>
			<div class="space-y-2">
				<Label for="audit-before">{m.settings_audit_before()}</Label><Input
					id="audit-before"
					type="datetime-local"
					bind:value={before}
				/>
			</div>
		</Card.Content>
		<Card.Footer class="flex flex-wrap gap-2"
			><Button onclick={applyFilters}>{m.settings_audit_apply_filters()}</Button><Button
				variant="outline"
				onclick={resetFilters}>{m.settings_audit_clear_filters()}</Button
			></Card.Footer
		>
	</Card.Root>

	<div class="flex flex-wrap gap-2">
		<Button
			variant="outline"
			size="sm"
			disabled={!selectedOrganizationID || Boolean(exporting)}
			onclick={() => void exportAudit('json')}
			data-testid="audit-export-json"
			><DownloadIcon class="size-4" />{m.settings_audit_export_json()}</Button
		>
		<Button
			variant="outline"
			size="sm"
			disabled={!selectedOrganizationID || Boolean(exporting)}
			onclick={() => void exportAudit('csv')}
			data-testid="audit-export-csv"
			><DownloadIcon class="size-4" />{m.settings_audit_export_csv()}</Button
		>
	</div>

	{#if loading}
		<PageLoading layout="list" label={m.settings_audit_loading()} items={5} />
	{:else if error}
		<InlineNotice tone={ownerRequired ? 'info' : 'error'} message={error}>
			{#if !ownerRequired}{#snippet actions()}<Button
						variant="outline"
						size="sm"
						onclick={() => void loadAudit(false)}>{m.common_retry()}</Button
					>{/snippet}{/if}
		</InlineNotice>
	{:else if items.length === 0}
		<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
			{m.settings_audit_empty()}
		</p>
	{:else}
		<div class="space-y-3" aria-live="polite" data-testid="organization-audit-events">
			{#each items as event (event.source + event.id)}
				<Card.Root
					><Card.Content class="space-y-3 p-4">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="font-medium capitalize">{actionLabel(event.action)}</p>
								<p class="text-sm break-all text-muted-foreground">
									{event.resource.type}{event.resource.id ? ` · ${event.resource.id}` : ''}
								</p>
							</div>
							<time class="text-xs text-muted-foreground" datetime={event.occurred_at}
								>{formatDate(event.occurred_at)}</time
							>
						</div>
						<dl class="grid gap-2 text-sm sm:grid-cols-2">
							<div>
								<dt class="text-xs text-muted-foreground">{m.settings_audit_actor()}</dt>
								<dd class="break-all">{event.actor_user_id || m.settings_audit_system_actor()}</dd>
							</div>
							<div>
								<dt class="text-xs text-muted-foreground">{m.settings_audit_result()}</dt>
								<dd>{event.result}</dd>
							</div>
							{#if event.effective_actor_user_id && event.effective_actor_user_id !== event.actor_user_id}<div
								>
									<dt class="text-xs text-muted-foreground">
										{m.settings_audit_effective_actor()}
									</dt>
									<dd class="break-all">{event.effective_actor_user_id}</dd>
								</div>{/if}
							{#if event.resource.workspace_id}<div>
									<dt class="text-xs text-muted-foreground">{m.settings_audit_workspace()}</dt>
									<dd class="break-all">{event.resource.workspace_id}</dd>
								</div>{/if}
							{#if changedFieldLabel(event)}<div>
									<dt class="text-xs text-muted-foreground">{m.settings_audit_changes()}</dt>
									<dd>{changedFieldLabel(event)}</dd>
								</div>{/if}
						</dl>
					</Card.Content></Card.Root
				>
			{/each}
		</div>
		{#if nextCursor}<Button
				variant="outline"
				disabled={loadingMore}
				onclick={() => void loadAudit(true)}
				>{#if loadingMore}<LoaderIcon
						class="size-4 animate-spin"
					/>{/if}{m.settings_audit_load_older()}</Button
			>{/if}
	{/if}
</div>
