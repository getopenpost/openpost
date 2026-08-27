<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type {
		CompositionControlDefinition,
		CompositionControlProperty
	} from '$lib/video-editor/project/types';
	import {
		addCompositionControl,
		removeCompositionControl,
		renameCompositionControl
	} from '$lib/video-editor/sequences/composition-control-actions';
	import {
		getCompositionControlCandidates,
		type CompositionControlCandidate
	} from '$lib/video-editor/sequences/composition-controls';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let { onedit }: { onedit: () => void } = $props();
	const composition = $derived(sequenceStore.activeSequence);
	const controls = $derived(composition?.compositionControls?.controls ?? []);
	const existingTargets = $derived(
		new Set(controls.map((control) => `${control.targetItemId}:${control.property}`))
	);
	const candidates = $derived(
		getCompositionControlCandidates(timelineStore.items).filter(
			(candidate) => !existingTargets.has(`${candidate.targetItemId}:${candidate.property}`)
		)
	);
	let selectedCandidate = $state('');

	function candidateKey(candidate: CompositionControlCandidate): string {
		return JSON.stringify([candidate.targetItemId, candidate.property]);
	}

	function propertyLabel(property: CompositionControlProperty): string {
		switch (property) {
			case 'text.text':
				return m.video_editor_motion_published_text();
			case 'text.color':
				return m.video_editor_motion_published_text_color();
			case 'shape.fillColor':
				return m.video_editor_motion_published_fill_color();
			case 'shape.strokeColor':
				return m.video_editor_motion_published_stroke_color();
		}
	}

	function defaultName(candidate: CompositionControlCandidate): string {
		return candidate.property === 'text.text'
			? candidate.targetLabel
			: `${candidate.targetLabel} ${propertyLabel(candidate.property).toLocaleLowerCase()}`;
	}

	function exposeSelected(): void {
		if (!composition || !selectedCandidate) return;
		const candidate = candidates.find((entry) => candidateKey(entry) === selectedCandidate);
		if (!candidate) return;
		const id = addCompositionControl(composition.id, {
			...candidate,
			name: defaultName(candidate)
		});
		if (!id) return;
		selectedCandidate = '';
		onedit();
	}

	function rename(control: CompositionControlDefinition, input: HTMLInputElement): void {
		if (composition && renameCompositionControl(composition.id, control.id, input.value)) {
			onedit();
			return;
		}
		input.value = control.name;
	}

	function remove(control: CompositionControlDefinition): void {
		if (composition && removeCompositionControl(composition.id, control.id)) onedit();
	}
</script>

{#if composition?.editorKind === 'composite-2d'}
	<section class="rounded-md border border-[oklch(0.28_0.015_55)] bg-[oklch(0.16_0.01_55)] p-3">
		<h3 class="text-sm font-medium">
			{m.video_editor_motion_published_title({ count: controls.length })}
		</h3>
		<p class="mt-1 text-xs leading-5 text-[oklch(0.65_0.015_55)]">
			{m.video_editor_motion_published_hint()}
		</p>
		{#if controls.length > 0}
			<div class="mt-3 space-y-2">
				{#each controls as control (control.id)}
					<div class="flex items-center gap-2 rounded border border-white/10 p-2">
						<div class="min-w-0 flex-1">
							<Input
								class="h-8 w-full text-xs"
								value={control.name}
								maxlength={120}
								aria-label={m.video_editor_motion_published_rename({ name: control.name })}
								onchange={(event) => rename(control, event.currentTarget)}
							/>
							<p class="mt-1 truncate text-[10px] text-[oklch(0.6_0.01_55)]">
								{timelineStore.itemById.get(control.targetItemId)?.label ?? control.targetItemId} -
								{propertyLabel(control.property)}
							</p>
						</div>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							class="shrink-0 px-2 text-xs text-red-300"
							aria-label={m.video_editor_motion_published_remove({ name: control.name })}
							onclick={() => remove(control)}
						>
							×
						</Button>
					</div>
				{/each}
			</div>
		{/if}
		{#if candidates.length > 0}
			<label class="mt-3 block text-xs font-medium" for="published-control-candidate">
				{m.video_editor_motion_published_property()}
			</label>
			<AppSelect
				bind:value={selectedCandidate}
				options={[{ value: '', label: m.video_editor_motion_published_property() }, ...candidates.map((candidate) => ({ value: candidateKey(candidate), label: `${candidate.targetLabel} - ${propertyLabel(candidate.property)}` })) ]}
				ariaLabel={m.video_editor_motion_published_property()}
				class="mt-1 h-9 w-full text-sm"
			/>
			<Button
				type="button"
				class="mt-2 w-full"
				size="sm"
				variant="secondary"
				disabled={!selectedCandidate}
				onclick={exposeSelected}
			>
				{m.video_editor_motion_published_add()}
			</Button>
		{:else}
			<p class="mt-3 text-[10px] leading-4 text-[oklch(0.62_0.01_55)]">
				{controls.length > 0
					? m.video_editor_motion_published_all()
					: m.video_editor_motion_published_none()}
			</p>
		{/if}
	</section>
{/if}
