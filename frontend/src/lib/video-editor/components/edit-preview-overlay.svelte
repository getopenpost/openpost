<!-- Compact edit comparison overlay: 2-up for rolling/ripple, 4-up with baseline corners for slip/slide. -->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { editPreviewStore } from '$lib/video-editor/preview/edit-preview-store.svelte';
	import {
		buildRipplePanels,
		buildRollingPanels,
		buildSlidePanels,
		buildSlipPanels,
		createFittedVirtualItem,
		type EditPreviewPanel
	} from '$lib/video-editor/timeline/edit-preview-frames';
	import PreviewLayer from './preview-layer.svelte';
	import { shouldUseAutomaticProxy } from '$lib/video-editor/media/proxy-client';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';

	let {
		canvasWidth,
		canvasHeight,
		urls,
		proxyUrls
	}: {
		canvasWidth: number;
		canvasHeight: number;
		urls: Record<string, string>;
		proxyUrls: Record<string, string>;
	} = $props();

	const state = $derived(editPreviewStore.current);
	const fps = $derived(timelineStore.fps);

	const panels = $derived.by(() => {
		if (!state) return { kind: null, list: [] };
		const items = timelineStore.items;
		if (state.kind === 'rolling' && state.leftId && state.rightId) {
			return { kind: 'rolling', list: buildRollingPanels(items, state.leftId, state.rightId, fps) };
		}
		if (state.kind === 'ripple' && state.anchorId) {
			return {
				kind: 'ripple',
				list: buildRipplePanels(items, state.anchorId, state.handle ?? 'end', fps)
			};
		}
		if (state.kind === 'slip' && state.anchorId) {
			return { kind: 'slip', list: buildSlipPanels(items, state.anchorId, state.baseline, fps) };
		}
		if (state.kind === 'slide' && state.anchorId) {
			return {
				kind: 'slide',
				list: buildSlidePanels(
					items,
					state.anchorId,
					state.leftId,
					state.rightId,
					state.baseline,
					fps
				)
			};
		}
		return { kind: null, list: [] };
	});

	const isFourUp = $derived(state?.kind === 'slip' || state?.kind === 'slide');
	const overlayLabel = $derived.by(() => {
		if (!state) return '';
		if (state.kind === 'rolling') return m.video_editor_edit_preview_rolling();
		if (state.kind === 'ripple') return m.video_editor_edit_preview_ripple();
		if (state.kind === 'slip') return m.video_editor_edit_preview_slip();
		if (state.kind === 'slide') return m.video_editor_edit_preview_slide();
		return '';
	});

	function urlForPanel(panel: EditPreviewPanel): string | null {
		const item = panel.item;
		if (!item?.mediaId) return null;
		const media = mediaPool.get(item.mediaId);
		if (media && shouldUseAutomaticProxy(media, 'auto') && proxyUrls[item.mediaId]) {
			return proxyUrls[item.mediaId] ?? null;
		}
		return urls[item.mediaId] ?? null;
	}

	function fittedItem(
		panel: EditPreviewPanel
	): import('$lib/video-editor/project/types').TimelineItem | null {
		if (!panel.item || panel.isGap) return null;
		return createFittedVirtualItem(panel.item, canvasWidth, canvasHeight);
	}

	const mainPanels = $derived.by(() => {
		if (!isFourUp) return panels.list;
		return panels.list.slice(0, 2);
	});
	const cornerPanels = $derived.by(() => {
		if (!isFourUp) return [];
		return panels.list.slice(2, 4);
	});

	function displayLabel(panel: EditPreviewPanel): string {
		if (panel.label === 'OUT') return m.video_editor_edit_preview_out();
		if (panel.label === 'IN') return m.video_editor_edit_preview_in();
		return m.video_editor_edit_preview_gap_label();
	}
</script>

{#if state && panels.list.length > 0}
	<div
		class="pointer-events-none absolute inset-x-2 top-2 z-30 flex flex-col items-center gap-1"
		role="region"
		aria-label={overlayLabel}
		data-testid="edit-preview-overlay"
		data-edit-preview-kind={state.kind}
	>
		<div
			class="flex max-w-full flex-col items-center gap-1 rounded-lg border border-white/15 bg-black/85 px-2 py-2 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-black/70"
		>
			<div class="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-white">
				<span class="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-black"
					>{overlayLabel}</span
				>
				<span class="text-white/70"
					>{isFourUp ? m.video_editor_edit_preview_baseline_hint() : ''}</span
				>
			</div>
			{#if isFourUp}
				<div
					class="grid w-full max-w-[min(560px,calc(100vw-16px))] grid-cols-2 gap-1.5 sm:max-w-[560px]"
					style="container-type:inline-size"
				>
					{#each mainPanels as panel, index (panel.label + '-main-' + index)}
						{@const corner = cornerPanels[index]}
						<div class="relative">
							<div
								class="flex flex-col overflow-hidden rounded-md border border-white/20 bg-black"
								data-testid="edit-preview-panel"
								data-edit-preview-label={panel.label}
								data-edit-preview-frame={panel.frame ?? 'gap'}
								data-edit-preview-baseline="false"
							>
								<div
									class="flex items-center justify-between gap-1 bg-white px-1.5 py-1 text-[10px] leading-none font-semibold text-black"
								>
									<span class="tracking-wide">{displayLabel(panel)}</span>
									<span class="font-mono tabular-nums"
										>{panel.timecode ?? m.video_editor_edit_preview_time_missing()}</span
									>
								</div>
								<div class="relative aspect-video w-full overflow-hidden bg-zinc-950">
									{#if panel.isGap || !panel.item}
										<div
											class="flex size-full items-center justify-center bg-[repeating-linear-gradient(45deg,oklch(0.22_0.01_55)_0_8px,oklch(0.18_0.01_55)_8px_16px)] text-[11px] font-semibold tracking-wide text-white/80"
											data-edit-preview-gap="true"
										>
											{m.video_editor_edit_preview_gap_label()}
										</div>
									{:else}
										{@const virtual = fittedItem(panel)}
										{#if virtual}
											<div class="absolute inset-0">
												<PreviewLayer
													item={virtual}
													displayFrame={panel.frame ?? virtual.from}
													url={urlForPanel(panel)}
													audioUrl={urlForPanel(panel)}
													{canvasWidth}
													{canvasHeight}
													previewScale={0.5}
													selected={false}
													onselect={() => {}}
												/>
											</div>
										{/if}
									{/if}
								</div>
								{#if panel.isGap}
									<div class="bg-amber-500/15 px-1.5 py-1 text-[10px] leading-tight text-amber-100">
										{m.video_editor_edit_preview_gap()}
									</div>
								{/if}
							</div>
							{#if corner}
								<div
									class="absolute -right-1 -bottom-1 w-[42%] overflow-hidden rounded-md border border-white/40 bg-black shadow-lg sm:w-[38%]"
									data-testid="edit-preview-baseline"
									data-edit-preview-label={corner.label}
									data-edit-preview-frame={corner.frame ?? 'gap'}
									data-edit-preview-baseline="true"
								>
									<div
										class="flex items-center justify-between gap-1 bg-white/10 px-1 py-0.5 text-[8px] leading-none font-semibold text-white/80"
									>
										<span>{displayLabel(corner)} - {m.video_editor_edit_preview_baseline()}</span>
										<span class="font-mono"
											>{corner.timecode ?? m.video_editor_edit_preview_time_missing()}</span
										>
									</div>
									<div class="relative aspect-video w-full overflow-hidden bg-zinc-950">
										{#if corner.isGap || !corner.item}
											<div
												class="flex size-full items-center justify-center bg-[repeating-linear-gradient(45deg,oklch(0.22_0.01_55)_0_6px,oklch(0.18_0.01_55)_6px_12px)] text-[9px] font-semibold text-white/70"
												data-edit-preview-gap="true"
											>
												{m.video_editor_edit_preview_gap_label()}
											</div>
										{:else}
											{@const cVirtual = fittedItem(corner)}
											{#if cVirtual}
												<div class="absolute inset-0">
													<PreviewLayer
														item={cVirtual}
														displayFrame={corner.frame ?? cVirtual.from}
														url={urlForPanel(corner)}
														audioUrl={urlForPanel(corner)}
														{canvasWidth}
														{canvasHeight}
														previewScale={0.35}
														selected={false}
														onselect={() => {}}
													/>
												</div>
											{/if}
										{/if}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div
					class="grid w-full max-w-[min(360px,calc(100vw-16px))] grid-cols-2 gap-1.5 sm:max-w-[360px]"
				>
					{#each panels.list as panel (panel.label + '-' + panel.frame)}
						<div
							class="flex flex-col overflow-hidden rounded-md border border-white/20 bg-black"
							data-testid="edit-preview-panel"
							data-edit-preview-label={panel.label}
							data-edit-preview-frame={panel.frame ?? 'gap'}
							data-edit-preview-baseline={panel.isBaseline ? 'true' : 'false'}
						>
							<div
								class="flex items-center justify-between gap-1 bg-white px-1.5 py-1 text-[10px] leading-none font-semibold text-black"
							>
								<span class="tracking-wide">{displayLabel(panel)}</span>
								<span class="font-mono tabular-nums"
									>{panel.timecode ?? m.video_editor_edit_preview_time_missing()}</span
								>
							</div>
							<div class="relative aspect-video w-full overflow-hidden bg-zinc-950">
								{#if panel.isGap || !panel.item}
									<div
										class="flex size-full items-center justify-center bg-[repeating-linear-gradient(45deg,oklch(0.22_0.01_55)_0_8px,oklch(0.18_0.01_55)_8px_16px)] text-[11px] font-semibold tracking-wide text-white/80"
										data-edit-preview-gap="true"
									>
										{m.video_editor_edit_preview_gap_label()}
									</div>
								{:else}
									{@const virtual = fittedItem(panel)}
									{#if virtual}
										<div class="absolute inset-0">
											<PreviewLayer
												item={virtual}
												displayFrame={panel.frame ?? virtual.from}
												url={urlForPanel(panel)}
												audioUrl={urlForPanel(panel)}
												{canvasWidth}
												{canvasHeight}
												previewScale={0.5}
												selected={false}
												onselect={() => {}}
											/>
										</div>
									{/if}
								{/if}
							</div>
							{#if panel.isGap}
								<div class="bg-amber-500/15 px-1.5 py-1 text-[10px] leading-tight text-amber-100">
									{m.video_editor_edit_preview_gap()}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			<div class="text-center text-[10px] leading-tight text-white/60">
				{m.video_editor_edit_preview_hint()}
			</div>
		</div>
	</div>
{/if}
