<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type { CompositionControlDefinition, TimelineItem } from '$lib/video-editor/project/types';
	import { getCompositionControlSourceValue } from '$lib/video-editor/sequences/composition-controls';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const activeItem = $derived(timelineStore.itemById.get(item.id) ?? item);
	const composition = $derived(
		activeItem.compositionId
			? sequenceStore.compositionById.get(activeItem.compositionId)
			: undefined
	);
	const controls = $derived(composition?.compositionControls?.controls ?? []);

	function sourceValue(control: CompositionControlDefinition): string {
		return getCompositionControlSourceValue(composition?.items ?? [], control);
	}

	function value(control: CompositionControlDefinition): string {
		return activeItem.compositionControlOverrides?.[control.id] ?? sourceValue(control);
	}

	function isOverridden(control: CompositionControlDefinition): boolean {
		return Object.hasOwn(activeItem.compositionControlOverrides ?? {}, control.id);
	}

	function setValue(control: CompositionControlDefinition, nextValue: string): void {
		const overrides = { ...(activeItem.compositionControlOverrides ?? {}) };
		if (nextValue === sourceValue(control)) delete overrides[control.id];
		else overrides[control.id] = nextValue;
		updateItemProperties(
			activeItem.id,
			{
				compositionControlOverrides: Object.keys(overrides).length > 0 ? overrides : undefined
			},
			'UPDATE_COMPOSITION_CONTROL_OVERRIDE'
		);
		onedit();
	}

	function resetAll(): void {
		if (!activeItem.compositionControlOverrides) return;
		updateItemProperties(
			activeItem.id,
			{ compositionControlOverrides: undefined },
			'RESET_COMPOSITION_CONTROL_OVERRIDES'
		);
		onedit();
	}
</script>

{#if activeItem.type === 'composition' && controls.length > 0}
	<section
		class="rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-2.5"
	>
		<h3 class="text-[10px] font-semibold tracking-wider text-[var(--video-editor-muted)] uppercase">
			{m.video_editor_motion_overrides_title()}
		</h3>
		<p class="mt-1 text-[10px] leading-4 text-[var(--video-editor-muted)]">
			{m.video_editor_motion_overrides_hint()}
		</p>
		<div class="mt-2 space-y-2">
			{#each controls as control (control.id)}
				<label class="block text-[10px] text-[var(--video-editor-muted)]">
					<span class="flex items-center gap-1.5">
						<span
							class="size-1.5 rounded-full {isOverridden(control)
								? 'bg-[var(--video-editor-primary)]'
								: ''}"
							aria-hidden="true"
						></span>
						{control.name}
					</span>
					<span class="mt-1 flex items-center gap-1">
						{#if control.kind === 'text'}
							<Input
								class="h-8 min-w-0 flex-1 text-xs"
								value={value(control)}
								onchange={(event) => setValue(control, event.currentTarget.value)}
							/>
						{:else}
							<Input
								class="h-8 min-w-0 flex-1 bg-transparent"
								type="color"
								value={value(control)}
								onchange={(event) => setValue(control, event.currentTarget.value)}
							/>
						{/if}
						{#if isOverridden(control)}
							<Button
								type="button"
								size="sm"
								variant="ghost"
								class="h-8 shrink-0 px-2 text-[10px]"
								aria-label={m.video_editor_motion_override_reset({ name: control.name })}
								onclick={() => setValue(control, sourceValue(control))}
							>
								↺
							</Button>
						{/if}
					</span>
				</label>
			{/each}
		</div>
		{#if activeItem.compositionControlOverrides}
			<Button
				type="button"
				class="mt-2 w-full justify-start text-xs"
				size="sm"
				variant="ghost"
				onclick={resetAll}
			>
				{m.video_editor_motion_overrides_reset_all()}
			</Button>
		{/if}
	</section>
{/if}
