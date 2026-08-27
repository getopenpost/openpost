<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { resolveMediaBlob } from '$lib/video-editor/media/import.svelte';
	import {
		extractLottieAnimation,
		extractLottieManifest,
		parseLottieMetadata,
		type LottieAnimationEntry
	} from '$lib/video-editor/lottie/metadata';
	import { extractLottieTextLayers, type LottieTextLayer } from '$lib/video-editor/lottie/text';
	import { extractLottieColorLayers, type LottieColorLayer } from '$lib/video-editor/lottie/color';
	import {
		extractLottieValueSlots,
		type LottieValueSlot,
		type LottieSlotValue
	} from '$lib/video-editor/lottie/slots';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const maxFrame = $derived(Math.max(0, (item.lottieTotalFrames ?? 1) - 1));
	let textLayers = $state<LottieTextLayer[]>([]);
	let colorLayers = $state<LottieColorLayer[]>([]);
	let valueSlots = $state<LottieValueSlot[]>([]);
	let animations = $state<LottieAnimationEntry[]>([]);
	let themes = $state<string[]>([]);
	let inspectorLoading = $state(false);
	let inspectorError = $state(false);
	let showOtherColors = $state(false);
	let markerPick = $state('');
	const colorGroups = $derived.by(() => {
		const groups = new Map<
			string,
			{ original: string; keys: string[]; label: string; named: boolean }
		>();
		for (const layer of colorLayers) {
			const group = groups.get(layer.color);
			if (group) {
				group.keys.push(layer.key);
				if (layer.named) {
					group.named = true;
					group.label = layer.label;
				}
			} else {
				groups.set(layer.color, {
					original: layer.color,
					keys: [layer.key],
					label: layer.label,
					named: layer.named
				});
			}
		}
		return [...groups.values()];
	});
	const namedColors = $derived(colorGroups.filter((group) => group.named));
	const otherColors = $derived(colorGroups.filter((group) => !group.named));

	$effect(() => {
		const mediaId = item.mediaId;
		const animationId = item.lottieAnimationId;
		textLayers = [];
		colorLayers = [];
		valueSlots = [];
		animations = [];
		themes = [];
		inspectorError = false;
		if (!mediaId) return;
		const media = mediaPool.get(mediaId);
		if (!media) return;
		let disposed = false;
		inspectorLoading = true;
		void resolveMediaBlob(media)
			.then((blob) => blob.arrayBuffer())
			.then((buffer) => {
				const bytes = new Uint8Array(buffer);
				const animation = extractLottieAnimation(bytes, { animationId });
				const manifest = extractLottieManifest(bytes);
				if (disposed) return;
				textLayers = animation ? extractLottieTextLayers(animation) : [];
				colorLayers = animation ? extractLottieColorLayers(animation) : [];
				valueSlots = animation ? extractLottieValueSlots(animation) : [];
				animations = manifest?.animations ?? [];
				themes = manifest?.themes ?? [];
			})
			.catch(() => {
				if (!disposed) inspectorError = true;
			})
			.finally(() => {
				if (!disposed) inspectorLoading = false;
			});
		return () => {
			disposed = true;
		};
	});

	function commit(patch: Partial<TimelineItem>): void {
		updateItemProperties(item.id, patch, 'UPDATE_LOTTIE_PROPERTIES');
		onedit();
	}

	function setNumber(
		property: 'speed' | 'lottieSegmentStart' | 'lottieSegmentEnd',
		value: number
	): void {
		if (!Number.isFinite(value)) return;
		if (property === 'speed') {
			commit({ speed: Math.max(0.05, Math.min(16, value)) });
			return;
		}
		const next = Math.max(0, Math.min(maxFrame, Math.round(value)));
		if (property === 'lottieSegmentStart') {
			commit({
				lottieSegmentStart: next,
				lottieSegmentEnd: Math.max(next, item.lottieSegmentEnd ?? maxFrame)
			});
		} else {
			commit({
				lottieSegmentStart: Math.min(item.lottieSegmentStart ?? 0, next),
				lottieSegmentEnd: next
			});
		}
	}

	function useMarker(name: string): void {
		const marker = item.lottieMarkers?.find((candidate) => candidate.name === name);
		if (!marker) return;
		const start = Math.max(0, Math.min(Math.round(marker.start), maxFrame));
		const end =
			marker.duration > 0
				? Math.max(start, Math.min(Math.round(marker.start + marker.duration), maxFrame))
				: maxFrame;
		commit({ lottieSegmentStart: start, lottieSegmentEnd: end });
	}

	function setAnimation(animationId: string): void {
		if (!item.mediaId || animationId === item.lottieAnimationId) return;
		const media = mediaPool.get(item.mediaId);
		if (!media) return;
		void resolveMediaBlob(media)
			.then((blob) => blob.arrayBuffer())
			.then((buffer) => {
				const animation = extractLottieAnimation(new Uint8Array(buffer), { animationId });
				const metadata = parseLottieMetadata(animation);
				const patch: Partial<TimelineItem> = {
					lottieAnimationId: animationId,
					lottieSegmentStart: undefined,
					lottieSegmentEnd: undefined,
					lottieTextOverrides: undefined,
					lottieColorOverrides: undefined,
					lottieSlotOverrides: undefined
				};
				if (metadata) {
					patch.lottieTotalFrames = metadata.totalFrames;
					patch.lottieFrameRate = metadata.frameRate;
					patch.sourceFps = metadata.frameRate;
					patch.sourceWidth = metadata.width;
					patch.sourceHeight = metadata.height;
					patch.lottieMarkers = metadata.markers;
				}
				commit(patch);
			})
			.catch(() => undefined);
	}

	function setText(layer: LottieTextLayer, value: string): void {
		const next = { ...(item.lottieTextOverrides ?? {}) };
		if (value === layer.text) delete next[layer.key];
		else next[layer.key] = value;
		commit({ lottieTextOverrides: Object.keys(next).length ? next : undefined });
	}

	function setColor(keys: string[], original: string, value: string): void {
		const next = { ...(item.lottieColorOverrides ?? {}) };
		for (const key of keys) {
			if (value.toLowerCase() === original.toLowerCase()) delete next[key];
			else next[key] = value;
		}
		commit({ lottieColorOverrides: Object.keys(next).length ? next : undefined });
	}

	function setSlot(slot: LottieValueSlot, value: LottieSlotValue): void {
		const next = { ...(item.lottieSlotOverrides ?? {}) };
		const same =
			Array.isArray(value) && Array.isArray(slot.value)
				? value[0] === slot.value[0] && value[1] === slot.value[1]
				: value === slot.value;
		if (same) delete next[slot.id];
		else next[slot.id] = value;
		commit({ lottieSlotOverrides: Object.keys(next).length ? next : undefined });
	}
</script>

<section class="flex flex-col gap-2" aria-label={m.video_editor_lottie()}>
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
			{m.video_editor_lottie()}
		</h3>
		<span class="text-[9px] text-[oklch(0.58_0.01_55)] tabular-nums">
			{item.lottieTotalFrames ?? 1}f · {(item.lottieFrameRate ?? 30).toFixed(2)} fps
		</span>
	</div>
	{#if animations.length > 1 || themes.length > 0}
		<div class="grid grid-cols-2 gap-1">
			{#if animations.length > 1}
				<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_lottie_animation()}
					<AppSelect
						class="mt-0.5 h-8 w-full text-xs"
						value={item.lottieAnimationId ?? animations[0]?.id ?? ''}
						options={animations.map((animation) => ({ value: animation.id, label: animation.id }))}
						ariaLabel={m.video_editor_lottie_animation()}
						onValueChange={(value) => setAnimation(value)}
					/>
				</label>
			{/if}
			{#if themes.length > 0}
				<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_lottie_theme()}
					<AppSelect
						class="mt-0.5 h-8 w-full text-xs"
						value={item.lottieThemeId ?? ''}
						options={[{ value: '', label: m.video_editor_lottie_theme_none() }, ...themes.map((theme) => ({ value: theme, label: theme })) ]}
						ariaLabel={m.video_editor_lottie_theme()}
						onValueChange={(value) => commit({ lottieThemeId: value || undefined })}
					/>
				</label>
			{/if}
		</div>
	{/if}
	<div class="grid grid-cols-2 gap-1">
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_lottie_speed()}
			<Input
				type="number"
				min="0.05"
				max="16"
				step="0.05"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.speed ?? 1}
				onchange={(event) => setNumber('speed', event.currentTarget.valueAsNumber)}
			/>
		</label>
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_lottie_repeat_mode()}
			<AppSelect
				class="mt-0.5 h-8 w-full text-xs"
				value={item.lottieLoopMode ?? 'loop'}
				options={[{ value: 'loop', label: m.video_editor_lottie_loop() }, { value: 'pingpong', label: m.video_editor_lottie_ping_pong() }]}
				ariaLabel={m.video_editor_lottie_repeat_mode()}
				onValueChange={(value) => commit({ lottieLoopMode: value as 'loop' | 'pingpong' })}
			/>
		</label>
	</div>
	{#if item.lottieMarkers && item.lottieMarkers.length > 0}
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_lottie_marker()}
			<AppSelect
				class="mt-0.5 h-8 w-full text-xs"
				bind:value={markerPick}
				options={[{ value: '', label: m.video_editor_lottie_marker_choose() }, ...(item.lottieMarkers ?? []).map((marker) => ({ value: marker.name, label: marker.name })) ]}
				ariaLabel={m.video_editor_lottie_marker()}
				onValueChange={(value) => useMarker(value)}
			/>
		</label>
	{/if}
	<div class="grid grid-cols-2 gap-1">
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_property_start()}
			<Input
				type="number"
				min="0"
				max={maxFrame}
				step="1"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.lottieSegmentStart ?? 0}
				onchange={(event) => setNumber('lottieSegmentStart', event.currentTarget.valueAsNumber)}
			/>
		</label>
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_property_end()}
			<Input
				type="number"
				min="0"
				max={maxFrame}
				step="1"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.lottieSegmentEnd ?? maxFrame}
				onchange={(event) => setNumber('lottieSegmentEnd', event.currentTarget.valueAsNumber)}
			/>
		</label>
	</div>
	<div class="grid grid-cols-2 gap-1 rounded bg-[oklch(0.19_0.01_50)] p-1.5">
		<label class="flex min-h-7 items-center gap-2 text-[10px] text-[oklch(0.72_0.01_55)]">
			<Checkbox
				checked={item.lottieLoop ?? true}
				onCheckedChange={(checked) => commit({ lottieLoop: checked === true })}
				aria-label={m.video_editor_lottie_repeat()}
			/>
			{m.video_editor_lottie_repeat()}
		</label>
		<label class="flex min-h-7 items-center gap-2 text-[10px] text-[oklch(0.72_0.01_55)]">
			<Checkbox
				checked={item.lottieReversed ?? false}
				onCheckedChange={(checked) => commit({ lottieReversed: checked === true })}
				aria-label={m.video_editor_lottie_reverse()}
			/>
			{m.video_editor_lottie_reverse()}
		</label>
	</div>
	<p class="text-[10px] leading-4 text-[oklch(0.58_0.01_55)]">
		{m.video_editor_lottie_hint()}
	</p>
	{#if inspectorLoading}
		<p class="text-[10px] text-[oklch(0.58_0.01_55)]" role="status">
			{m.video_editor_lottie_inspecting()}
		</p>
	{:else if inspectorError}
		<p class="text-[10px] text-[oklch(0.7_0.14_28)]" role="alert">
			{m.video_editor_lottie_inspector_error()}
		</p>
	{/if}

	{#if textLayers.length > 0}
		<div class="flex flex-col gap-1.5 border-t border-[oklch(0.27_0.01_50)] pt-2">
			<div class="flex items-center justify-between gap-2">
				<h4 class="text-[10px] font-medium text-[oklch(0.72_0.01_55)]">
					{m.video_editor_lottie_text_layers()}
				</h4>
				{#if item.lottieTextOverrides}
					<button
						type="button"
						class="rounded px-1 text-[9px] text-[oklch(0.68_0.05_45)] hover:bg-[oklch(0.24_0.02_45)]"
						onclick={() => commit({ lottieTextOverrides: undefined })}
					>
						{m.video_editor_lottie_reset()}
					</button>
				{/if}
			</div>
			{#each textLayers as layer (layer.key)}
				<label class="min-w-0 text-[9px] text-[oklch(0.62_0.01_55)]">
					<span class="block truncate">{layer.label}</span>
					<Input
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.lottieTextOverrides?.[layer.key] ?? layer.text}
						onchange={(event) => setText(layer, event.currentTarget.value)}
					/>
				</label>
			{/each}
		</div>
	{/if}

	{#if colorGroups.length > 0}
		<div class="flex flex-col gap-1.5 border-t border-[oklch(0.27_0.01_50)] pt-2">
			<div class="flex items-center justify-between gap-2">
				<h4 class="text-[10px] font-medium text-[oklch(0.72_0.01_55)]">
					{m.video_editor_lottie_colors()}
				</h4>
				{#if item.lottieColorOverrides}
					<button
						type="button"
						class="rounded px-1 text-[9px] text-[oklch(0.68_0.05_45)] hover:bg-[oklch(0.24_0.02_45)]"
						onclick={() => commit({ lottieColorOverrides: undefined })}
					>
						{m.video_editor_lottie_reset()}
					</button>
				{/if}
			</div>
			{#each namedColors.length > 0 ? namedColors : otherColors as group (group.original)}
				<label
					class="flex min-h-8 items-center justify-between gap-2 rounded bg-[oklch(0.2_0.01_50)] px-1.5 text-[10px] text-[oklch(0.68_0.01_55)]"
				>
					<span class="min-w-0 truncate">{group.label}</span>
					<Input
						type="color"
						class="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
						value={item.lottieColorOverrides?.[group.keys[0]!] ?? group.original}
						onchange={(event) => setColor(group.keys, group.original, event.currentTarget.value)}
					/>
				</label>
			{/each}
			{#if namedColors.length > 0 && otherColors.length > 0}
				<button
					type="button"
					class="min-h-7 rounded px-1.5 text-left text-[10px] text-[oklch(0.62_0.01_55)] hover:bg-[oklch(0.22_0.01_50)]"
					onclick={() => (showOtherColors = !showOtherColors)}
				>
					{showOtherColors
						? m.video_editor_lottie_hide_other_colors()
						: m.video_editor_lottie_show_other_colors({ count: otherColors.length })}
				</button>
				{#if showOtherColors}
					{#each otherColors as group (group.original)}
						<label
							class="flex min-h-8 items-center justify-between gap-2 rounded bg-[oklch(0.2_0.01_50)] px-1.5 text-[10px] text-[oklch(0.68_0.01_55)]"
						>
							<span class="min-w-0 truncate">{group.label}</span>
							<Input
								type="color"
								class="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
								value={item.lottieColorOverrides?.[group.keys[0]!] ?? group.original}
								onchange={(event) =>
									setColor(group.keys, group.original, event.currentTarget.value)}
							/>
						</label>
					{/each}
				{/if}
			{/if}
		</div>
	{/if}

	{#if valueSlots.length > 0}
		<div class="flex flex-col gap-1.5 border-t border-[oklch(0.27_0.01_50)] pt-2">
			<div class="flex items-center justify-between gap-2">
				<h4 class="text-[10px] font-medium text-[oklch(0.72_0.01_55)]">
					{m.video_editor_lottie_properties()}
				</h4>
				{#if item.lottieSlotOverrides}
					<button
						type="button"
						class="rounded px-1 text-[9px] text-[oklch(0.68_0.05_45)] hover:bg-[oklch(0.24_0.02_45)]"
						onclick={() => commit({ lottieSlotOverrides: undefined })}
					>
						{m.video_editor_lottie_reset()}
					</button>
				{/if}
			</div>
			{#each valueSlots as slot (slot.id)}
				{@const current = item.lottieSlotOverrides?.[slot.id] ?? slot.value}
				<label class="min-w-0 text-[9px] text-[oklch(0.62_0.01_55)]">
					<span class="block truncate">{slot.label}</span>
					{#if slot.type === 'scalar'}
						<Input
							type="number"
							step="0.1"
							class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
							value={typeof current === 'number' ? current : slot.value}
							onchange={(event) => setSlot(slot, event.currentTarget.valueAsNumber)}
						/>
					{:else}
						{@const vector = Array.isArray(current) ? current : slot.value}
						<div class="mt-0.5 grid grid-cols-2 gap-1">
							<Input
								type="number"
								step="0.1"
								class="h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
								aria-label={`${slot.label} X`}
								value={vector[0]}
								onchange={(event) => setSlot(slot, [event.currentTarget.valueAsNumber, vector[1]])}
							/>
							<Input
								type="number"
								step="0.1"
								class="h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
								aria-label={`${slot.label} Y`}
								value={vector[1]}
								onchange={(event) => setSlot(slot, [vector[0], event.currentTarget.valueAsNumber])}
							/>
						</div>
					{/if}
				</label>
			{/each}
		</div>
	{/if}
</section>
