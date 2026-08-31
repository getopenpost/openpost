<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from './app-select.svelte';
	import SocialAccountAvatar from './social-account-avatar.svelte';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import { settingLabel } from '$lib/setting-label';
	import type { ComposerSettings, ComposerSettingValue } from '$lib/components/compose/modes';
	import {
		activeRequiredDestinationFields,
		requiredFieldIsMissing
	} from './compose/required-destination-fields';

	type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
	type DestinationOption = components['schemas']['DestinationOption'];
	type SettingDefinition = components['schemas']['SettingDefinition'];

	interface Props {
		accounts: SocialAccount[];
		resolvedByAccount: Record<string, ResolvedAccountCapability>;
		valuesByAccount: Record<string, ComposerSettings>;
		optionGroupsByAccount: Record<string, Record<string, DestinationOption[]>>;
		optionErrorsByAccount?: Record<string, string>;
		optionsLoadingAccountId?: string;
		onChange: (account: SocialAccount, key: string, value: ComposerSettingValue) => void;
		onFormatChange: (account: SocialAccount, outputProfile: string) => void;
		onAddMedia: () => void;
		mediaActionDisabled?: boolean;
	}

	let {
		accounts,
		resolvedByAccount,
		valuesByAccount,
		optionGroupsByAccount,
		optionErrorsByAccount = {},
		optionsLoadingAccountId = '',
		onChange,
		onFormatChange,
		onAddMedia,
		mediaActionDisabled = false
	}: Props = $props();

	const accountById = $derived(new Map(accounts.map((account) => [account.id, account])));
	const requiredFields = $derived(
		activeRequiredDestinationFields(
			accounts.map((account) => account.id),
			resolvedByAccount,
			valuesByAccount
		)
	);
	const formatAccounts = $derived(
		accounts.filter((account) => resolvedByAccount[account.id]?.format_selection_required)
	);
	const mediaAccounts = $derived(
		accounts.filter((account) =>
			(resolvedByAccount[account.id]?.issues ?? []).some((issue) => issue.code === 'media_required')
		)
	);
	const visible = $derived(
		requiredFields.length > 0 || formatAccounts.length > 0 || mediaAccounts.length > 0
	);

	function accountLabel(account: SocialAccount): string {
		return (
			formatSocialAccountName(account.account_username, account.platform) ||
			account.slug ||
			getPlatformName(account.platform)
		);
	}

	function accountContextLabel(account: SocialAccount): string {
		return `${accountLabel(account)} · ${getPlatformName(account.platform)}`;
	}

	function valueAsString(accountId: string, key: string): string {
		const value = valuesByAccount[accountId]?.[key];
		return value === undefined || value === null ? '' : String(value);
	}

	function optionsFor(accountId: string, setting: SettingDefinition) {
		if (setting.options_source) {
			return (optionGroupsByAccount[accountId]?.[setting.options_source] ?? []).map((option) => ({
				value: option.value,
				label: option.label
			}));
		}
		return (setting.options ?? []).map((option) => ({ value: option, label: option }));
	}
</script>

{#if visible}
	<section
		class="mb-5 rounded-xl border border-border/70 bg-muted/15 p-4"
		aria-labelledby="required-destination-fields-title"
	>
		<div class="mb-4 flex items-start justify-between gap-3">
			<div>
				<h2 id="required-destination-fields-title" class="text-sm font-semibold">
					{m.compose_required_details()}
				</h2>
				<p class="mt-1 text-xs text-muted-foreground">{m.compose_required_details_body()}</p>
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			{#each formatAccounts as account (account.id)}
				{@const capability = resolvedByAccount[account.id]}
				<div>
					<label
						class="flex items-center gap-1.5 text-sm font-medium"
						for="required-format-{account.id}"
					>
						<SocialAccountAvatar
							name={accountLabel(account)}
							platform={account.platform}
							avatarUrl={account.account_avatar_url}
							size="sm"
						/>
						{m.compose_format_for_account({ account: accountContextLabel(account) })}
						<span class="text-destructive" aria-hidden="true">*</span>
					</label>
					<AppSelect
						value=""
						options={(capability.available_formats ?? [])
							.filter((format) => format.compatible)
							.map((format) => ({ value: format.output_profile, label: format.label }))}
						placeholder={m.compose_choose_format()}
						ariaLabel={m.compose_format_for_account({ account: accountContextLabel(account) })}
						class="mt-1 h-11"
						onValueChange={(value) => onFormatChange(account, value)}
					/>
				</div>
			{/each}

			{#each requiredFields as field (`${field.accountId}:${field.setting.key}`)}
				{@const account = accountById.get(field.accountId)}
				{#if account}
					{@const setting = field.setting}
					{@const missing = requiredFieldIsMissing(setting, valuesByAccount[account.id] ?? {})}
					<div class={setting.type === 'textarea' ? 'sm:col-span-2' : ''}>
						{#if setting.type === 'boolean'}
							<label
								class="flex min-h-11 items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
							>
								<Checkbox
									checked={valuesByAccount[account.id]?.[setting.key] === true}
									onCheckedChange={(checked) => onChange(account, setting.key, checked)}
								/>
								<SocialAccountAvatar
									name={accountLabel(account)}
									platform={account.platform}
									avatarUrl={account.account_avatar_url}
									size="sm"
								/>
								<span>{settingLabel(setting)}</span>
								<span class="sr-only">{accountContextLabel(account)}</span>
							</label>
						{:else}
							<label
								class="flex items-center gap-1.5 text-sm font-medium"
								for="required-{account.id}-{setting.key}"
							>
								<SocialAccountAvatar
									name={accountLabel(account)}
									platform={account.platform}
									avatarUrl={account.account_avatar_url}
									size="sm"
								/>
								{settingLabel(setting)} · {accountContextLabel(account)}
								<span class="text-destructive" aria-hidden="true">*</span>
							</label>
							{#if setting.control === 'select' || setting.control === 'remote_picker' || setting.type === 'select'}
								<AppSelect
									value={valueAsString(account.id, setting.key)}
									options={optionsFor(account.id, setting)}
									placeholder={m.compose_choose_value({ field: settingLabel(setting) })}
									ariaLabel={`${settingLabel(setting)} · ${accountContextLabel(account)}`}
									class="mt-1 h-11"
									disabled={setting.control === 'remote_picker' &&
										optionsLoadingAccountId === account.id}
									onValueChange={(value) => onChange(account, setting.key, value)}
								/>
								{#if setting.control === 'remote_picker' && optionErrorsByAccount[account.id]}
									<p class="mt-1 text-xs text-destructive">{optionErrorsByAccount[account.id]}</p>
								{/if}
							{:else if setting.type === 'textarea'}
								<Textarea
									id="required-{account.id}-{setting.key}"
									value={valueAsString(account.id, setting.key)}
									class="mt-1 min-h-24"
									aria-invalid={missing}
									oninput={(event) => onChange(account, setting.key, event.currentTarget.value)}
								/>
							{:else}
								<Input
									id="required-{account.id}-{setting.key}"
									type={setting.type === 'number'
										? 'number'
										: setting.type === 'url'
											? 'url'
											: 'text'}
									value={valueAsString(account.id, setting.key)}
									class="mt-1 h-11"
									aria-invalid={missing}
									oninput={(event) => onChange(account, setting.key, event.currentTarget.value)}
								/>
							{/if}
						{/if}
					</div>
				{/if}
			{/each}

			{#if mediaAccounts.length > 0}
				<div
					class="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 sm:col-span-2"
				>
					<div class="min-w-0">
						<p class="text-sm font-medium">{m.compose_media_required()}</p>
						<p class="truncate text-xs text-muted-foreground">
							{mediaAccounts.map(accountContextLabel).join(', ')}
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="h-9 shrink-0"
						disabled={mediaActionDisabled}
						aria-busy={mediaActionDisabled}
						onclick={onAddMedia}
					>
						{m.media_picker_add_media()}
					</Button>
				</div>
			{/if}
		</div>
	</section>
{/if}
