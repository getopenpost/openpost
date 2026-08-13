<script lang="ts">
	import type { components } from '$lib/api/types';
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import Repeat2Icon from '@lucide/svelte/icons/repeat-2';

	type RepostOverride = components['schemas']['Override'];
	type RepostRule = components['schemas']['Rule'];
	type RepostAccount = components['schemas']['AccountOption'];

	interface Props {
		workspaceID: string;
		sourcePlatforms?: string[];
		value?: RepostOverride;
		disabled?: boolean;
		onChange?: () => void;
	}

	let {
		workspaceID,
		sourcePlatforms = [],
		value = $bindable(defaultOverride()),
		disabled = false,
		onChange
	}: Props = $props();
	let open = $state(false);
	let accounts = $state.raw<RepostAccount[]>([]);
	let loading = $state(false);
	let loadError = $state('');
	let loadedWorkspaceID = $state('');

	const targetAccounts = $derived(
		accounts.filter(
			(account) =>
				account.supports_repost &&
				!account.grant_required &&
				(sourcePlatforms.length === 0 || sourcePlatforms.includes(platformKey(account.platform)))
		)
	);
	const summary = $derived.by(() => {
		if (value.mode === 'off') return m.composer_repost_off();
		if (value.mode === 'custom') {
			const count = value.target_account_ids?.length ?? 0;
			return count === 1 ? m.composer_repost_one_account() : m.composer_repost_accounts({ count });
		}
		return m.composer_repost_workspace_rules();
	});

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
		if (!open || !workspaceID || loadedWorkspaceID === workspaceID) return;
		loadedWorkspaceID = workspaceID;
		void loadAccounts(workspaceID);
	});

	$effect(() => {
		if (value.mode !== 'custom' || loadedWorkspaceID !== workspaceID || loading) return;
		const validIDs = new Set(targetAccounts.map((account) => account.id));
		const selected = value.target_account_ids ?? [];
		const compatible = selected.filter((id) => validIDs.has(id));
		if (compatible.length === selected.length) return;
		value.target_account_ids = compatible;
		onChange?.();
	});

	async function loadAccounts(id: string) {
		loading = true;
		loadError = '';
		try {
			const { data, error } = await client.GET('/repost-automation', {
				params: { query: { workspace_id: id } }
			});
			if (error || !data) throw new Error(error?.detail || m.repost_load_failed());
			if (workspaceID !== id) return;
			accounts = data.accounts ?? [];
			if (value.mode === 'custom' && (value.target_account_ids?.length ?? 0) === 0) {
				const firstTarget = accounts.find(
					(account) =>
						account.supports_repost &&
						!account.grant_required &&
						(sourcePlatforms.length === 0 ||
							sourcePlatforms.includes(platformKey(account.platform)))
				);
				if (firstTarget) {
					value.target_account_ids = [firstTarget.id];
					onChange?.();
				}
			}
		} catch (error) {
			loadError = (error as Error).message || m.repost_load_failed();
		} finally {
			if (workspaceID === id) loading = false;
		}
	}

	function setMode(mode: RepostOverride['mode']) {
		if (mode === 'inherit') {
			value = { mode: 'inherit' };
			onChange?.();
			return;
		}
		if (mode === 'off') {
			value = { mode: 'off' };
			onChange?.();
			return;
		}
		const firstTarget = targetAccounts[0];
		value = {
			mode: 'custom',
			target_account_ids: value.target_account_ids?.length
				? [...value.target_account_ids]
				: firstTarget
					? [firstTarget.id]
					: [],
			rule: value.rule ? { ...value.rule } : defaultRule()
		};
		onChange?.();
	}

	function toggleTarget(accountID: string) {
		if (value.mode !== 'custom') return;
		const selected = value.target_account_ids ?? [];
		value.target_account_ids = selected.includes(accountID)
			? selected.filter((id) => id !== accountID)
			: [...selected, accountID];
		onChange?.();
	}

	function setDelay(seconds: number) {
		if (value.mode !== 'custom' || !value.rule) return;
		value.rule.delay_seconds = seconds;
		if (value.rule.evaluation_window_seconds < seconds) {
			value.rule.evaluation_window_seconds =
				windowOptions.find((option) => option.value >= seconds)?.value ?? 2592000;
		}
		onChange?.();
	}

	function setThreshold(
		field: 'min_likes' | 'min_comments' | 'min_reposts' | 'min_views',
		raw: string
	) {
		if (value.mode !== 'custom' || !value.rule) return;
		const parsed = Number.parseInt(raw, 10);
		value.rule[field] = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
		onChange?.();
	}

	function updateRule(mutator: (rule: RepostRule) => void) {
		if (value.mode !== 'custom' || !value.rule) return;
		mutator(value.rule);
		onChange?.();
	}

	function delayLabel(value: number, options: Array<{ value: number; label: string }>) {
		return options.find((option) => option.value === value)?.label ?? m.repost_custom_delay();
	}

	function accountLabel(account: RepostAccount) {
		return `@${account.username} · ${account.platform === 'x' ? 'X' : account.platform}`;
	}

	function platformKey(platform: string) {
		return platform.toLowerCase().split(':', 1)[0];
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

	function defaultOverride(): RepostOverride {
		return { mode: 'inherit' };
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="sm"
				class="max-w-full"
				{disabled}
				aria-label={m.composer_repost_settings()}
			>
				<Repeat2Icon class="size-4 shrink-0" />
				<span class="truncate">{summary}</span>
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class="max-h-[min(72vh,42rem)] w-[min(92vw,30rem)] overflow-y-auto p-0"
	>
		<div class="border-b p-4">
			<h3 class="font-medium">{m.composer_repost_settings()}</h3>
			<p class="mt-1 text-sm text-muted-foreground">{m.composer_repost_settings_body()}</p>
		</div>

		<RadioGroup.Root
			class="grid gap-2 p-4"
			value={value.mode}
			onValueChange={(mode) => setMode(mode as RepostOverride['mode'])}
			aria-label={m.composer_repost_settings()}
		>
			{#each [['inherit', m.composer_repost_default(), m.composer_repost_default_body()], ['off', m.composer_repost_never(), m.composer_repost_never_body()], ['custom', m.composer_repost_custom(), m.composer_repost_custom_body()]] as option (option[0])}
				<label
					class={[
						'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3',
						value.mode === option[0] && 'border-primary bg-primary/5'
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

		{#if value.mode === 'custom' && value.rule}
			<div class="space-y-5 border-t p-4">
				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">{m.repost_target_accounts()}</legend>
					{#if loading}
						<p class="text-sm text-muted-foreground">{m.common_loading()}</p>
					{:else if loadError}
						<p class="text-sm text-destructive">{loadError}</p>
					{:else}
						<div class="grid gap-2 sm:grid-cols-2">
							{#each targetAccounts as account (account.id)}
								<label class="flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm">
									<Checkbox
										checked={(value.target_account_ids ?? []).includes(account.id)}
										onCheckedChange={() => toggleTarget(account.id)}
									/>
									<span class="truncate">{accountLabel(account)}</span>
								</label>
							{:else}
								<p class="text-sm text-muted-foreground sm:col-span-2">
									{m.repost_no_supported_accounts()}
								</p>
							{/each}
						</div>
					{/if}
				</fieldset>

				<div class="grid gap-3 sm:grid-cols-2">
					<div class="space-y-2">
						<Label>{m.repost_delay()}</Label>
						<Select.Root
							type="single"
							value={String(value.rule.delay_seconds)}
							onValueChange={(raw) => setDelay(Number(raw))}
						>
							<Select.Trigger class="w-full" aria-label={m.repost_delay()}
								>{delayLabel(value.rule.delay_seconds, delayOptions)}</Select.Trigger
							>
							<Select.Content>
								{#each delayOptions as option (option.value)}
									<Select.Item value={String(option.value)}>{option.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="space-y-2">
						<Label>{m.repost_evaluation_window()}</Label>
						<Select.Root
							type="single"
							value={String(value.rule.evaluation_window_seconds)}
							onValueChange={(raw) =>
								updateRule((rule) => (rule.evaluation_window_seconds = Number(raw)))}
						>
							<Select.Trigger class="w-full" aria-label={m.repost_evaluation_window()}
								>{delayLabel(value.rule.evaluation_window_seconds, windowOptions)}</Select.Trigger
							>
							<Select.Content>
								{#each windowOptions as option (option.value)}
									<Select.Item
										value={String(option.value)}
										disabled={option.value < value.rule.delay_seconds}>{option.label}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<div class="space-y-3 border-t pt-4">
					<p class="text-sm font-medium">{m.repost_engagement_gates()}</p>
					<div class="grid grid-cols-2 gap-3">
						{#each [['min_likes', m.repost_min_likes()], ['min_comments', m.repost_min_comments()], ['min_reposts', m.repost_min_reposts()], ['min_views', m.repost_min_views()]] as threshold (threshold[0])}
							<div class="space-y-1.5">
								<Label for={`composer-repost-${threshold[0]}`}>{threshold[1]}</Label>
								<Input
									id={`composer-repost-${threshold[0]}`}
									type="number"
									min="0"
									value={String(value.rule[threshold[0] as keyof RepostRule])}
									oninput={(event) =>
										setThreshold(
											threshold[0] as 'min_likes' | 'min_comments' | 'min_reposts' | 'min_views',
											(event.target as HTMLInputElement).value
										)}
								/>
							</div>
						{/each}
					</div>
					<Select.Root
						type="single"
						value={value.rule.threshold_mode}
						onValueChange={(mode) =>
							updateRule((rule) => (rule.threshold_mode = mode as 'all' | 'any'))}
					>
						<Select.Trigger class="w-full" aria-label={m.repost_threshold_mode()}
							>{value.rule.threshold_mode === 'all'
								? m.repost_require_all()
								: m.repost_require_any()}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="all">{m.repost_require_all()}</Select.Item>
							<Select.Item value="any">{m.repost_require_any()}</Select.Item>
						</Select.Content>
					</Select.Root>
					<label class="flex min-h-11 items-center gap-3 rounded-md border bg-muted/20 p-3 text-sm">
						<Checkbox
							checked={value.rule.require_plateau}
							onCheckedChange={(checked) => updateRule((rule) => (rule.require_plateau = checked))}
						/>
						<span>{m.repost_wait_for_plateau()}</span>
					</label>
					{#if value.rule.require_plateau}
						<Select.Root
							type="single"
							value={String(value.rule.plateau_checks)}
							onValueChange={(raw) => updateRule((rule) => (rule.plateau_checks = Number(raw)))}
						>
							<Select.Trigger class="w-full" aria-label={m.repost_unchanged_checks()}
								>{m.repost_check_count({ count: value.rule.plateau_checks })}</Select.Trigger
							>
							<Select.Content>
								{#each [2, 3, 4, 6, 8, 12] as count (count)}
									<Select.Item value={String(count)}>{m.repost_check_count({ count })}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				</div>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
