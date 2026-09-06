<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import InstanceAdminOverview from '$lib/components/instance-admin-overview.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import ExternalApplicationAdminSettings from './ExternalApplicationAdminSettings.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		adminQueryKeys,
		OpenPostQueryError,
		updateStatusQueryOptions
	} from '@openpost/query-catalog';
	import { adminQueryAPI } from '$lib/query/admin';
	import { queryClient } from '$lib/query/client';
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';

	let { userID, active }: { userID: string; active: boolean } = $props();
	let authorizationError = $state('');
	const updateStatusQuery = createQuery(() => ({
		...updateStatusQueryOptions(adminQueryAPI),
		enabled: active && Boolean(userID) && !authorizationError
	}));
	const status = $derived(authorizationError ? null : (updateStatusQuery.data ?? null));
	const loading = $derived(
		active && Boolean(userID) && !authorizationError && updateStatusQuery.isPending
	);
	const error = $derived(authorizationError || updateStatusQuery.error?.message || '');
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceStatus
	);
	$effect(() => reportInitialLoad(loading && !status));

	$effect(() => {
		const cause = updateStatusQuery.error;
		if (!(cause instanceof OpenPostQueryError) || (cause.status !== 401 && cause.status !== 403))
			return;
		authorizationError = cause.message;
		queryClient.removeQueries({
			queryKey: adminQueryKeys.updateStatus(),
			exact: true
		});
	});

	async function retryUpdateStatus() {
		authorizationError = '';
		await updateStatusQuery.refetch();
	}

	function shortBuild(value: string) {
		const normalized = value.trim();
		if (normalized === 'unknown' || normalized.length <= 12) return normalized;
		return normalized.slice(0, 12);
	}

	function configurationSourceLabel(source: string) {
		if (source === 'environment') return m.settings_configuration_source_environment();
		if (source === 'database') return m.settings_configuration_source_admin();
		return m.settings_configuration_source_default();
	}

	function formatDateTime(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<div class="space-y-6">
	<InstanceAdminOverview />
	<div>
		<SectionHeader
			title={m.settings_instance_status()}
			description={m.settings_instance_status_body()}
			themeIconRole="settings"
			class="mb-4"
		/>

		{#if error}
			<InlineNotice tone={status ? 'warning' : 'error'} message={error}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryUpdateStatus}>{m.common_retry()}</Button
					>
				{/snippet}
			</InlineNotice>
		{/if}
		{#if loading && !status}
			<PageLoading layout="list" label={m.common_loading()} items={3} />
		{:else if status}
			<div class="space-y-4" data-testid="instance-update-status">
				{#if status.state === 'update_available'}
					<InlineNotice tone="warning">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<p class="font-medium">
									{m.settings_instance_update_available({
										version: status.latest_version ?? ''
									})}
								</p>
								<p class="mt-0.5 text-current/80">
									{m.settings_instance_update_available_body()}
								</p>
							</div>
							{#if status.release_url}
								<Button
									href={status.release_url}
									target="_blank"
									rel="noreferrer"
									variant="outline"
									size="sm"
								>
									{m.settings_instance_view_release()}
									<ThemeIcon role="external-link" class="ml-1 h-3.5 w-3.5" />
								</Button>
							{/if}
						</div>
					</InlineNotice>
				{:else if status.state === 'stale'}
					<InlineNotice tone="info" message={m.settings_instance_stale()} />
				{:else if status.state === 'unavailable'}
					<InlineNotice tone="info" message={m.settings_instance_unavailable()} />
				{:else if status.state === 'disabled'}
					<InlineNotice
						tone="info"
						message={status.disabled_reason === 'managed_edition'
							? m.settings_instance_managed_release_checks()
							: m.settings_instance_disabled()}
					/>
				{:else if status.state === 'development'}
					<InlineNotice tone="info" message={m.settings_instance_development()} />
				{:else}
					<InlineNotice tone="success" message={m.settings_instance_current()} />
				{/if}

				<dl class="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
					<div class="min-w-0">
						<dt class="text-sm text-muted-foreground">
							{m.settings_instance_running_version()}
						</dt>
						<dd class="mt-1 font-medium">{status.running_version}</dd>
					</div>
					<div class="min-w-0">
						<dt class="text-sm text-muted-foreground">
							{m.settings_instance_configured_check()}
						</dt>
						<dd class="mt-1 font-medium">
							{status.configured_enabled ? m.settings_value_enabled() : m.settings_value_disabled()}
							<span class="font-normal text-muted-foreground">
								· {configurationSourceLabel(status.configuration_source)}</span
							>
						</dd>
					</div>
					<div class="min-w-0">
						<dt class="text-sm text-muted-foreground">
							{m.settings_instance_effective_check()}
						</dt>
						<dd class="mt-1 font-medium">
							{status.effective_enabled ? m.settings_value_enabled() : m.settings_value_disabled()}
							{#if status.requires_restart}
								<span class="font-normal text-warning-foreground">
									· {m.settings_configuration_pending()}</span
								>
							{/if}
						</dd>
					</div>
					<div class="min-w-0">
						<dt class="text-sm text-muted-foreground">
							{m.settings_instance_running_build()}
						</dt>
						<dd class="mt-1 truncate font-mono text-sm" title={status.running_build}>
							{shortBuild(status.running_build)}
						</dd>
					</div>
					{#if status.latest_version}
						<div class="min-w-0">
							<dt class="text-sm text-muted-foreground">
								{m.settings_instance_latest_version()}
							</dt>
							<dd class="mt-1 font-medium">{status.latest_version}</dd>
						</div>
					{/if}
					{#if status.checked_at}
						<div class="min-w-0">
							<dt class="text-sm text-muted-foreground">
								{m.settings_instance_last_checked()}
							</dt>
							<dd class="mt-1">{formatDateTime(status.checked_at)}</dd>
						</div>
					{/if}
				</dl>
				<p class="max-w-2xl text-sm text-muted-foreground">
					{m.settings_instance_no_auto_update()}
				</p>
			</div>
		{/if}
	</div>
	<ExternalApplicationAdminSettings />
</div>
