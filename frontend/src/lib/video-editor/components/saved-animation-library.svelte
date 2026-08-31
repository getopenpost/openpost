<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type { AnimationPreset } from '$lib/video-editor/project/types';
	import { applySavedAnimation } from '$lib/video-editor/timeline/actions/saved-animation';
	import {
		captureAnimationFromItem,
		getAnimationPresetCompatibility
	} from '$lib/video-editor/timeline/saved-animation';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		itemId,
		itemIds = [],
		presets = [],
		mode,
		query: externalQuery,
		compatibleOnly = false,
		showFilters = true,
		onsavepreset = () => {},
		ondeletepreset = () => {},
		onedit
	}: {
		itemId: string | null;
		itemIds?: string[];
		presets?: AnimationPreset[];
		mode: 'replace' | 'add';
		query?: string;
		compatibleOnly?: boolean;
		showFilters?: boolean;
		onsavepreset?: (preset: AnimationPreset) => void;
		ondeletepreset?: (presetId: string) => void;
		onedit: () => void;
	} = $props();

	let localQuery = $state('');
	let saveOpen = $state(false);
	let presetName = $state('');
	let deletePresetId = $state<string | null>(null);
	let retime = $state(true);
	let status = $state('');

	const selectedIds = $derived(itemId ? [...new Set([itemId, ...itemIds])].filter(Boolean) : []);
	const selectedItems = $derived(
		selectedIds.flatMap((id) => {
			const item = timelineStore.itemById.get(id);
			return item ? [item] : [];
		})
	);
	const sourceItem = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const query = $derived(externalQuery ?? localQuery);
	const canSave = $derived(
		Boolean(
			sourceItem &&
			(Object.values(sourceItem.keyframes ?? {}).some((track) => Boolean(track?.frames.length)) ||
				Object.values(sourceItem.vectorKeyframes ?? {}).some((track) => Boolean(track?.length)) ||
				sourceItem.motionModifiers?.some((modifier) => modifier.enabled && modifier.amplitude > 0))
		)
	);
	const filteredPresets = $derived(
		presets.filter(
			(preset) =>
				preset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
				(!compatibleOnly || compatibilityReason(preset) === null)
		)
	);

	function openSave(): void {
		if (!sourceItem || !canSave) return;
		presetName = m.video_editor_saved_animation_default_name({ name: sourceItem.label });
		saveOpen = true;
		status = '';
	}

	function savePreset(): void {
		if (!sourceItem || !presetName.trim()) return;
		const preset = captureAnimationFromItem(sourceItem, presetName);
		if (!preset) {
			status = m.video_editor_saved_animation_nothing_to_save();
			return;
		}
		onsavepreset(preset);
		saveOpen = false;
		status = m.video_editor_saved_animation_saved({ name: preset.name });
	}

	function applyPreset(preset: AnimationPreset): void {
		const result = applySavedAnimation({
			itemIds: selectedIds,
			preset,
			mode,
			retime,
			anchorAbsoluteFrame: timelineStore.currentFrame
		});
		if (result.ok) {
			status = m.video_editor_saved_animation_applied({
				name: preset.name,
				count: String(result.appliedItems),
				keyframes: String(result.writtenKeyframes)
			});
			onedit();
			return;
		}
		status =
			result.reason === 'transition-blocked'
				? m.video_editor_saved_animation_transition_blocked()
				: result.reason === 'type-mismatch'
					? m.video_editor_saved_animation_type_mismatch()
					: m.video_editor_saved_animation_no_change();
	}

	function removePreset(preset: AnimationPreset): void {
		ondeletepreset(preset.id);
		deletePresetId = null;
		status = m.video_editor_saved_animation_deleted({ name: preset.name });
	}

	function compatibilityReason(preset: AnimationPreset): string | null {
		if (selectedItems.length === 0) return m.video_editor_motion_select_clip();
		const result = selectedItems.map((item) => getAnimationPresetCompatibility(preset, item));
		if (result.some((entry) => entry.reason === 'type-mismatch')) {
			return m.video_editor_saved_animation_type_mismatch();
		}
		if (result.some((entry) => !entry.compatible)) {
			return m.video_editor_saved_animation_missing_property();
		}
		return null;
	}
</script>

<section class="saved-library" aria-labelledby="saved-animation-title">
	<div class="library-heading">
		<div>
			<h3 id="saved-animation-title">{m.video_editor_saved_animation_title()}</h3>
			<p>{m.video_editor_saved_animation_description()}</p>
		</div>
		<button type="button" class="save-button" disabled={!canSave} onclick={openSave}>
			{m.video_editor_saved_animation_save()}
		</button>
	</div>

	{#if saveOpen}
		<div class="save-form">
			<label for="saved-animation-name">{m.video_editor_saved_animation_name()}</label>
			<Input
				id="saved-animation-name"
				bind:value={presetName}
				maxlength={80}
				class="h-7 min-h-0 rounded border border-[oklch(0.31_0.018_55)] bg-[oklch(0.135_0.01_55)] px-2 text-[0.6rem] text-[oklch(0.9_0.012_65)]"
				onkeydown={(event) => event.key === 'Enter' && savePreset()}
			/>
			<div>
				<button type="button" class="quiet" onclick={() => (saveOpen = false)}>
					{m.video_editor_motion_bake_cancel()}
				</button>
				<button type="button" class="accent" disabled={!presetName.trim()} onclick={savePreset}>
					{m.video_editor_saved_animation_save_confirm()}
				</button>
			</div>
		</div>
	{/if}

	{#if presets.length > 0}
		<div class="library-controls">
			{#if showFilters}
				<label>
					<span>{m.video_editor_saved_animation_search()}</span>
					<Input
						type="search"
						bind:value={localQuery}
						placeholder={m.video_editor_saved_animation_search()}
						class="h-7 min-h-0 rounded border border-[oklch(0.31_0.018_55)] bg-[oklch(0.135_0.01_55)] px-2 text-[0.6rem] text-[oklch(0.9_0.012_65)]"
					/>
				</label>
			{/if}
			<label class="retime-toggle">
				<Checkbox bind:checked={retime} aria-label={m.video_editor_saved_animation_fit()} />
				<span>{m.video_editor_saved_animation_fit()}</span>
			</label>
		</div>
		<div class="preset-list">
			{#each filteredPresets as preset (preset.id)}
				{@const reason = compatibilityReason(preset)}
				<article class="saved-card">
					<div>
						<strong>{preset.name}</strong>
						<span
							>{m.video_editor_saved_animation_summary({
								count: String(preset.properties.length + (preset.vectorProperties?.length ?? 0)),
								type: preset.sourceItemType
							})}</span
						>
					</div>
					{#if deletePresetId === preset.id}
						<div class="delete-confirm">
							<span>{m.video_editor_saved_animation_delete_confirm()}</span>
							<button type="button" class="quiet" onclick={() => (deletePresetId = null)}>
								{m.video_editor_motion_bake_cancel()}
							</button>
							<button type="button" class="danger" onclick={() => removePreset(preset)}>
								{m.video_editor_saved_animation_delete()}
							</button>
						</div>
					{:else}
						<div class="card-actions">
							<button
								type="button"
								class="quiet delete"
								aria-label={m.video_editor_saved_animation_delete_named({ name: preset.name })}
								onclick={() => (deletePresetId = preset.id)}
							>
								{m.video_editor_saved_animation_delete()}
							</button>
							<button
								type="button"
								class="accent"
								disabled={reason !== null}
								title={reason ?? m.video_editor_saved_animation_apply_hint()}
								onclick={() => applyPreset(preset)}
							>
								{mode === 'replace'
									? m.video_editor_saved_animation_replace()
									: m.video_editor_saved_animation_add()}
							</button>
						</div>
					{/if}
				</article>
			{/each}
		</div>
		{#if filteredPresets.length === 0}
			<p class="empty">{m.video_editor_saved_animation_no_results()}</p>
		{/if}
	{:else}
		<p class="empty">{m.video_editor_saved_animation_empty()}</p>
	{/if}
	<p class="status" aria-live="polite">{status}</p>
</section>

<style>
	.saved-library {
		margin-top: 0.8rem;
		border-top: 1px solid oklch(0.25 0.015 55);
		padding-top: 0.75rem;
	}
	.library-heading,
	.saved-card,
	.card-actions,
	.delete-confirm,
	.save-form > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.45rem;
	}
	h3,
	p {
		margin: 0;
	}
	h3 {
		font-size: 0.65rem;
		color: oklch(0.86 0.02 65);
	}
	.library-heading p,
	.empty,
	.status {
		margin-top: 0.15rem;
		font-size: 0.5625rem;
		line-height: 1.4;
		color: oklch(0.64 0.018 65);
	}
	button {
		font: inherit;
	}
	button {
		min-height: 1.75rem;
		border-radius: 0.32rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.5625rem;
		font-weight: 700;
		cursor: pointer;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	button:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.save-button,
	.accent {
		border: 1px solid oklch(0.52 0.105 45);
		background: oklch(0.55 0.125 45);
		color: oklch(0.98 0.008 70);
	}
	.quiet {
		border: 1px solid oklch(0.31 0.02 58);
		background: oklch(0.2 0.013 55);
		color: oklch(0.7 0.018 65);
	}
	.danger {
		border: 1px solid oklch(0.48 0.11 28);
		background: oklch(0.4 0.1 28);
		color: oklch(0.95 0.02 40);
	}
	.save-form,
	.library-controls,
	.saved-card {
		margin-top: 0.55rem;
		border: 1px solid oklch(0.28 0.018 55);
		border-radius: 0.4rem;
		padding: 0.5rem;
		background: oklch(0.17 0.011 55 / 0.76);
	}
	.save-form,
	.library-controls {
		display: grid;
		gap: 0.45rem;
	}
	.save-form label,
	.library-controls label {
		display: grid;
		gap: 0.2rem;
		font-size: 0.5625rem;
		color: oklch(0.68 0.018 65);
	}
	.library-controls .retime-toggle {
		display: flex;
		min-height: 1.5rem;
		align-items: center;
		gap: 0.35rem;
	}
	.preset-list {
		display: grid;
		gap: 0.35rem;
	}
	.saved-card > div:first-child {
		display: grid;
		min-width: 0;
		gap: 0.08rem;
	}
	.saved-card strong {
		overflow: hidden;
		font-size: 0.6rem;
		color: oklch(0.84 0.018 65);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.saved-card span {
		font-size: 0.5rem;
		color: oklch(0.58 0.016 65);
	}
	.card-actions {
		flex: none;
	}
	.delete-confirm {
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.delete-confirm span {
		width: 100%;
		text-align: right;
	}
	.status {
		min-height: 0.8rem;
		color: oklch(0.73 0.05 58);
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
	}
</style>
