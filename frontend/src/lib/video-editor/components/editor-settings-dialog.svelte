<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { getCurrentLocale, localeLabels, switchLocale } from '$lib/i18n';
	import { locales, type Locale } from '$lib/paraglide/runtime';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		INTERFACE_SOUND_THEMES,
		soundPreferences,
		type InterfaceSoundTheme
	} from '$lib/stores/sound-preferences.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
	import KeyboardIcon from '@lucide/svelte/icons/keyboard';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RotateIcon from '@lucide/svelte/icons/rotate-ccw';
	import RowsIcon from '@lucide/svelte/icons/rows-3';
	import SettingsIcon from '@lucide/svelte/icons/settings-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import {
		AUTO_SAVE_INTERVAL_MINUTES,
		editorSettings
	} from '$lib/video-editor/settings/editor-settings.svelte';
	import {
		clearProjectDerivedCaches,
		deleteProjectProxies,
		generateRecommendedProxies,
		projectProxyCount,
		recommendedProxyMedia,
		regenerateProjectThumbnails,
		type MaintenanceBatchResult,
		type MaintenanceProgress
	} from '$lib/video-editor/settings/storage-maintenance';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		TRANSCRIPTION_LANGUAGE_OPTIONS,
		TRANSCRIPTION_MODEL_OPTIONS,
		TRANSCRIPTION_QUANTIZATION_OPTIONS
	} from '$lib/video-editor/transcript/engine/models';
	import type {
		TranscriptionModel,
		TranscriptionQuantization
	} from '$lib/video-editor/transcript/engine/types';
	import {
		transcriptionLanguageUiLabel,
		transcriptionModelUiLabel,
		transcriptionQuantizationUiLabel
	} from '$lib/video-editor/transcript/engine/model-i18n';
	import LocalModelCacheControl from './local-model-cache-control.svelte';
	import KeyboardShortcutEditor from './keyboard-shortcut-editor.svelte';
	import { previewEditorSound } from '$lib/video-editor/sounds/editor-sounds';

	type Section = 'general' | 'timeline' | 'shortcuts' | 'ai' | 'storage';
	type StorageAction = 'cache' | 'thumbnails' | 'generate-proxies' | 'delete-proxies';

	let { open = $bindable(false) }: { open?: boolean } = $props();
	let section = $state<Section>('general');
	let working = $state<StorageAction | null>(null);
	let progress = $state<MaintenanceProgress | null>(null);
	let feedback = $state<{ tone: 'success' | 'error'; text: string } | null>(null);
	let confirmCacheClear = $state(false);
	const currentLocale = getCurrentLocale();

	const media = $derived(mediaPool.mediaList);
	const missingProxyCount = $derived(recommendedProxyMedia(media).length);
	const proxyCount = $derived(projectProxyCount(media));
	const sections: Array<{ id: Section; label: () => string; icon: typeof SettingsIcon }> = [
		{ id: 'general', label: m.video_editor_settings_general, icon: SettingsIcon },
		{ id: 'timeline', label: m.video_editor_settings_timeline, icon: RowsIcon },
		{ id: 'shortcuts', label: m.video_editor_settings_shortcuts, icon: KeyboardIcon },
		{ id: 'ai', label: m.video_editor_settings_ai, icon: SparklesIcon },
		{ id: 'storage', label: m.video_editor_settings_storage, icon: HardDriveIcon }
	];

	function setBoolean(
		key: 'snapByDefault' | 'showWaveforms' | 'showFilmstrips' | 'extractFilmstrips',
		value: boolean
	): void {
		editorSettings.set(key, value);
		if (key === 'snapByDefault') timelineStore._setSnapEnabled(value);
	}

	function setUndoDepth(value: number): void {
		editorSettings.set('maxUndoHistory', value);
		timelineStore._setMaxUndoHistory(editorSettings.maxUndoHistory);
	}

	function setPeriodicAutosave(enabled: boolean): void {
		editorSettings.set('autoSaveIntervalMinutes', enabled ? 5 : 0);
		editorSession.configurePeriodicAutosave();
	}

	function setPeriodicAutosaveInterval(value: number): void {
		editorSettings.set('autoSaveIntervalMinutes', value);
		editorSession.configurePeriodicAutosave();
	}

	function resetSettings(): void {
		editorSettings.reset();
		soundPreferences.reset();
		editorSession.configurePeriodicAutosave();
		timelineStore._setSnapEnabled(editorSettings.snapByDefault);
		timelineStore._setMaxUndoHistory(editorSettings.maxUndoHistory);
		feedback = { tone: 'success', text: m.video_editor_settings_reset_done() };
	}

	function soundThemeLabel(theme: InterfaceSoundTheme): string {
		if (theme === 'velvet') return m.video_editor_settings_sound_theme_velvet();
		if (theme === 'crisp') return m.video_editor_settings_sound_theme_crisp();
		return m.video_editor_settings_sound_theme_signature();
	}

	function setSoundTheme(theme: InterfaceSoundTheme): void {
		soundPreferences.setTheme(theme);
		previewEditorSound(theme);
	}

	function progressLabel(value: MaintenanceProgress): string {
		return `${value.done}/${value.total}`;
	}

	function resultFeedback(result: MaintenanceBatchResult): void {
		if (result.total === 0) {
			feedback = { tone: 'success', text: m.video_editor_settings_nothing_to_do() };
			return;
		}
		if (result.failedMediaIds.length === 0) {
			feedback = {
				tone: 'success',
				text: m.video_editor_settings_items_done({ count: result.succeeded })
			};
			return;
		}
		feedback = {
			tone: 'error',
			text: m.video_editor_settings_items_partial({
				done: result.succeeded,
				total: result.total
			})
		};
	}

	async function runStorageAction(
		id: StorageAction,
		action: (onProgress: (value: MaintenanceProgress) => void) => Promise<MaintenanceBatchResult>
	): Promise<void> {
		if (working) return;
		working = id;
		progress = null;
		feedback = null;
		try {
			resultFeedback(await action((value) => (progress = value)));
		} catch (error) {
			feedback = {
				tone: 'error',
				text: error instanceof Error ? error.message : String(error)
			};
		} finally {
			working = null;
			progress = null;
		}
	}

	function actionText(id: StorageAction, idle: string): string {
		return working === id && progress ? progressLabel(progress) : idle;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme flex max-h-[min(90vh,820px)] w-[calc(100%-1rem)] max-w-[920px] flex-col overflow-hidden border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] p-0 text-[var(--video-editor-text)] shadow-2xl sm:max-w-[920px]"
	>
		<Dialog.Header
			class="flex-row items-center justify-between border-b border-[oklch(0.27_0.014_55)] px-5 py-4 pr-12"
		>
			<div>
				<Dialog.Title class="text-base">{m.video_editor_settings_title()}</Dialog.Title>
				<Dialog.Description class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
					{m.video_editor_settings_description()}
				</Dialog.Description>
			</div>
			{#if section !== 'shortcuts'}
				<Button type="button" variant="ghost" size="sm" onclick={resetSettings}>
					<RotateIcon class="size-3.5" aria-hidden="true" />
					{m.video_editor_settings_reset()}
				</Button>
			{/if}
		</Dialog.Header>

		<div class="flex min-h-0 flex-1 flex-col sm:flex-row">
			<nav
				class="flex shrink-0 gap-1 overflow-x-auto border-b border-[oklch(0.27_0.014_55)] p-2 sm:w-40 sm:flex-col sm:border-r sm:border-b-0"
				aria-label={m.video_editor_settings_sections()}
			>
				{#each sections as item (item.id)}
					{@const Icon = item.icon}
					<button
						type="button"
						class="flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-left text-xs text-[var(--video-editor-muted)] hover:bg-[oklch(0.21_0.012_50)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] data-[active=true]:bg-[oklch(0.26_0.025_50)] data-[active=true]:text-[var(--video-editor-focus)]"
						data-active={section === item.id}
						aria-current={section === item.id ? 'page' : undefined}
						data-cuelume-toggle="tick"
						onclick={() => (section = item.id)}
					>
						<Icon class="size-3.5" aria-hidden="true" />
						{item.label()}
					</button>
				{/each}
			</nav>

			<div class="min-h-0 flex-1 overflow-y-auto p-5">
				{#if section === 'general'}
					<section class="space-y-4" aria-labelledby="settings-general-title">
						<div>
							<h3 id="settings-general-title" class="text-sm font-medium">
								{m.video_editor_settings_general()}
							</h3>
							<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
								{m.video_editor_settings_autosave_description()}
							</p>
						</div>
						<div class="rounded-lg border border-[oklch(0.29_0.014_55)] p-4">
							<div class="flex flex-wrap items-center justify-between gap-4">
								<div class="min-w-0 flex-1">
									<label for="editor-language" class="text-sm font-medium">
										{m.language_label()}
									</label>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_language_description()}
									</p>
								</div>
								<select
									id="editor-language"
									class="h-10 min-w-48 rounded-md border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_55)] px-3 text-xs text-white focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] max-[640px]:h-11 max-[640px]:w-full"
									value={currentLocale}
									onchange={(event) => switchLocale(event.currentTarget.value as Locale)}
								>
									{#each locales as locale (locale)}
										<option value={locale}>{localeLabels[locale]}</option>
									{/each}
								</select>
							</div>
						</div>
						<div class="rounded-lg border border-[oklch(0.29_0.014_55)] p-4">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-sm font-medium">
										{m.video_editor_settings_periodic_autosave()}
									</p>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_periodic_autosave_description()}
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={editorSettings.autoSaveIntervalMinutes > 0}
									aria-label={m.video_editor_settings_periodic_autosave()}
									class="relative h-5 w-9 shrink-0 rounded-full bg-[oklch(0.28_0.012_55)] transition-colors data-[checked=true]:bg-[var(--video-editor-focus)]"
									data-checked={editorSettings.autoSaveIntervalMinutes > 0}
									data-cuelume-toggle="toggle"
									onclick={() => setPeriodicAutosave(editorSettings.autoSaveIntervalMinutes === 0)}
								>
									<span
										class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform data-[checked=true]:translate-x-4"
										data-checked={editorSettings.autoSaveIntervalMinutes > 0}
									></span>
								</button>
							</div>
							{#if editorSettings.autoSaveIntervalMinutes > 0}
								<div class="mt-4 border-t border-[oklch(0.27_0.014_55)] pt-4">
									<div class="flex items-center justify-between gap-3 text-xs">
										<span>
											{m.video_editor_settings_autosave_interval()}
										</span>
										<span class="text-[var(--video-editor-muted)] tabular-nums">
											{m.video_editor_settings_autosave_interval_minutes({
												count: editorSettings.autoSaveIntervalMinutes
											})}
										</span>
									</div>
									<Slider
										class="mt-3"
										min={AUTO_SAVE_INTERVAL_MINUTES[0]}
										max={AUTO_SAVE_INTERVAL_MINUTES.at(-1)}
										step={5}
										value={editorSettings.autoSaveIntervalMinutes}
										ariaLabel={m.video_editor_settings_autosave_interval()}
										onValueChange={setPeriodicAutosaveInterval}
									/>
								</div>
							{/if}
						</div>
						<div class="rounded-lg border border-[oklch(0.29_0.014_55)] p-4">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-sm font-medium">
										{m.video_editor_settings_interface_sounds()}
									</p>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_interface_sounds_description()}
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={soundPreferences.enabled}
									aria-label={m.video_editor_settings_interface_sounds()}
									class="relative h-6 w-11 shrink-0 rounded-full bg-[oklch(0.3_0.014_55)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] data-[checked=true]:bg-[var(--video-editor-focus)]"
									data-checked={soundPreferences.enabled}
									onclick={() => soundPreferences.setEnabled(!soundPreferences.enabled)}
								>
									<span
										class="absolute top-1 left-1 size-4 rounded-full bg-white transition-transform data-[checked=true]:translate-x-5"
										data-checked={soundPreferences.enabled}
									></span>
								</button>
							</div>
							{#if soundPreferences.enabled}
								<div class="mt-4 space-y-4 border-t border-[oklch(0.27_0.014_55)] pt-4">
									<div>
										<div class="flex items-center justify-between gap-3 text-xs">
											<span>{m.video_editor_settings_sound_volume()}</span>
											<span class="text-[var(--video-editor-muted)] tabular-nums">
												{Math.round(soundPreferences.volume * 100)}%
											</span>
										</div>
										<Slider
											class="mt-3"
											min={0}
											max={1}
											step={0.05}
											value={soundPreferences.volume}
											ariaLabel={m.video_editor_settings_sound_volume()}
											onValueChange={(value) => soundPreferences.setVolume(value)}
											onValueCommit={() => previewEditorSound(soundPreferences.theme)}
										/>
									</div>
									<div class="flex flex-wrap items-end justify-between gap-3">
										<label class="min-w-40 flex-1 text-xs text-[var(--video-editor-muted)]">
											{m.video_editor_settings_sound_theme()}
											<select
												class="mt-1 h-9 w-full rounded-md border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_55)] px-2 text-xs text-white focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
												value={soundPreferences.theme}
												onchange={(event) =>
													setSoundTheme(event.currentTarget.value as InterfaceSoundTheme)}
											>
												{#each INTERFACE_SOUND_THEMES as theme (theme)}
													<option value={theme}>{soundThemeLabel(theme)}</option>
												{/each}
											</select>
										</label>
										<Button
											type="button"
											variant="outline"
											size="sm"
											data-cuelume-toggle={undefined}
											onclick={() => previewEditorSound(soundPreferences.theme)}
										>
											{m.video_editor_settings_sound_preview()}
										</Button>
									</div>
								</div>
							{/if}
						</div>
						<div class="rounded-lg border border-[oklch(0.29_0.014_55)] p-4">
							<div class="flex items-center justify-between gap-4">
								<div>
									<label for="undo-depth" class="text-sm font-medium">
										{m.video_editor_settings_undo_depth()}
									</label>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_undo_depth_description()}
									</p>
								</div>
								<Input
									id="undo-depth"
									type="number"
									min="10"
									max="200"
									step="10"
									class="h-8 w-20 shrink-0 text-right text-xs"
									value={editorSettings.maxUndoHistory}
									onchange={(event) => setUndoDepth(event.currentTarget.valueAsNumber)}
								/>
							</div>
						</div>
					</section>
				{:else if section === 'timeline'}
					<section class="space-y-3" aria-labelledby="settings-timeline-title">
						<h3 id="settings-timeline-title" class="text-sm font-medium">
							{m.video_editor_settings_timeline()}
						</h3>
						{#each [{ key: 'snapByDefault' as const, label: m.video_editor_settings_snap_default(), description: m.video_editor_settings_snap_default_description(), value: editorSettings.snapByDefault }, { key: 'showWaveforms' as const, label: m.video_editor_settings_show_waveforms(), description: m.video_editor_settings_show_waveforms_description(), value: editorSettings.showWaveforms }, { key: 'showFilmstrips' as const, label: m.video_editor_settings_show_filmstrips(), description: m.video_editor_settings_show_filmstrips_description(), value: editorSettings.showFilmstrips }, { key: 'extractFilmstrips' as const, label: m.video_editor_settings_extract_filmstrips(), description: m.video_editor_settings_extract_filmstrips_description(), value: editorSettings.extractFilmstrips }] as setting (setting.key)}
							<div
								class="flex items-center justify-between gap-4 rounded-lg border border-[oklch(0.29_0.014_55)] px-4 py-3"
							>
								<div>
									<p class="text-sm font-medium">{setting.label}</p>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{setting.description}
									</p>
								</div>
								<button
									type="button"
									role="switch"
									aria-checked={setting.value}
									aria-label={setting.label}
									class="relative h-6 w-11 shrink-0 rounded-full bg-[oklch(0.3_0.014_55)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] data-[checked=true]:bg-[var(--video-editor-focus)]"
									data-checked={setting.value}
									data-cuelume-toggle="toggle"
									onclick={() => setBoolean(setting.key, !setting.value)}
								>
									<span
										class="absolute top-1 left-1 size-4 rounded-full bg-white shadow transition-transform data-[checked=true]:translate-x-5"
										data-checked={setting.value}
									></span>
								</button>
							</div>
						{/each}
					</section>
				{:else if section === 'shortcuts'}
					<KeyboardShortcutEditor />
				{:else if section === 'ai'}
					<section class="space-y-4" aria-labelledby="settings-ai-title">
						<div>
							<h3 id="settings-ai-title" class="text-sm font-medium">
								{m.video_editor_settings_ai()}
							</h3>
							<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
								{m.video_editor_settings_ai_description()}
							</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="text-xs text-[var(--video-editor-muted)] sm:col-span-2">
								{m.video_editor_transcribe_model()}
								<select
									class="mt-1 h-9 w-full rounded-md border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_55)] px-2 text-xs text-white focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
									value={editorSettings.defaultTranscriptionModel}
									onchange={(event) =>
										editorSettings.set(
											'defaultTranscriptionModel',
											event.currentTarget.value as TranscriptionModel
										)}
								>
									{#each TRANSCRIPTION_MODEL_OPTIONS as option}
										<option value={option.value}>{transcriptionModelUiLabel(option.value)}</option>
									{/each}
								</select>
							</label>
							<label class="text-xs text-[var(--video-editor-muted)]">
								{m.video_editor_transcribe_language()}
								<select
									class="mt-1 h-9 w-full rounded-md border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_55)] px-2 text-xs text-white focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
									value={editorSettings.defaultTranscriptionLanguage}
									onchange={(event) =>
										editorSettings.set('defaultTranscriptionLanguage', event.currentTarget.value)}
								>
									{#each TRANSCRIPTION_LANGUAGE_OPTIONS as option}
										<option value={option.value}
											>{transcriptionLanguageUiLabel(option.value)}</option
										>
									{/each}
								</select>
							</label>
							<label class="text-xs text-[var(--video-editor-muted)]">
								{m.video_editor_transcribe_quality()}
								<select
									class="mt-1 h-9 w-full rounded-md border border-[oklch(0.3_0.015_55)] bg-[oklch(0.2_0.01_55)] px-2 text-xs text-white focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
									value={editorSettings.defaultTranscriptionQuantization}
									disabled={editorSettings.defaultTranscriptionModel === 'parakeet-tdt-v3'}
									onchange={(event) =>
										editorSettings.set(
											'defaultTranscriptionQuantization',
											event.currentTarget.value as TranscriptionQuantization
										)}
								>
									{#each TRANSCRIPTION_QUANTIZATION_OPTIONS as option}
										<option value={option.value}
											>{transcriptionQuantizationUiLabel(option.value)}</option
										>
									{/each}
								</select>
							</label>
						</div>
					</section>
				{:else}
					<section class="space-y-3" aria-labelledby="settings-storage-title">
						<div>
							<h3 id="settings-storage-title" class="text-sm font-medium">
								{m.video_editor_settings_storage()}
							</h3>
							<p class="mt-1 text-xs text-[var(--video-editor-muted)]">
								{m.video_editor_settings_storage_description()}
							</p>
						</div>

						{#if feedback}
							<p
								class={`rounded-md border px-3 py-2 text-xs ${
									feedback.tone === 'error'
										? 'border-red-500/30 bg-red-500/10 text-red-200'
										: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
								}`}
								role="status"
							>
								{feedback.text}
							</p>
						{/if}

						<div
							class="divide-y divide-[oklch(0.27_0.014_55)] rounded-lg border border-[oklch(0.29_0.014_55)]"
						>
							<div class="flex items-center justify-between gap-4 p-4">
								<div>
									<p class="text-sm font-medium">{m.video_editor_settings_generate_proxies()}</p>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_generate_proxies_description({
											count: missingProxyCount
										})}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={working !== null || missingProxyCount === 0}
									onclick={() =>
										void runStorageAction('generate-proxies', (onProgress) =>
											generateRecommendedProxies(media, onProgress)
										)}
								>
									{#if working === 'generate-proxies'}<LoaderIcon
											class="size-3.5 animate-spin motion-reduce:animate-none"
										/>{/if}
									{actionText('generate-proxies', m.video_editor_settings_generate())}
								</Button>
							</div>

							<div class="p-4">
								<div class="flex items-center justify-between gap-4">
									<div>
										<p class="text-sm font-medium">{m.video_editor_settings_clear_cache()}</p>
										<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
											{m.video_editor_settings_clear_cache_description({ count: media.length })}
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={working !== null || media.length === 0}
										onclick={() => (confirmCacheClear = true)}
									>
										{#if working === 'cache'}<LoaderIcon
												class="size-3.5 animate-spin motion-reduce:animate-none"
											/>{/if}
										{actionText('cache', m.video_editor_settings_clear())}
									</Button>
								</div>
								{#if confirmCacheClear}
									<div class="mt-3 rounded-md border border-amber-500/25 bg-amber-500/8 p-3">
										<p class="text-xs text-amber-100">
											{m.video_editor_settings_clear_cache_confirm()}
										</p>
										<div class="mt-2 flex justify-end gap-2">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onclick={() => (confirmCacheClear = false)}
											>
												{m.common_cancel()}
											</Button>
											<Button
												type="button"
												size="sm"
												onclick={() => {
													confirmCacheClear = false;
													void runStorageAction('cache', (onProgress) =>
														clearProjectDerivedCaches(media, onProgress)
													);
												}}
											>
												{m.video_editor_settings_clear_derived_data()}
											</Button>
										</div>
									</div>
								{/if}
							</div>

							<div class="flex items-center justify-between gap-4 p-4">
								<div>
									<p class="text-sm font-medium">
										{m.video_editor_settings_regenerate_thumbnails()}
									</p>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_regenerate_thumbnails_description()}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={working !== null || media.length === 0}
									onclick={() =>
										void runStorageAction('thumbnails', (onProgress) =>
											regenerateProjectThumbnails(media, onProgress)
										)}
								>
									{#if working === 'thumbnails'}<LoaderIcon
											class="size-3.5 animate-spin motion-reduce:animate-none"
										/>{/if}
									{actionText('thumbnails', m.video_editor_settings_regenerate())}
								</Button>
							</div>

							<div class="flex items-center justify-between gap-4 p-4">
								<div>
									<p class="text-sm font-medium">{m.video_editor_settings_delete_proxies()}</p>
									<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_delete_proxies_description({ count: proxyCount })}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={working !== null || proxyCount === 0}
									onclick={() =>
										void runStorageAction('delete-proxies', (onProgress) =>
											deleteProjectProxies(media, onProgress)
										)}
								>
									{#if working === 'delete-proxies'}<LoaderIcon
											class="size-3.5 animate-spin motion-reduce:animate-none"
										/>{/if}
									{actionText('delete-proxies', m.common_delete())}
								</Button>
							</div>
						</div>

						<div class="rounded-lg border border-[oklch(0.29_0.014_55)] p-4">
							<div class="mb-2 flex items-center gap-2">
								<SparklesIcon class="size-3.5 text-[var(--video-editor-focus)]" />
								<div>
									<p class="text-sm font-medium">{m.video_editor_settings_local_models()}</p>
									<p class="text-xs text-[var(--video-editor-muted)]">
										{m.video_editor_settings_local_models_description()}
									</p>
								</div>
							</div>
							<LocalModelCacheControl />
						</div>
					</section>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="border-t border-[oklch(0.27_0.014_55)] px-5 py-3">
			{#if working}<span
					class="mr-auto flex items-center gap-2 text-xs text-[var(--video-editor-muted)]"
					><LoaderIcon
						class="size-3.5 animate-spin motion-reduce:animate-none"
					/>{m.video_editor_settings_working()}</span
				>{/if}
			<Button type="button" onclick={() => (open = false)}>
				{#if feedback?.tone === 'success'}<CheckIcon class="size-3.5" />{/if}
				{m.common_done()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
