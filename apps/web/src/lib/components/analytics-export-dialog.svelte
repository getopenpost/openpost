<script lang="ts">
	import AsyncActionButton from '$lib/components/async-action-button.svelte';
	import AccountPickerList from '$lib/components/account-picker/list.svelte';
	import AccountPickerRow from '$lib/components/account-picker/row.svelte';
	import { client } from '$lib/api/client';
	import type { paths } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { analyticsMetricLabel } from '$lib/analytics-metric-label';
	import { m } from '$lib/paraglide/messages';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';

	type ExportFormat = 'csv' | 'xlsx' | 'json';
	type GroupBy = 'post' | 'day' | 'week' | 'month' | 'platform' | 'account';
	type Dataset = 'report' | 'posts' | 'daily' | 'accounts';

	type ExportQuery = NonNullable<paths['/analytics/export']['get']['parameters']['query']>;
	type ExportResult = { data?: unknown; error?: unknown; response: Response };

	interface Props {
		open?: boolean;
		workspaceId: string;
		days: number;
		from?: string;
		to?: string;
		rangeLabel?: string;
		accountId?: string;
		/** Connected account identities, including multiple accounts per platform. */
		accounts: { id: string; username: string; platform: string; avatar_url?: string | null }[];
		/** Metric keys measured across the full filtered population. */
		metrics: string[];
		onExported?: () => void;
		/** Fetches the file. Defaults to the API client; tests inject a fake. */
		requestExport?: (query: ExportQuery) => Promise<ExportResult>;
	}

	function fetchExport(query: ExportQuery): Promise<ExportResult> {
		return client.GET('/analytics/export', { params: { query }, parseAs: 'blob' });
	}

	let {
		open = $bindable(false),
		workspaceId,
		days,
		from = '',
		to = '',
		rangeLabel,
		accountId = '',
		accounts,
		metrics,
		onExported,
		requestExport = fetchExport
	}: Props = $props();

	const browserTimezone = (() => {
		try {
			return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		} catch {
			return 'UTC';
		}
	})();
	const timezones = (() => {
		let zones: string[] = [];
		try {
			zones = Intl.supportedValuesOf('timeZone');
		} catch {
			zones = [];
		}
		return [...new Set(['UTC', browserTimezone, ...zones])];
	})();
	const groupOptions: GroupBy[] = ['post', 'day', 'week', 'month', 'platform', 'account'];
	const datasetOptions: Dataset[] = ['report', 'posts', 'daily', 'accounts'];

	let format = $state<ExportFormat>('csv');
	let timezone = $state(browserTimezone);
	let groupBy = $state<GroupBy>('day');
	let dataset = $state<Dataset>('report');
	// Empty selections mean "everything", so the default export needs no setup.
	let selectedAccounts = $state<string[]>([]);
	let selectedMetrics = $state<string[]>([]);
	let exporting = $state(false);
	let error = $state('');

	$effect(() => {
		if (open) {
			selectedAccounts = accountId ? [accountId] : [];
			error = '';
			selectedMetrics = [];
		}
	});

	const formatOptions = $derived([
		{ value: 'csv' as const, label: m.analytics_export_format_csv() },
		{ value: 'xlsx' as const, label: m.analytics_export_format_xlsx() },
		{ value: 'json' as const, label: m.analytics_export_format_json() }
	]);

	function groupLabel(value: GroupBy) {
		switch (value) {
			case 'post':
				return m.analytics_export_group_post();
			case 'day':
				return m.analytics_export_group_day();
			case 'week':
				return m.analytics_export_group_week();
			case 'month':
				return m.analytics_export_group_month();
			case 'platform':
				return m.analytics_export_group_platform();
			default:
				return m.analytics_export_group_account();
		}
	}

	function datasetLabel(value: Dataset) {
		switch (value) {
			case 'report':
				return m.analytics_export_table_report();
			case 'posts':
				return m.analytics_export_table_posts();
			case 'daily':
				return m.analytics_export_table_daily();
			default:
				return m.analytics_export_table_accounts();
		}
	}

	function toggle(list: string[], value: string, checked: boolean) {
		return checked ? [...list, value] : list.filter((item) => item !== value);
	}

	function filenameFrom(response: Response) {
		const match = /filename="?([^";]+)"?/i.exec(response.headers.get('content-disposition') ?? '');
		return match?.[1] ?? `openpost-analytics.${format}`;
	}

	async function download() {
		if (exporting || !workspaceId) return;
		exporting = true;
		error = '';
		try {
			const result = await requestExport({
				workspace_id: workspaceId,
				days,
				from: from || undefined,
				to: to || undefined,
				account_ids: selectedAccounts.join(',') || undefined,
				format,
				timezone,
				group_by: groupBy,
				dataset,
				metrics:
					format === 'xlsx' || dataset === 'report' || dataset === 'posts'
						? selectedMetrics.join(',') || undefined
						: undefined
			});
			if (result.error || !(result.data instanceof Blob))
				throw new Error('analytics export failed');
			const href = URL.createObjectURL(result.data);
			try {
				const link = document.createElement('a');
				link.href = href;
				link.download = filenameFrom(result.response);
				link.click();
			} finally {
				// Firefox and Safari start the download asynchronously.
				setTimeout(() => URL.revokeObjectURL(href), 60_000);
			}
			open = false;
			onExported?.();
		} catch {
			error = m.analytics_export_failed();
		} finally {
			exporting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>{m.analytics_export_title()}</Dialog.Title>
			<Dialog.Description
				>{rangeLabel
					? m.analytics_range_export_description({ range: rangeLabel })
					: m.analytics_export_description({ days })}</Dialog.Description
			>
		</Dialog.Header>
		<div class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1" data-testid="analytics-export-form">
			<div class="space-y-2">
				<Label id="analytics-export-format-label">{m.analytics_export_format()}</Label>
				<div
					class="flex flex-wrap gap-2"
					role="group"
					aria-labelledby="analytics-export-format-label"
				>
					{#each formatOptions as option (option.value)}
						<Button
							type="button"
							size="sm"
							variant={format === option.value ? 'default' : 'outline'}
							aria-pressed={format === option.value}
							onclick={() => (format = option.value)}>{option.label}</Button
						>
					{/each}
				</div>
				{#if format === 'xlsx'}
					<p class="text-xs text-muted-foreground">{m.analytics_export_xlsx_hint()}</p>
				{/if}
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="analytics-export-timezone">{m.analytics_export_timezone()}</Label>
					<Select.Root type="single" value={timezone} onValueChange={(value) => (timezone = value)}>
						<Select.Trigger id="analytics-export-timezone" class="h-11 w-full sm:h-9">
							{timezone}
						</Select.Trigger>
						<Select.Content class="max-h-72">
							{#each timezones as zone (zone)}
								<Select.Item value={zone}>{zone}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for="analytics-export-group">{m.analytics_export_group_by()}</Label>
					<Select.Root
						type="single"
						value={groupBy}
						onValueChange={(value) => (groupBy = value as GroupBy)}
					>
						<Select.Trigger id="analytics-export-group" class="h-11 w-full sm:h-9">
							{groupLabel(groupBy)}
						</Select.Trigger>
						<Select.Content>
							{#each groupOptions as option (option)}
								<Select.Item value={option}>{groupLabel(option)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			{#if format !== 'xlsx'}
				<div class="space-y-2">
					<Label for="analytics-export-table">{m.analytics_export_table()}</Label>
					<Select.Root
						type="single"
						value={dataset}
						onValueChange={(value) => (dataset = value as Dataset)}
					>
						<Select.Trigger id="analytics-export-table" class="h-11 w-full sm:h-9">
							{datasetLabel(dataset)}
						</Select.Trigger>
						<Select.Content>
							{#each datasetOptions as option (option)}
								<Select.Item value={option}>{datasetLabel(option)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			{#if accounts.length > 0}
				<fieldset class="min-w-0 space-y-2">
					<legend class="text-sm font-medium">{m.analytics_export_table_accounts()}</legend>
					<label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
						<Checkbox
							checked={selectedAccounts.length === 0}
							onCheckedChange={() => (selectedAccounts = [])}
						/>
						<span>{m.analytics_all_accounts()}</span>
					</label>
					<AccountPickerList
						{accounts}
						searchText={(account) =>
							`${formatSocialAccountName(account.username, account.platform)} ${account.username} ${getPlatformName(account.platform)}`}
					>
						{#snippet children(account)}
							<AccountPickerRow
								name={formatSocialAccountName(account.username, account.platform) ||
									account.platform}
								platform={account.platform}
								avatarUrl={account.avatar_url}
								selected={selectedAccounts.includes(account.id)}
								onToggle={() =>
									(selectedAccounts = toggle(
										selectedAccounts,
										account.id,
										!selectedAccounts.includes(account.id)
									))}
							/>
						{/snippet}
					</AccountPickerList>
				</fieldset>
			{/if}

			{#if metrics.length > 0 && (format === 'xlsx' || dataset === 'report' || dataset === 'posts')}
				<fieldset class="min-w-0 space-y-2">
					<legend class="text-sm font-medium">{m.analytics_export_metrics()}</legend>
					<p class="text-xs text-muted-foreground">{m.analytics_export_all_if_empty()}</p>
					<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each metrics as metric (metric)}
							<div class="flex min-h-11 items-center gap-2">
								<Checkbox
									id={`analytics-export-metric-${metric}`}
									checked={selectedMetrics.includes(metric)}
									onCheckedChange={(checked) =>
										(selectedMetrics = toggle(selectedMetrics, metric, checked === true))}
								/>
								<Label for={`analytics-export-metric-${metric}`} class="font-normal">
									{analyticsMetricLabel(metric)}
								</Label>
							</div>
						{/each}
					</div>
				</fieldset>
			{/if}

			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}
		</div>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>
				{m.common_cancel()}
			</Button>
			<AsyncActionButton
				label={m.analytics_export_download()}
				icon="download"
				disabled={!workspaceId}
				onclick={download}
			/>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
