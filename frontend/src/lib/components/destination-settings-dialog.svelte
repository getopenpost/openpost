<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from './app-select.svelte';
	import DestinationOptionCombobox from './destination-option-combobox.svelte';
	import SocialAccountIdentity from './social-account-identity.svelte';
	import { formatSocialAccountName, getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import { onDestroy } from 'svelte';
	import InlineNotice from './inline-notice.svelte';
	import PollBuilder from './compose/poll-builder.svelte';
	import MediaTagEditor from './compose/media-tag-editor.svelte';
	import TagInput from './tag-input.svelte';
	import VideoCoverFramePicker, {
		type GeneratedCoverFrame
	} from './video-cover-frame-picker.svelte';
	import type { ComposerSettingValue } from '$lib/components/compose/modes';
	import { settingLabel } from '$lib/setting-label';

	type SettingDefinition = components['schemas']['SettingDefinition'];
	type SettingCondition = components['schemas']['SettingCondition'];
	type DestinationOption = components['schemas']['DestinationOption'];
	type SettingGroup = SettingDefinition['group'];
	type DestinationSettings = import('$lib/components/compose/modes').ComposerSettings;

	interface DestinationMediaItem {
		id: string;
		label: string;
		mimeType: string;
	}

	interface Props {
		open?: boolean;
		account: SocialAccount | null;
		settings: SettingDefinition[];
		values: DestinationSettings;
		mediaItems?: DestinationMediaItem[];
		mediaValues?: Record<string, DestinationSettings>;
		optionGroups?: Record<string, DestinationOption[]>;
		optionNextCursors?: Record<string, string>;
		optionsLoading?: boolean;
		optionsError?: string;
		scopeLabel?: string;
		formatValue?: string;
		formatOptions?: Array<{ value: string; label: string }>;
		formatRequired?: boolean;
		onChange: (key: string, value: ComposerSettingValue) => void;
		onFormatChange?: (value: string) => void;
		onMediaChange?: (mediaId: string, key: string, value: ComposerSettingValue) => void;
		onOptionSearch?: (setting: SettingDefinition, search: string) => void;
		onOptionLoadMore?: (setting: SettingDefinition) => void;
		onRetry?: () => void;
		onFileChange?: (
			setting: SettingDefinition,
			file: File,
			metadata?: GeneratedCoverFrame
		) => void | Promise<void>;
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
		optionNextCursors = {},
		optionsLoading = false,
		optionsError = '',
		scopeLabel = '',
		formatValue = '',
		formatOptions = [],
		formatRequired = false,
		onChange,
		onFormatChange,
		onMediaChange,
		onOptionSearch,
		onOptionLoadMore,
		onRetry,
		onFileChange,
		onRemove
	}: Props = $props();

	let searchBySetting = $state<Record<string, string>>({});
	let searchTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	let uploadingSettingKey = $state('');
	let uploadErrorBySetting = $state<Record<string, string>>({});

	const accountName = $derived(
		account
			? formatSocialAccountName(account.account_username, account.platform) ||
					account.slug ||
					getPlatformName(account.platform)
			: ''
	);

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
	const videoMediaItem = $derived(
		mediaItems.find((item) => item.mimeType.startsWith('video/')) ??
			(mediaItems.length === 1 ? mediaItems[0] : undefined)
	);

	function valueAsString(key: string, scopedValues = values): string {
		const value = scopedValues[key];
		return value === undefined || value === null ? '' : String(value);
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

	function dependenciesMet(setting: SettingDefinition, scopedValues: DestinationSettings): boolean {
		return (setting.dependencies ?? []).every((condition) =>
			conditionMatches(condition, scopedValues)
		);
	}

	function conditionMatches(
		condition: SettingCondition,
		scopedValues: DestinationSettings
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
				return Array.isArray(condition.value) && condition.value.some((item) => item === value);
		}
	}

	function controlFor(setting: SettingDefinition): string {
		return setting.control || setting.type;
	}

	function inputType(setting: SettingDefinition): 'number' | 'url' | 'text' {
		if (setting.type === 'number') return 'number';
		if (setting.type === 'url' || setting.control === 'quote_url') return 'url';
		return 'text';
	}

	function acceptsFor(setting: SettingDefinition): string {
		const configured = setting.constraints?.accept ?? [];
		if (configured.length > 0) return configured.join(',');
		if (['thumbnail_media_id', 'cover_media_id'].includes(setting.key)) return 'image/*';
		return '';
	}

	function supportsGeneratedCover(setting: SettingDefinition): boolean {
		return ['thumbnail_media_id', 'cover_media_id'].includes(setting.key);
	}

	async function uploadSelectedFile(setting: SettingDefinition, file: File) {
		if (!onFileChange || uploadingSettingKey) return;
		uploadErrorBySetting = { ...uploadErrorBySetting, [setting.key]: '' };
		uploadingSettingKey = setting.key;
		try {
			await onFileChange(setting, file);
		} catch {
			uploadErrorBySetting = {
				...uploadErrorBySetting,
				[setting.key]: m.compose_destination_file_upload_failed()
			};
		} finally {
			uploadingSettingKey = '';
		}
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
				{account
					? m.compose_account_settings({ platform: getPlatformName(account.platform) })
					: m.compose_platform_settings()}
			</Dialog.Title>
			{#if account}
				<SocialAccountIdentity
					class="mt-2"
					name={accountName}
					platform={account.platform}
					avatarUrl={account.account_avatar_url}
				/>
			{/if}
			<Dialog.Description>
				{account
					? m.compose_account_settings_body({ account: accountName })
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

			{#if formatOptions.length > 1 && onFormatChange}
				<section class="space-y-2" aria-labelledby="destination-format-heading">
					<h3 id="destination-format-heading" class="text-sm font-semibold">
						{m.compose_destination_format()}
						{#if formatRequired}<span class="text-destructive" aria-hidden="true">*</span>{/if}
					</h3>
					<p class="text-xs text-muted-foreground">{m.compose_destination_format_body()}</p>
					<AppSelect
						value={formatRequired ? '' : formatValue}
						options={formatOptions}
						placeholder={m.compose_choose_format()}
						ariaLabel={m.compose_destination_format()}
						class="h-11"
						onValueChange={onFormatChange}
					/>
				</section>
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
								control === 'follow_up' ||
								control === 'cover_frame' ||
								supportsGeneratedCover(setting)
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
										<Checkbox
											class="size-5"
											checked={valueAsBoolean(setting.key)}
											disabled={Boolean(setting.unavailable_reason)}
											onCheckedChange={(checked) => onChange(setting.key, checked)}
										/>
										<span>{settingLabel(setting)}</span>
									</label>
								{:else}
									{#if control === 'cover_frame'}
										<p class="text-sm font-medium">{settingLabel(setting)}</p>
									{:else}
										<label class="text-sm font-medium" for="destination-setting-{setting.key}">
											{settingLabel(setting)}
											{#if setting.required}
												<span class="text-destructive" aria-hidden="true">*</span>
											{/if}
										</label>
									{/if}

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
										<div class="mt-1">
											<DestinationOptionCombobox
												id="destination-setting-{setting.key}"
												value={valueAsString(setting.key) || (setting.required ? '' : '__none__')}
												label={settingLabel(setting)}
												placeholder={m.compose_choose_setting({ setting: settingLabel(setting) })}
												searchPlaceholder={m.compose_search_options()}
												emptyLabel={m.compose_no_provider_options({
													setting: settingLabel(setting)
												})}
												loadingLabel={m.compose_loading_provider_options()}
												disabled={Boolean(setting.unavailable_reason)}
												loading={optionsLoading}
												onValueChange={(value) =>
													onChange(setting.key, value === '__none__' ? '' : value)}
												onSearch={(search) => updateOptionSearch(setting, search)}
												options={[
													...(setting.required
														? []
														: [{ value: '__none__', label: m.common_none() }]),
													...remoteOptions.map((option) => ({
														value: option.value,
														label: option.label
													}))
												]}
												class="w-full"
											/>
											{#if setting.options_source && optionNextCursors[setting.options_source]}
												<Button
													class="mt-2 min-h-11 w-full"
													variant="outline"
													disabled={optionsLoading}
													onclick={() => onOptionLoadMore?.(setting)}
												>
													{m.compose_load_more_provider_options()}
												</Button>
											{/if}
										</div>
									{:else if setting.type === 'select'}
										<AppSelect
											id="destination-setting-{setting.key}"
											value={valueAsString(setting.key) || (setting.required ? '' : '__none__')}
											placeholder={m.compose_choose_setting({ setting: settingLabel(setting) })}
											disabled={Boolean(setting.unavailable_reason)}
											onValueChange={(value) =>
												onChange(setting.key, value === '__none__' ? '' : value)}
											options={[
												...(setting.required
													? []
													: [{ value: '__none__', label: m.common_none() }]),
												...(setting.options ?? []).map((option) => ({
													value: option,
													label: option
												}))
											]}
											class="mt-1 h-11 w-full"
										/>
									{:else if ['tags', 'language', 'chips', 'user_picker', 'media_tags'].includes(control)}
										<TagInput
											id="destination-setting-{setting.key}"
											value={valueAsString(setting.key)}
											onChange={(value) => onChange(setting.key, value)}
										/>
									{:else if control === 'cover_frame' && videoMediaItem}
										<VideoCoverFramePicker
											mediaId={videoMediaItem.id}
											value={values[setting.key]}
											mode="timestamp"
											label={settingLabel(setting)}
											onTimestampChange={(timestampMs) => onChange(setting.key, timestampMs)}
										/>
									{:else if ['media_picker', 'captions_file'].includes(control) && onFileChange}
										<Input
											id="destination-setting-{setting.key}"
											class="mt-1 h-11 file:mr-3"
											type="file"
											accept={acceptsFor(setting)}
											disabled={Boolean(uploadingSettingKey)}
											onchange={(event) => {
												const file = event.currentTarget.files?.[0];
												if (file) void uploadSelectedFile(setting, file);
											}}
										/>
										{#if uploadingSettingKey === setting.key}
											<p class="mt-1 text-xs text-muted-foreground" aria-live="polite">
												{m.compose_destination_file_uploading()}
											</p>
										{:else if uploadErrorBySetting[setting.key]}
											<p class="mt-1 text-xs text-destructive" role="alert">
												{uploadErrorBySetting[setting.key]}
											</p>
										{/if}
										{#if supportsGeneratedCover(setting) && videoMediaItem}
											<VideoCoverFramePicker
												mediaId={videoMediaItem.id}
												value={values[setting.key]}
												mode="image"
												label={settingLabel(setting)}
												onFileChange={(file, metadata) => onFileChange?.(setting, file, metadata)}
											/>
										{/if}
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
														<Checkbox
															class="size-5"
															checked={valueAsBoolean(setting.key, scopedValues)}
															disabled={Boolean(setting.unavailable_reason)}
															onCheckedChange={(checked) =>
																onMediaChange?.(item.id, setting.key, checked)}
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
														<DestinationOptionCombobox
															id="destination-media-{item.id}-{setting.key}"
															value={valueAsString(setting.key, scopedValues) ||
																(setting.required ? '' : '__none__')}
															label={settingLabel(setting)}
															placeholder={m.compose_choose_setting({
																setting: settingLabel(setting)
															})}
															searchPlaceholder={m.compose_search_options()}
															emptyLabel={m.compose_no_provider_options({
																setting: settingLabel(setting)
															})}
															loadingLabel={m.compose_loading_provider_options()}
															disabled={Boolean(setting.unavailable_reason)}
															loading={optionsLoading}
															onValueChange={(value) =>
																onMediaChange?.(
																	item.id,
																	setting.key,
																	value === '__none__' ? '' : value
																)}
															onSearch={(search) => updateOptionSearch(setting, search)}
															options={[
																...(setting.required
																	? []
																	: [{ value: '__none__', label: m.common_none() }]),
																...remoteOptions.map((option) => ({
																	value: option.value,
																	label: option.label
																}))
															]}
															class="mt-1 w-full"
														/>
													{:else if setting.type === 'select'}
														<AppSelect
															id="destination-media-{item.id}-{setting.key}"
															value={valueAsString(setting.key, scopedValues) ||
																(setting.required ? '' : '__none__')}
															placeholder={m.compose_choose_setting({
																setting: settingLabel(setting)
															})}
															disabled={Boolean(setting.unavailable_reason)}
															onValueChange={(value) =>
																onMediaChange?.(
																	item.id,
																	setting.key,
																	value === '__none__' ? '' : value
																)}
															options={[
																...(setting.required
																	? []
																	: [{ value: '__none__', label: m.common_none() }]),
																...(setting.options ?? []).map((option) => ({
																	value: option,
																	label: option
																}))
															]}
															class="mt-1 h-11 w-full"
														/>
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
