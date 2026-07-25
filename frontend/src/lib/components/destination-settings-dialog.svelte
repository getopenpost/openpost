<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import RotateCcwIcon from 'lucide-svelte/icons/rotate-ccw';
	import { onDestroy } from 'svelte';
	import InlineNotice from './inline-notice.svelte';
	import PlatformIcon from './platform-icon.svelte';
	import PollBuilder from './compose/poll-builder.svelte';
	import MediaTagEditor from './compose/media-tag-editor.svelte';
	import TagInput from './tag-input.svelte';

	type SettingDefinition = components['schemas']['SettingDefinition'];
	type SettingCondition = components['schemas']['SettingCondition'];
	type DestinationOption = components['schemas']['DestinationOption'];
	type SettingGroup = SettingDefinition['group'];

	interface DestinationMediaItem {
		id: string;
		label: string;
		mimeType: string;
	}

	interface Props {
		open?: boolean;
		account: SocialAccount | null;
		settings: SettingDefinition[];
		values: Record<string, unknown>;
		mediaItems?: DestinationMediaItem[];
		mediaValues?: Record<string, Record<string, unknown>>;
		optionGroups?: Record<string, DestinationOption[]>;
		optionsLoading?: boolean;
		optionsError?: string;
		scopeLabel?: string;
		onChange: (key: string, value: unknown) => void;
		onMediaChange?: (mediaId: string, key: string, value: unknown) => void;
		onOptionSearch?: (setting: SettingDefinition, search: string) => void;
		onRetry?: () => void;
		onFileChange?: (setting: SettingDefinition, file: File) => void;
		onRemove?: () => void;
	}

	let {
		open = $bindable(false),
		account,
		settings,
		values,
		mediaItems = [],
		mediaValues = {},
		optionGroups = {},
		optionsLoading = false,
		optionsError = '',
		scopeLabel = '',
		onChange,
		onMediaChange,
		onOptionSearch,
		onRetry,
		onFileChange,
		onRemove
	}: Props = $props();

	let searchBySetting = $state<Record<string, string>>({});
	let searchTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	const groupOrder: SettingGroup[] = [
		'content',
		'conversation',
		'distribution',
		'disclosure',
		'media_accessibility'
	];
	const groupedSettings = $derived(
		groupOrder
			.map((group) => ({
				group,
				settings: settings.filter(
					(setting) =>
						setting.scope !== 'media_item' &&
						setting.group === group &&
						dependenciesMet(setting, values)
				)
			}))
			.filter((entry) => entry.settings.length > 0)
	);
	const mediaSettings = $derived(settings.filter((setting) => setting.scope === 'media_item'));

	function valueAsString(key: string, scopedValues = values): string {
		const value = scopedValues[key];
		return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
	}

	function valueAsBoolean(key: string, scopedValues = values): boolean {
		return Boolean(scopedValues[key]);
	}

	function dynamicOptions(setting: SettingDefinition): DestinationOption[] {
		if (!setting.options_source) return [];
		const query = searchBySetting[setting.key]?.trim().toLocaleLowerCase() ?? '';
		const options = optionGroups[setting.options_source] ?? [];
		if (!query) return options;
		return options.filter((option) => option.label.toLocaleLowerCase().includes(query));
	}

	function groupLabel(group: SettingGroup): string {
		switch (group) {
			case 'content':
				return m.compose_setting_group_content();
			case 'conversation':
				return m.compose_setting_group_conversation();
			case 'distribution':
				return m.compose_setting_group_distribution();
			case 'disclosure':
				return m.compose_setting_group_disclosure();
			case 'media_accessibility':
				return m.compose_setting_group_media_accessibility();
		}
	}

	function dependenciesMet(
		setting: SettingDefinition,
		scopedValues: Record<string, unknown>
	): boolean {
		return (setting.dependencies ?? []).every((condition) =>
			conditionMatches(condition, scopedValues)
		);
	}

	function conditionMatches(
		condition: SettingCondition,
		scopedValues: Record<string, unknown>
	): boolean {
		const value = scopedValues[condition.key];
		const present = value !== undefined && value !== null && String(value).trim() !== '';
		switch (condition.operator) {
			case 'present':
				return present;
			case 'absent':
				return !present;
			case 'equals':
				return value === condition.value;
			case 'not_equals':
				return value !== condition.value;
			case 'in':
				return Array.isArray(condition.value) && condition.value.includes(value);
		}
	}

	function controlFor(setting: SettingDefinition): string {
		return setting.control || setting.type;
	}

	function settingLabel(setting: SettingDefinition): string {
		const messageKey = setting.message_key.replaceAll('.', '_');
		const message = (m as unknown as Record<string, () => string>)[messageKey];
		return typeof message === 'function' ? message() : setting.label;
	}

	function inputType(setting: SettingDefinition): 'number' | 'url' | 'text' {
		if (setting.type === 'number') return 'number';
		if (setting.type === 'url' || setting.control === 'quote_url') return 'url';
		return 'text';
	}

	function updateOptionSearch(setting: SettingDefinition, search: string) {
		searchBySetting = { ...searchBySetting, [setting.key]: search };
		if (!onOptionSearch) return;
		clearTimeout(searchTimers[setting.key]);
		searchTimers[setting.key] = setTimeout(() => onOptionSearch(setting, search), 250);
	}

	onDestroy(() => {
		for (const timer of Object.values(searchTimers)) clearTimeout(timer);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col rounded-none p-0 sm:h-auto sm:max-h-[85vh] sm:max-w-xl sm:rounded-lg"
	>
		<Dialog.Header class="shrink-0 border-b px-5 py-4 text-left">
			<Dialog.Title>
				<span class="flex items-center gap-2">
					{#if account}
						<PlatformIcon platform={account.platform} class="size-4" />
					{/if}
					{account
						? m.compose_account_settings({ platform: getPlatformName(account.platform) })
						: m.compose_platform_settings()}
				</span>
			</Dialog.Title>
			<Dialog.Description>
				{account?.account_username
					? m.compose_account_settings_body({ account: account.account_username })
					: m.compose_platform_settings_body()}
				{#if scopeLabel}
					<span class="mt-1 block font-medium text-foreground">{scopeLabel}</span>
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
			{#if optionsError}
				<InlineNotice tone="error" message={optionsError}>
					{#snippet actions()}
						{#if onRetry}
							<Button type="button" variant="outline" size="sm" onclick={onRetry}>
								<RotateCcwIcon class="size-3.5" />
								{m.common_retry()}
							</Button>
						{/if}
					{/snippet}
				</InlineNotice>
			{/if}

			{#each groupedSettings as entry (entry.group)}
				<section class="space-y-3" aria-labelledby="setting-group-{entry.group}">
					<h3
						id="setting-group-{entry.group}"
						class="border-b pb-2 text-sm font-semibold text-foreground"
					>
						{groupLabel(entry.group)}
					</h3>

					<div class="grid gap-4 sm:grid-cols-2">
						{#each entry.settings as setting (setting.key)}
							{@const remoteOptions = dynamicOptions(setting)}
							{@const control = controlFor(setting)}
							<div
								class={control === 'poll' ||
								setting.type === 'textarea' ||
								setting.type === 'tags' ||
								control === 'follow_up'
									? 'sm:col-span-2'
									: ''}
							>
								{#if setting.unavailable_reason}
									<p class="text-sm font-medium text-foreground">{settingLabel(setting)}</p>
									<p class="mt-1 text-xs text-muted-foreground">
										{setting.unavailable_reason}
									</p>
								{:else if setting.type === 'boolean'}
									<label class="flex min-h-11 items-center gap-3 text-sm">
										<input
											type="checkbox"
											class="size-5 rounded border accent-primary"
											checked={valueAsBoolean(setting.key)}
											disabled={Boolean(setting.unavailable_reason)}
											onchange={(event) => onChange(setting.key, event.currentTarget.checked)}
										/>
										<span>{settingLabel(setting)}</span>
									</label>
								{:else}
									<label class="text-sm font-medium" for="destination-setting-{setting.key}">
										{settingLabel(setting)}
										{#if setting.required}
											<span class="text-destructive" aria-hidden="true">*</span>
										{/if}
									</label>

									{#if control === 'poll'}
										<div class="mt-2">
											<PollBuilder
												id="destination-setting-{setting.key}"
												value={valueAsString(setting.key)}
												constraints={setting.constraints}
												onChange={(value) => onChange(setting.key, value)}
											/>
										</div>
									{:else if control === 'remote_picker'}
										<div class="mt-1 space-y-2">
											<Input
												aria-label={m.compose_search_options()}
												placeholder={m.compose_search_options()}
												value={searchBySetting[setting.key] ?? ''}
												oninput={(event) => updateOptionSearch(setting, event.currentTarget.value)}
											/>
											<select
												id="destination-setting-{setting.key}"
												class="h-11 w-full rounded-md border bg-background px-3 text-sm"
												value={valueAsString(setting.key)}
												disabled={optionsLoading || Boolean(setting.unavailable_reason)}
												onchange={(event) => onChange(setting.key, event.currentTarget.value)}
											>
												<option value="" disabled={setting.required}>
													{setting.required
														? m.compose_choose_setting({ setting: settingLabel(setting) })
														: m.common_none()}
												</option>
												{#each remoteOptions as option (option.value)}
													<option value={option.value}>{option.label}</option>
												{/each}
											</select>
											{#if optionsLoading}
												<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
													<LoaderIcon class="size-3 animate-spin" />
													{m.compose_loading_provider_options()}
												</p>
											{:else if !optionsError && remoteOptions.length === 0}
												<p class="text-xs text-muted-foreground">
													{m.compose_no_provider_options({ setting: settingLabel(setting) })}
												</p>
											{/if}
										</div>
									{:else if setting.type === 'select'}
										<select
											id="destination-setting-{setting.key}"
											class="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
											value={valueAsString(setting.key)}
											disabled={Boolean(setting.unavailable_reason)}
											onchange={(event) => onChange(setting.key, event.currentTarget.value)}
										>
											<option value="" disabled={setting.required}>
												{setting.required
													? m.compose_choose_setting({ setting: settingLabel(setting) })
													: m.common_none()}
											</option>
											{#each setting.options ?? [] as option (option)}
												<option value={option}>{option}</option>
											{/each}
										</select>
									{:else if ['tags', 'language', 'chips', 'user_picker', 'media_tags'].includes(control)}
										<TagInput
											id="destination-setting-{setting.key}"
											value={valueAsString(setting.key)}
											onChange={(value) => onChange(setting.key, value)}
										/>
									{:else if ['media_picker', 'captions_file'].includes(control) && onFileChange}
										<Input
											id="destination-setting-{setting.key}"
											class="mt-1 h-11 file:mr-3"
											type="file"
											accept={(setting.constraints?.accept ?? []).join(',')}
											onchange={(event) => {
												const file = event.currentTarget.files?.[0];
												if (file) onFileChange?.(setting, file);
											}}
										/>
									{:else if setting.type === 'textarea' || control === 'follow_up'}
										<Textarea
											id="destination-setting-{setting.key}"
											class="mt-1 min-h-24"
											value={valueAsString(setting.key)}
											disabled={Boolean(setting.unavailable_reason)}
											oninput={(event) => onChange(setting.key, event.currentTarget.value)}
										/>
									{:else}
										<Input
											id="destination-setting-{setting.key}"
											class="mt-1 h-11"
											type={inputType(setting)}
											value={valueAsString(setting.key)}
											min={setting.constraints?.minimum}
											max={setting.constraints?.maximum}
											maxlength={setting.constraints?.max_length}
											disabled={Boolean(setting.unavailable_reason)}
											oninput={(event) => onChange(setting.key, event.currentTarget.value)}
										/>
									{/if}
								{/if}

								{#if !setting.unavailable_reason && setting.help}
									<p class="mt-1 text-xs text-muted-foreground">{setting.help}</p>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/each}

			{#if mediaSettings.length > 0 && mediaItems.length > 0 && onMediaChange}
				<section class="space-y-3" aria-labelledby="setting-group-media-items">
					<h3
						id="setting-group-media-items"
						class="border-b pb-2 text-sm font-semibold text-foreground"
					>
						{m.compose_setting_group_media_accessibility()}
					</h3>

					<div class="space-y-3">
						{#each mediaItems as item, mediaIndex (item.id)}
							{@const scopedValues = mediaValues[item.id] ?? {}}
							{@const applicableSettings = mediaSettings.filter((setting) =>
								dependenciesMet(setting, scopedValues)
							)}
							{#if applicableSettings.length > 0}
								<fieldset class="space-y-3 rounded-md border p-3">
									<legend class="max-w-full truncate px-1 text-xs font-semibold text-foreground">
										{mediaIndex + 1}. {item.label}
									</legend>
									<div class="grid gap-4 sm:grid-cols-2">
										{#each applicableSettings as setting (setting.key)}
											{@const remoteOptions = dynamicOptions(setting)}
											{@const control = controlFor(setting)}
											<div
												class={setting.type === 'textarea' ||
												setting.type === 'tags' ||
												['media_tags', 'chips', 'user_picker'].includes(control)
													? 'sm:col-span-2'
													: ''}
											>
												{#if setting.unavailable_reason}
													<p class="text-sm font-medium text-foreground">{settingLabel(setting)}</p>
													<p class="mt-1 text-xs text-muted-foreground">
														{setting.unavailable_reason}
													</p>
												{:else if setting.type === 'boolean'}
													<label class="flex min-h-11 items-center gap-3 text-sm">
														<input
															type="checkbox"
															class="size-5 rounded border accent-primary"
															checked={valueAsBoolean(setting.key, scopedValues)}
															disabled={Boolean(setting.unavailable_reason)}
															onchange={(event) =>
																onMediaChange?.(item.id, setting.key, event.currentTarget.checked)}
														/>
														<span>{settingLabel(setting)}</span>
													</label>
												{:else}
													<label
														class="text-sm font-medium"
														for="destination-media-{item.id}-{setting.key}"
													>
														{settingLabel(setting)}
														{#if setting.required}
															<span class="text-destructive" aria-hidden="true">*</span>
														{/if}
													</label>

													{#if control === 'remote_picker'}
														<select
															id="destination-media-{item.id}-{setting.key}"
															class="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
															value={valueAsString(setting.key, scopedValues)}
															disabled={optionsLoading || Boolean(setting.unavailable_reason)}
															onchange={(event) =>
																onMediaChange?.(item.id, setting.key, event.currentTarget.value)}
														>
															<option value="" disabled={setting.required}>
																{setting.required
																	? m.compose_choose_setting({ setting: settingLabel(setting) })
																	: m.common_none()}
															</option>
															{#each remoteOptions as option (option.value)}
																<option value={option.value}>{option.label}</option>
															{/each}
														</select>
													{:else if setting.type === 'select'}
														<select
															id="destination-media-{item.id}-{setting.key}"
															class="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm"
															value={valueAsString(setting.key, scopedValues)}
															disabled={Boolean(setting.unavailable_reason)}
															onchange={(event) =>
																onMediaChange?.(item.id, setting.key, event.currentTarget.value)}
														>
															<option value="" disabled={setting.required}>
																{setting.required
																	? m.compose_choose_setting({ setting: settingLabel(setting) })
																	: m.common_none()}
															</option>
															{#each setting.options ?? [] as option (option)}
																<option value={option}>{option}</option>
															{/each}
														</select>
													{:else if control === 'media_tags'}
														<MediaTagEditor
															id="destination-media-{item.id}-{setting.key}"
															value={valueAsString(setting.key, scopedValues)}
															valueKey={setting.key === 'product_tags' ? 'product_id' : 'username'}
															maximum={setting.constraints?.max_items ?? 20}
															coordinatesRequired={setting.key === 'user_tags'}
															disabled={Boolean(setting.unavailable_reason)}
															onChange={(value) => onMediaChange?.(item.id, setting.key, value)}
														/>
													{:else if ['tags', 'language', 'chips', 'user_picker'].includes(control)}
														<TagInput
															id="destination-media-{item.id}-{setting.key}"
															value={valueAsString(setting.key, scopedValues)}
															onChange={(value) => onMediaChange?.(item.id, setting.key, value)}
														/>
													{:else if setting.type === 'textarea'}
														<Textarea
															id="destination-media-{item.id}-{setting.key}"
															class="mt-1 min-h-24"
															value={valueAsString(setting.key, scopedValues)}
															disabled={Boolean(setting.unavailable_reason)}
															oninput={(event) =>
																onMediaChange?.(item.id, setting.key, event.currentTarget.value)}
														/>
													{:else}
														<Input
															id="destination-media-{item.id}-{setting.key}"
															class="mt-1 h-11"
															type={inputType(setting)}
															value={valueAsString(setting.key, scopedValues)}
															min={setting.constraints?.minimum}
															max={setting.constraints?.maximum}
															maxlength={setting.constraints?.max_length}
															disabled={Boolean(setting.unavailable_reason)}
															oninput={(event) =>
																onMediaChange?.(item.id, setting.key, event.currentTarget.value)}
														/>
													{/if}
												{/if}

												{#if !setting.unavailable_reason && setting.help}
													<p class="mt-1 text-xs text-muted-foreground">{setting.help}</p>
												{/if}
											</div>
										{/each}
									</div>
								</fieldset>
							{/if}
						{/each}
					</div>
				</section>
			{/if}
		</div>

		<Dialog.Footer class="shrink-0 border-t px-5 py-4">
			{#if onRemove}
				<Button
					type="button"
					variant="destructive"
					class="h-11 sm:mr-auto sm:h-9"
					onclick={onRemove}
				>
					{m.compose_delete_destination()}
				</Button>
			{/if}
			<Button type="button" class="h-11 sm:h-9" onclick={() => (open = false)}>
				{m.common_done()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
