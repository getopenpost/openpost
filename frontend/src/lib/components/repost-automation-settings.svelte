<script lang="ts">
	import type { components } from '$lib/api/types';
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import * as Select from '$lib/components/ui/select';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import ActivityIcon from 'lucide-svelte/icons/activity';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import Repeat2Icon from 'lucide-svelte/icons/repeat-2';
	import TrashIcon from 'lucide-svelte/icons/trash';

	type RepostSettings = components['schemas']['SettingsResponse'];
	type RepostAccount = components['schemas']['AccountOption'];
	type RepostGrant = components['schemas']['GrantResponse'];
	type RepostPolicy = components['schemas']['PolicyInput'];
	type RepostRule = components['schemas']['Rule'];

	interface Props {
		workspaceID: string;
	}

	let { workspaceID }: Props = $props();
	const unsavedChanges = getOptionalUnsavedChanges();
	let settings = $state.raw<RepostSettings | null>(null);
	let policies = $state<RepostPolicy[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let loadError = $state('');
	let saveError = $state('');
	let savedSnapshot = $state('[]');
	let loadedWorkspaceID = $state('');
	let grantToRevoke = $state.raw<RepostGrant | null>(null);
	let revokeDialogOpen = $state(false);

	const dirty = $derived(policySnapshot(policies) !== savedSnapshot);
	const accounts = $derived(settings?.accounts ?? []);
	const sourceAccounts = $derived(
		accounts.filter((account) => account.workspace_id === workspaceID && account.supports_repost)
	);
	const targetAccounts = $derived(accounts.filter((account) => account.supports_repost));
	const activeGrants = $derived(settings?.grants ?? []);

	const delayOptions = [
		{ value: 0, label: m.repost_delay_immediately() },
		{ value: 900, label: m.repost_delay_minutes({ count: 15 }) },
		{ value: 3600, label: m.repost_delay_hours({ count: 1 }) },
		{ value: 10800, label: m.repost_delay_hours({ count: 3 }) },
		{ value: 21600, label: m.repost_delay_hours({ count: 6 }) },
		{ value: 43200, label: m.repost_delay_hours({ count: 12 }) },
		{ value: 86400, label: m.repost_delay_days({ count: 1 }) },
		{ value: 172800, label: m.repost_delay_days({ count: 2 }) },
		{ value: 604800, label: m.repost_delay_days({ count: 7 }) }
	];
	const windowOptions = [
		{ value: 3600, label: m.repost_delay_hours({ count: 1 }) },
		{ value: 21600, label: m.repost_delay_hours({ count: 6 }) },
		{ value: 86400, label: m.repost_delay_days({ count: 1 }) },
		{ value: 259200, label: m.repost_delay_days({ count: 3 }) },
		{ value: 604800, label: m.repost_delay_days({ count: 7 }) },
		{ value: 1209600, label: m.repost_delay_days({ count: 14 }) },
		{ value: 2592000, label: m.repost_delay_days({ count: 30 }) }
	];

	$effect(() => {
		unsavedChanges?.set('repost-automation', dirty, m.repost_unsaved_changes());
		return () => unsavedChanges?.clear('repost-automation');
	});

	$effect(() => {
		if (!workspaceID || loadedWorkspaceID === workspaceID) return;
		loadedWorkspaceID = workspaceID;
		void loadSettings(workspaceID);
	});

	async function loadSettings(id = workspaceID) {
		loading = true;
		loadError = '';
		try {
			const { data, error } = await client.GET('/repost-automation', {
				params: { query: { workspace_id: id } }
			});
			if (error || !data) throw new Error(error?.detail || m.repost_load_failed());
			if (id !== workspaceID) return;
			settings = data;
			policies = (data.policies ?? []).map(normalizePolicy);
			savedSnapshot = policySnapshot(policies);
		} catch (error) {
			loadError = (error as Error).message || m.repost_load_failed();
		} finally {
			if (id === workspaceID) loading = false;
		}
	}

	async function saveSettings() {
		if (!settings?.can_manage || saving) return;
		const validation = validatePolicies();
		if (validation) {
			saveError = validation;
			return;
		}
		saving = true;
		saveError = '';
		try {
			const { data, error } = await client.PUT('/repost-automation', {
				body: { workspace_id: workspaceID, policies: $state.snapshot(policies) }
			});
			if (error || !data) throw new Error(error?.detail || m.repost_save_failed());
			settings = data;
			policies = (data.policies ?? []).map(normalizePolicy);
			savedSnapshot = policySnapshot(policies);
			showToast(m.repost_saved());
		} catch (error) {
			saveError = (error as Error).message || m.repost_save_failed();
		} finally {
			saving = false;
		}
	}

	function addPolicy() {
		const firstTarget = targetAccounts.find((account) => !account.grant_required);
		policies.push({
			id: crypto.randomUUID(),
			name: m.repost_new_rule(),
			enabled: true,
			source_account_ids: [],
			target_account_ids: firstTarget ? [firstTarget.id] : [],
			rule: defaultRule()
		});
	}

	function removePolicy(index: number) {
		policies.splice(index, 1);
	}

	function toggleSource(policy: RepostPolicy, accountID: string) {
		const selected = policy.source_account_ids ?? [];
		policy.source_account_ids = selected.includes(accountID)
			? selected.filter((id) => id !== accountID)
			: [...selected, accountID];
		if (policy.source_account_ids.length > 0) {
			policy.target_account_ids = (policy.target_account_ids ?? []).filter((targetID) => {
				const target = accounts.find((account) => account.id === targetID);
				return Boolean(target && targetCompatible(policy, target));
			});
		}
	}

	function toggleTarget(policy: RepostPolicy, accountID: string) {
		const selected = policy.target_account_ids ?? [];
		policy.target_account_ids = selected.includes(accountID)
			? selected.filter((id) => id !== accountID)
			: [...selected, accountID];
	}

	function setThreshold(rule: RepostRule, field: keyof RepostRule, value: string) {
		const parsed = Number.parseInt(value, 10);
		if (
			field === 'min_likes' ||
			field === 'min_comments' ||
			field === 'min_reposts' ||
			field === 'min_views'
		) {
			rule[field] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
		}
	}

	function setDelay(policy: RepostPolicy, value: string) {
		const delay = Number(value);
		policy.rule.delay_seconds = delay;
		if (policy.rule.evaluation_window_seconds < delay) {
			policy.rule.evaluation_window_seconds =
				windowOptions.find((option) => option.value >= delay)?.value ?? 2592000;
		}
	}

	function validatePolicies(): string {
		for (const policy of policies) {
			if (!policy.name.trim()) return m.repost_rule_name_required();
			if ((policy.target_account_ids ?? []).length === 0) {
				return m.repost_target_required({ name: policy.name });
			}
			if (policy.rule.evaluation_window_seconds < policy.rule.delay_seconds) {
				return m.repost_window_after_delay({ name: policy.name });
			}
		}
		return '';
	}

	function requestGrantRevocation(grant: RepostGrant) {
		grantToRevoke = grant;
		revokeDialogOpen = true;
	}

	async function revokeGrant() {
		if (!grantToRevoke) return;
		const { error } = await client.DELETE('/repost-account-grants/{grant_id}', {
			params: {
				path: { grant_id: grantToRevoke.id },
				query: { workspace_id: workspaceID }
			}
		});
		if (error) {
			showToast(error.detail || m.repost_revoke_failed(), 'error');
			return;
		}
		showToast(m.repost_access_revoked());
		await loadSettings();
	}

	function normalizePolicy(policy: components['schemas']['PolicyResponse']): RepostPolicy {
		return {
			id: policy.id,
			name: policy.name,
			enabled: policy.enabled,
			source_account_ids: [...(policy.source_account_ids ?? [])],
			target_account_ids: [...(policy.target_account_ids ?? [])],
			rule: { ...policy.rule }
		};
	}

	function defaultRule(): RepostRule {
		return {
			delay_seconds: 86400,
			evaluation_window_seconds: 604800,
			threshold_mode: 'all',
			min_likes: 0,
			min_comments: 0,
			min_reposts: 0,
			min_views: 0,
			require_plateau: false,
			plateau_checks: 2
		};
	}

	function policySnapshot(value: RepostPolicy[]): string {
		return JSON.stringify($state.snapshot(value));
	}

	function accountLabel(account: RepostAccount): string {
		return `@${account.username}`;
	}

	function platformLabel(platform: string): string {
		if (platform === 'x') return 'X';
		if (platform === 'linkedin') return 'LinkedIn';
		if (platform === 'bluesky') return 'Bluesky';
		if (platform === 'mastodon') return 'Mastodon';
		return platform;
	}

	function targetCompatible(policy: RepostPolicy, target: RepostAccount): boolean {
		const selected = policy.source_account_ids ?? [];
		const candidates =
			selected.length === 0
				? sourceAccounts
				: sourceAccounts.filter((account) => selected.includes(account.id));
		return candidates.some((account) => account.platform === target.platform);
	}

	function delayLabel(value: number, options: Array<{ value: number; label: string }>): string {
		return options.find((option) => option.value === value)?.label ?? m.repost_custom_delay();
	}
</script>

<div class="space-y-6" data-testid="repost-automation-settings">
	<SectionHeader title={m.repost_heading()} description={m.repost_description()} icon={Repeat2Icon}>
		{#snippet actions()}
			{#if settings?.can_manage}
				<Button variant="outline" size="sm" onclick={addPolicy} disabled={loading}>
					<PlusIcon class="size-4" />
					{m.repost_add_rule()}
				</Button>
			{/if}
		{/snippet}
	</SectionHeader>

	<InlineNotice tone="info">
		<p>{m.repost_native_notice()}</p>
		<p class="mt-1 text-current/75">{m.repost_analytics_notice()}</p>
	</InlineNotice>

	{#if loading}
		<PageLoading layout="list" label={m.common_loading()} items={4} />
	{:else if loadError}
		<InlineNotice tone="error" message={loadError}>
			{#snippet actions()}
				<Button variant="outline" size="sm" onclick={() => void loadSettings()}>
					{m.common_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else if settings}
		{#if !settings.can_manage}
			<InlineNotice tone="warning" message={m.repost_admin_only()} />
		{/if}

		{#if sourceAccounts.length === 0}
			<InlineNotice tone="warning" message={m.repost_no_supported_accounts()}>
				{#snippet actions()}
					<Button href="/settings?tab=accounts" variant="outline" size="sm">
						{m.repost_connect_account()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}

		<div class="space-y-4">
			{#each policies as policy, index (policy.id)}
				<section
					class="rounded-xl border bg-background"
					aria-labelledby={`repost-rule-${policy.id}`}
				>
					<div class="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
						<div class="min-w-0 flex-1">
							<Label for={`repost-rule-${policy.id}`} class="sr-only">{m.repost_rule_name()}</Label>
							<Input
								id={`repost-rule-${policy.id}`}
								bind:value={policy.name}
								maxlength={80}
								disabled={!settings.can_manage}
								aria-label={m.repost_rule_name()}
								class="max-w-md font-medium"
							/>
						</div>
						<label class="flex min-h-11 items-center gap-2 text-sm">
							<Checkbox bind:checked={policy.enabled} disabled={!settings.can_manage} />
							<span>{m.repost_enabled()}</span>
						</label>
						{#if settings.can_manage}
							<Button
								variant="ghost"
								size="icon-sm"
								class="text-destructive hover:text-destructive"
								onclick={() => removePolicy(index)}
								aria-label={m.repost_remove_rule({ name: policy.name })}
							>
								<TrashIcon class="size-4" />
							</Button>
						{/if}
					</div>

					<div class="space-y-6 p-4 sm:p-5">
						<div class="grid gap-6 xl:grid-cols-2">
							<fieldset class="space-y-3">
								<legend class="text-sm font-medium">{m.repost_source_accounts()}</legend>
								<p class="text-sm text-muted-foreground">{m.repost_source_accounts_body()}</p>
								<label class="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm">
									<Checkbox
										checked={(policy.source_account_ids ?? []).length === 0}
										onCheckedChange={() => (policy.source_account_ids = [])}
										disabled={!settings.can_manage}
									/>
									<span>{m.repost_any_compatible_source()}</span>
								</label>
								<div class="grid gap-2 sm:grid-cols-2">
									{#each sourceAccounts as account (account.id)}
										<label
											class="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm"
										>
											<Checkbox
												checked={(policy.source_account_ids ?? []).includes(account.id)}
												onCheckedChange={() => toggleSource(policy, account.id)}
												disabled={!settings.can_manage}
											/>
											<span class="min-w-0">
												<span class="block truncate font-medium">{accountLabel(account)}</span>
												<span class="block text-xs text-muted-foreground"
													>{platformLabel(account.platform)}</span
												>
											</span>
										</label>
									{/each}
								</div>
							</fieldset>

							<fieldset class="space-y-3">
								<legend class="text-sm font-medium">{m.repost_target_accounts()}</legend>
								<p class="text-sm text-muted-foreground">{m.repost_target_accounts_body()}</p>
								<div class="grid gap-2 sm:grid-cols-2">
									{#each targetAccounts as account (account.id)}
										<label
											class="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm"
										>
											<Checkbox
												checked={(policy.target_account_ids ?? []).includes(account.id)}
												onCheckedChange={() => toggleTarget(policy, account.id)}
												disabled={!settings.can_manage || !targetCompatible(policy, account)}
											/>
											<span class="min-w-0">
												<span class="block truncate font-medium">{accountLabel(account)}</span>
												<span class="block text-xs text-muted-foreground">
													{platformLabel(account.platform)} · {account.workspace_name}
													{#if account.cross_workspace}
														· {account.grant_required
															? m.repost_access_on_save()
															: m.repost_access_granted()}
													{/if}
													{#if !targetCompatible(policy, account)}
														· {m.repost_target_needs_source({
															platform: platformLabel(account.platform)
														})}
													{/if}
												</span>
											</span>
										</label>
									{/each}
								</div>
							</fieldset>
						</div>

						<div class="grid gap-4 border-t pt-5 sm:grid-cols-2">
							<div class="space-y-2">
								<Label for={`repost-delay-${policy.id}`}>{m.repost_delay()}</Label>
								<Select.Root
									type="single"
									value={String(policy.rule.delay_seconds)}
									onValueChange={(value) => setDelay(policy, value)}
									disabled={!settings.can_manage}
								>
									<Select.Trigger
										id={`repost-delay-${policy.id}`}
										class="w-full"
										aria-label={m.repost_delay()}
									>
										{delayLabel(policy.rule.delay_seconds, delayOptions)}
									</Select.Trigger>
									<Select.Content>
										{#each delayOptions as option (option.value)}
											<Select.Item value={String(option.value)}>{option.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="space-y-2">
								<Label for={`repost-window-${policy.id}`}>{m.repost_evaluation_window()}</Label>
								<Select.Root
									type="single"
									value={String(policy.rule.evaluation_window_seconds)}
									onValueChange={(value) => (policy.rule.evaluation_window_seconds = Number(value))}
									disabled={!settings.can_manage}
								>
									<Select.Trigger
										id={`repost-window-${policy.id}`}
										class="w-full"
										aria-label={m.repost_evaluation_window()}
									>
										{delayLabel(policy.rule.evaluation_window_seconds, windowOptions)}
									</Select.Trigger>
									<Select.Content>
										{#each windowOptions as option (option.value)}
											<Select.Item
												value={String(option.value)}
												disabled={option.value < policy.rule.delay_seconds}
												>{option.label}</Select.Item
											>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						</div>

						<fieldset class="space-y-3 border-t pt-5">
							<legend class="text-sm font-medium">{m.repost_engagement_gates()}</legend>
							<p class="text-sm text-muted-foreground">{m.repost_engagement_gates_body()}</p>
							<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
								{#each [['min_likes', m.repost_min_likes()], ['min_comments', m.repost_min_comments()], ['min_reposts', m.repost_min_reposts()], ['min_views', m.repost_min_views()]] as threshold (threshold[0])}
									<div class="space-y-2">
										<Label for={`${threshold[0]}-${policy.id}`}>{threshold[1]}</Label>
										<Input
											id={`${threshold[0]}-${policy.id}`}
											type="number"
											min="0"
											step="1"
											value={String(policy.rule[threshold[0] as keyof RepostRule])}
											oninput={(event) =>
												setThreshold(
													policy.rule,
													threshold[0] as keyof RepostRule,
													(event.target as HTMLInputElement).value
												)}
											disabled={!settings.can_manage}
										/>
									</div>
								{/each}
							</div>

							<RadioGroup.Root
								class="grid gap-2 sm:grid-cols-2"
								value={policy.rule.threshold_mode}
								onValueChange={(value) => (policy.rule.threshold_mode = value as 'all' | 'any')}
								disabled={!settings.can_manage}
								aria-label={m.repost_threshold_mode()}
							>
								{#each [['all', m.repost_require_all(), m.repost_require_all_body()], ['any', m.repost_require_any(), m.repost_require_any_body()]] as option (option[0])}
									<label
										class={[
											'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
											policy.rule.threshold_mode === option[0] && 'border-primary bg-primary/5'
										]}
									>
										<RadioGroup.Item value={option[0]} class="mt-0.5" />
										<span>
											<span class="block text-sm font-medium">{option[1]}</span>
											<span class="block text-xs leading-5 text-muted-foreground">{option[2]}</span>
										</span>
									</label>
								{/each}
							</RadioGroup.Root>

							<div
								class="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<label class="flex min-h-11 items-center gap-3 text-sm">
									<Checkbox
										bind:checked={policy.rule.require_plateau}
										disabled={!settings.can_manage}
									/>
									<span>
										<span class="block font-medium">{m.repost_wait_for_plateau()}</span>
										<span class="block text-xs text-muted-foreground"
											>{m.repost_wait_for_plateau_body()}</span
										>
									</span>
								</label>
								{#if policy.rule.require_plateau}
									<Select.Root
										type="single"
										value={String(policy.rule.plateau_checks)}
										onValueChange={(value) => (policy.rule.plateau_checks = Number(value))}
										disabled={!settings.can_manage}
									>
										<Select.Trigger class="w-full sm:w-48" aria-label={m.repost_unchanged_checks()}>
											{m.repost_check_count({ count: policy.rule.plateau_checks })}
										</Select.Trigger>
										<Select.Content>
											{#each [2, 3, 4, 6, 8, 12] as count (count)}
												<Select.Item value={String(count)}
													>{m.repost_check_count({ count })}</Select.Item
												>
											{/each}
										</Select.Content>
									</Select.Root>
								{/if}
							</div>
						</fieldset>
					</div>
				</section>
			{:else}
				<div class="rounded-xl border border-dashed px-5 py-12 text-center">
					<Repeat2Icon class="mx-auto size-6 text-muted-foreground" />
					<h3 class="mt-3 font-medium">{m.repost_empty_heading()}</h3>
					<p class="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{m.repost_empty_body()}</p>
					{#if settings.can_manage}
						<Button class="mt-4" onclick={addPolicy} disabled={targetAccounts.length === 0}>
							<PlusIcon class="size-4" />
							{m.repost_add_first_rule()}
						</Button>
					{/if}
				</div>
			{/each}
		</div>

		{#if activeGrants.length > 0}
			<section class="space-y-3 border-t pt-6">
				<SectionHeader
					title={m.repost_account_access()}
					description={m.repost_account_access_body()}
					icon={ActivityIcon}
				/>
				<div class="divide-y rounded-xl border">
					{#each activeGrants as grant (grant.id)}
						<div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">
									@{grant.target_username} · {platformLabel(grant.platform)}
								</p>
								<p class="text-sm text-muted-foreground">
									{grant.direction === 'inbound'
										? m.repost_grant_inbound({ source: grant.source_workspace_name })
										: m.repost_grant_outbound({ target: grant.target_workspace_name })}
								</p>
							</div>
							{#if settings.can_manage}
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive"
									onclick={() => requestGrantRevocation(grant)}
								>
									{m.repost_revoke_access()}
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if saveError}
			<InlineNotice tone="error" message={saveError} />
		{/if}
		{#if settings.can_manage}
			<SettingsFormFooter
				label={m.settings_save_changes()}
				savingLabel={m.settings_save_changes()}
				{saving}
				disabled={!dirty || Boolean(validatePolicies())}
				onSave={saveSettings}
			/>
		{/if}
	{/if}
</div>

<DestructiveConfirmDialog
	bind:open={revokeDialogOpen}
	title={m.repost_revoke_title()}
	description={grantToRevoke
		? m.repost_revoke_body({ account: `@${grantToRevoke.target_username}` })
		: ''}
	confirmLabel={m.repost_revoke_access()}
	onConfirm={revokeGrant}
/>
