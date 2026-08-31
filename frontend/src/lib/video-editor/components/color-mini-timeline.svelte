<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		colorGradeTileEffects,
		resolveColorGradeThumbnailTreatment,
		type ColorGradeThumbnailTreatment
	} from '$lib/video-editor/effects/color-grade-thumbnail';
	import { renderColorGradeTile } from '$lib/video-editor/effects/color-grade-tile-renderer';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import type { GpuRenderEffect } from '$lib/video-editor/effects/gpu/compositor';
	import { filmstripCache, type FilmstripFrame } from '$lib/video-editor/media/filmstrip-client';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import {
		formatTimelinePreviewTimecode,
		timelinePreviewScrub
	} from '$lib/video-editor/preview/timeline-preview-scrub';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import {
		colorClipStartFrameIndex,
		colorTimelineFrameFromClientX,
		colorTimelineRatio,
		isColorTimelineItem,
		resolveColorTimelineMaxFrame
	} from '$lib/video-editor/timeline/color-mini-timeline';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { readBlob } from '$lib/video-editor/workspace-fs/fs-primitives';
	import { mediaThumbnailPath } from '$lib/video-editor/workspace-fs/paths';
	import { getWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';

	const LABEL_WIDTH = 32;
	const RULER_RATIOS = [0, 0.25, 0.5, 0.75, 1] as const;
	const TRACK_AREA_HEIGHT = 86;
	const GRADE_RENDER_DEBOUNCE_MS = 100;

	interface GradeTileRequest {
		itemId: string;
		baseUrl: string | undefined;
		effects: GpuRenderEffect[];
		signature: string;
		treatment: ColorGradeThumbnailTreatment;
	}

	let {
		selectedItemIds = [],
		onselectitem = () => undefined
	}: { selectedItemIds?: string[]; onselectitem?: (itemId: string) => void } = $props();

	let thumbnailUrls = $state<Record<string, string>>({});
	let thumbnailGeneration = 0;
	let loadedThumbnailRevision = -1;
	const ownedThumbnailUrls = new Map<string, string>();
	let gradedThumbnailUrls = $state<Record<string, string>>({});
	let gradeGeneration = 0;
	let gradeTimer: ReturnType<typeof setTimeout> | null = null;
	const ownedGradedUrls = new Map<string, { signature: string; url: string }>();
	let startFrames = $state<Record<string, FilmstripFrame[]>>({});
	const filmstripUnsubscribers = new Map<string, () => void>();
	let scrub: {
		pointerId: number;
		rect: DOMRect;
		latestClientX: number;
		animationFrame: number | null;
	} | null = null;

	const visualItems = $derived(
		timelineStore.items
			.filter(isColorTimelineItem)
			.toSorted((left, right) => left.from - right.from)
	);
	const visualTracks = $derived.by(() => {
		const trackIds = new Set(visualItems.map((item) => item.trackId));
		return timelineStore.tracks
			.filter((track) => !track.isGroup && trackIds.has(track.id))
			.toSorted((left, right) => left.order - right.order);
	});
	const selectedIds = $derived(new Set(selectedItemIds));
	const trackNameById = $derived(
		new Map(timelineStore.tracks.map((track) => [track.id, track.name]))
	);
	const maxFrame = $derived(
		resolveColorTimelineMaxFrame({
			items: timelineStore.items,
			markers: timelineStore.markers,
			inPoint: timelineStore.inPoint,
			outPoint: timelineStore.outPoint,
			fps: timelineStore.fps
		})
	);
	const displayFrame = $derived($timelinePreviewScrub.frame ?? timelineStore.currentFrame);
	const trackRowHeight = $derived(TRACK_AREA_HEIGHT / Math.max(1, visualTracks.length));
	const clipStartRequests = $derived(
		visualItems.flatMap((item) => {
			if (item.type !== 'video' || !item.mediaId) return [];
			const media = mediaPool.get(item.mediaId);
			if (!media) return [];
			return [
				{
					itemId: item.id,
					media,
					index: colorClipStartFrameIndex({
						sourceStart: item.sourceStart,
						sourceDuration: item.sourceDuration,
						sourceFps: item.sourceFps,
						mediaDuration: media.duration,
						mediaFps: media.fps
					})
				}
			];
		})
	);
	const gradeTileRequests = $derived.by(() => {
		void colorPreviewStore.effectDraft;
		return visualItems.map((item): GradeTileRequest => {
			const effects = colorPreviewStore.applyEffectDraft(item.id, item.effects ?? []);
			const gpuEffects = colorGradeTileEffects(effects);
			const clipStart = clipStartRequests.find((request) => request.itemId === item.id);
			const frames = clipStart ? startFrames[clipStart.media.id] : undefined;
			const startFrame = clipStart
				? frames?.reduce<FilmstripFrame | null>((nearest, frame) => {
						if (!nearest) return frame;
						return Math.abs(frame.index - clipStart.index) <
							Math.abs(nearest.index - clipStart.index)
							? frame
							: nearest;
					}, null)
				: null;
			const baseUrl = startFrame?.url ?? (item.mediaId ? thumbnailUrls[item.mediaId] : undefined);
			return {
				itemId: item.id,
				baseUrl,
				effects: gpuEffects,
				signature: `${baseUrl ?? ''}|${JSON.stringify(gpuEffects)}`,
				treatment: resolveColorGradeThumbnailTreatment(effects)
			};
		});
	});
	const gradeTileByItem = $derived(
		Object.fromEntries(gradeTileRequests.map((request) => [request.itemId, request]))
	);

	function itemsForTrack(track: TimelineTrack): TimelineItem[] {
		return visualItems.filter((item) => item.trackId === track.id);
	}

	function frameRatio(frame: number): number {
		return colorTimelineRatio(frame, maxFrame);
	}

	function formatClock(frame: number): string {
		return formatTimelinePreviewTimecode(frame, timelineStore.fps).slice(0, 8);
	}

	function miniClipHeight(): number {
		return trackRowHeight >= 10
			? Math.max(8, Math.min(16, trackRowHeight - 4))
			: Math.max(4, trackRowHeight - 2);
	}

	function miniClipTop(): number {
		return Math.max(1, (trackRowHeight - miniClipHeight()) / 2);
	}

	function seekAndSelect(item: TimelineItem): void {
		editorSession.pausePlayback();
		timelinePreviewScrub.clear();
		setCurrentFrame(item.from);
		timelineStore._setSelectedMarkerId(null);
		onselectitem(item.id);
	}

	function seekMarker(marker: { id: string; frame: number }): void {
		editorSession.pausePlayback();
		timelinePreviewScrub.clear();
		setCurrentFrame(marker.frame);
		timelineStore._setSelectedMarkerId(marker.id);
	}

	function frameFromClientX(clientX: number): number | null {
		if (!scrub) return null;
		return colorTimelineFrameFromClientX({
			clientX,
			left: scrub.rect.left,
			width: scrub.rect.width,
			labelWidth: LABEL_WIDTH,
			maxFrame
		});
	}

	function flushScrubPreview(): void {
		if (!scrub) return;
		scrub.animationFrame = null;
		const frame = frameFromClientX(scrub.latestClientX);
		if (frame !== null) timelinePreviewScrub.setFrame(frame);
	}

	function moveScrub(event: PointerEvent): void {
		if (!scrub || event.pointerId !== scrub.pointerId) return;
		scrub.latestClientX = event.clientX;
		if (scrub.animationFrame === null) {
			scrub.animationFrame = requestAnimationFrame(flushScrubPreview);
		}
	}

	function finishScrub(event: PointerEvent): void {
		if (!scrub || event.pointerId !== scrub.pointerId) return;
		const active = scrub;
		if (active.animationFrame !== null) cancelAnimationFrame(active.animationFrame);
		const frame = frameFromClientX(event.clientX);
		scrub = null;
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (frame !== null) setCurrentFrame(frame);
		timelinePreviewScrub.clear();
	}

	function cancelScrub(event?: PointerEvent): void {
		if (event && scrub && event.pointerId !== scrub.pointerId) return;
		if (scrub?.animationFrame !== null && scrub?.animationFrame !== undefined) {
			cancelAnimationFrame(scrub.animationFrame);
		}
		const active = scrub;
		scrub = null;
		if (event && active && event.currentTarget.hasPointerCapture?.(active.pointerId)) {
			event.currentTarget.releasePointerCapture(active.pointerId);
		}
		timelinePreviewScrub.clear();
	}

	function startScrub(event: PointerEvent): void {
		if (event.button !== 0 || scrub || timelineStore.seekLocked) return;
		editorSession.pausePlayback();
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		scrub = {
			pointerId: event.pointerId,
			rect: event.currentTarget.getBoundingClientRect(),
			latestClientX: event.clientX,
			animationFrame: null
		};
		const frame = frameFromClientX(event.clientX);
		if (frame !== null) timelinePreviewScrub.setFrame(frame);
	}

	function onTimelineKeydown(event: KeyboardEvent): void {
		if (timelineStore.seekLocked) return;
		let frame = timelineStore.currentFrame;
		if (event.key === 'ArrowLeft') frame -= event.shiftKey ? 10 : 1;
		else if (event.key === 'ArrowRight') frame += event.shiftKey ? 10 : 1;
		else if (event.key === 'Home') frame = 0;
		else if (event.key === 'End') frame = maxFrame;
		else return;
		event.preventDefault();
		editorSession.pausePlayback();
		setCurrentFrame(Math.min(maxFrame, Math.max(0, frame)));
	}

	async function syncThumbnails(mediaIds: readonly string[], revision: number): Promise<void> {
		const generation = ++thumbnailGeneration;
		const activeIds = new Set(mediaIds);
		if (revision !== loadedThumbnailRevision) {
			loadedThumbnailRevision = revision;
			for (const url of ownedThumbnailUrls.values()) URL.revokeObjectURL(url);
			ownedThumbnailUrls.clear();
			thumbnailUrls = {};
		}
		for (const [id, url] of ownedThumbnailUrls) {
			if (activeIds.has(id)) continue;
			URL.revokeObjectURL(url);
			ownedThumbnailUrls.delete(id);
		}
		const root = getWorkspaceRoot();
		if (root) {
			await Promise.all(
				mediaIds.map(async (id) => {
					if (ownedThumbnailUrls.has(id)) return;
					try {
						const thumbnail = await readBlob(root, mediaThumbnailPath(id));
						if (!thumbnail || generation !== thumbnailGeneration) return;
						ownedThumbnailUrls.set(id, URL.createObjectURL(thumbnail));
					} catch {
						// The compact tile remains useful without a cached image.
					}
				})
			);
		}
		if (generation !== thumbnailGeneration) return;
		thumbnailUrls = Object.fromEntries(ownedThumbnailUrls);
	}

	function syncClipStartFrames(requests: typeof clipStartRequests): void {
		const activeMediaIds = new Set(requests.map((request) => request.media.id));
		for (const [mediaId, unsubscribe] of filmstripUnsubscribers) {
			if (activeMediaIds.has(mediaId)) continue;
			unsubscribe();
			filmstripUnsubscribers.delete(mediaId);
			delete startFrames[mediaId];
		}
		const requestsByMedia = Map.groupBy(requests, (request) => request.media.id);
		for (const [mediaId, mediaRequests] of requestsByMedia) {
			if (!filmstripUnsubscribers.has(mediaId)) {
				filmstripUnsubscribers.set(
					mediaId,
					filmstripCache.subscribe(mediaId, (filmstrip) => {
						startFrames[mediaId] = filmstrip.frames.map((frame) => ({ ...frame }));
					})
				);
			}
			const media = mediaRequests[0]?.media;
			if (!media) continue;
			const indices = [...new Set(mediaRequests.map((request) => request.index))];
			void filmstripCache
				.getFilmstrip(media, {
					targetFrameIndices: indices,
					priorityRange: {
						startIndex: Math.min(...indices),
						endIndex: Math.max(...indices) + 1
					}
				})
				.catch(() => undefined);
		}
	}

	function publishGradedUrls(): void {
		gradedThumbnailUrls = Object.fromEntries(
			[...ownedGradedUrls].map(([itemId, entry]) => [itemId, entry.url])
		);
	}

	async function renderGradedThumbnails(
		requests: readonly GradeTileRequest[],
		generation: number
	): Promise<void> {
		await Promise.all(
			requests.map(async (request) => {
				if (!request.baseUrl || request.effects.length === 0) return;
				if (ownedGradedUrls.get(request.itemId)?.signature === request.signature) return;
				const blob = await renderColorGradeTile(request.baseUrl, request.effects);
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const current = gradeTileRequests.find((entry) => entry.itemId === request.itemId);
				if (generation !== gradeGeneration || current?.signature !== request.signature) {
					URL.revokeObjectURL(url);
					return;
				}
				const previous = ownedGradedUrls.get(request.itemId);
				if (previous) URL.revokeObjectURL(previous.url);
				ownedGradedUrls.set(request.itemId, { signature: request.signature, url });
			})
		);
		if (generation === gradeGeneration) publishGradedUrls();
	}

	function scheduleGradedThumbnails(requests: readonly GradeTileRequest[]): void {
		const generation = ++gradeGeneration;
		if (gradeTimer) clearTimeout(gradeTimer);
		gradeTimer = null;
		const currentSignatures = new Map(
			requests.map((request) => [request.itemId, request.signature])
		);
		for (const [itemId, entry] of ownedGradedUrls) {
			if (currentSignatures.get(itemId) === entry.signature) continue;
			URL.revokeObjectURL(entry.url);
			ownedGradedUrls.delete(itemId);
		}
		publishGradedUrls();
		if (!requests.some((request) => request.baseUrl && request.effects.length > 0)) return;
		gradeTimer = setTimeout(() => {
			gradeTimer = null;
			void renderGradedThumbnails(requests, generation);
		}, GRADE_RENDER_DEBOUNCE_MS);
	}

	$effect(() => {
		const revision = mediaPool.thumbnailRevision;
		const mediaIds = Array.from(
			new Set(visualItems.map((item) => item.mediaId).filter((id): id is string => Boolean(id)))
		);
		untrack(() => void syncThumbnails(mediaIds, revision));
	});

	$effect(() => {
		const requests = clipStartRequests;
		untrack(() => syncClipStartFrames(requests));
	});

	$effect(() => {
		const requests = gradeTileRequests;
		untrack(() => scheduleGradedThumbnails(requests));
	});

	onDestroy(() => {
		thumbnailGeneration += 1;
		gradeGeneration += 1;
		if (gradeTimer) clearTimeout(gradeTimer);
		cancelScrub();
		for (const url of ownedThumbnailUrls.values()) URL.revokeObjectURL(url);
		ownedThumbnailUrls.clear();
		for (const entry of ownedGradedUrls.values()) URL.revokeObjectURL(entry.url);
		ownedGradedUrls.clear();
		for (const unsubscribe of filmstripUnsubscribers.values()) unsubscribe();
		filmstripUnsubscribers.clear();
	});
</script>

<section
	class="h-[212px] shrink-0 overflow-hidden border-y border-[oklch(0.25_0.015_55)] bg-[#24252b]"
	aria-label={m.video_editor_timeline_navigator()}
	data-color-mini-timeline
>
	<div
		class="flex h-[92px] shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-black/45 px-1 pt-1 pb-2"
	>
		{#each visualItems as item, index (item.id)}
			{@const grade = gradeTileByItem[item.id]}
			{@const gradedUrl = gradedThumbnailUrls[item.id]}
			<button
				type="button"
				class="group grid h-20 w-[118px] shrink-0 grid-rows-[20px_1fr_16px] overflow-hidden rounded-[3px] border bg-[#17181d] text-left shadow-sm transition-colors {selectedIds.has(
					item.id
				)
					? 'border-orange-500 shadow-[0_0_0_1px_rgba(249,115,22,0.65)]'
					: 'border-zinc-700 hover:border-zinc-500'}"
				aria-pressed={selectedIds.has(item.id)}
				aria-label={`${item.label}, ${formatTimelinePreviewTimecode(item.from, timelineStore.fps)}`}
				onpointerdown={(event) => {
					event.stopPropagation();
					if (event.button === 0) seekAndSelect(item);
				}}
				onclick={(event) => {
					if (event.detail === 0) seekAndSelect(item);
				}}
				data-color-film-tile={item.id}
				title={item.label}
			>
				<span
					class="flex min-w-0 items-center gap-1 border-b border-black/40 bg-[#24252b] px-1.5 text-[10px] font-semibold text-zinc-200"
				>
					<span
						class="rounded-[2px] border px-1 leading-3 {selectedIds.has(item.id)
							? 'border-lime-300/80 bg-indigo-700 text-lime-200'
							: 'border-indigo-400/70 bg-zinc-800 text-zinc-200'}"
					>
						{String(index + 1).padStart(2, '0')}
					</span>
					<span class="font-mono"
						>{formatTimelinePreviewTimecode(item.from, timelineStore.fps).slice(0, 8)}</span
					>
					<span class="ml-auto truncate text-[9px] text-zinc-400"
						>{trackNameById.get(item.trackId) || 'V1'}</span
					>
				</span>

				<span class="relative block min-h-0 overflow-hidden bg-black">
					{#if item.mediaId && (gradedUrl || grade?.baseUrl)}
						<img
							src={gradedUrl ?? grade?.baseUrl}
							alt=""
							class="size-full object-cover"
							style:filter={!gradedUrl && grade?.treatment.hasGrade
								? grade.treatment.filter
								: undefined}
							data-graded-thumbnail={grade?.treatment.hasGrade ? 'true' : undefined}
							data-grade-source={gradedUrl ? 'gpu' : grade?.treatment.hasGrade ? 'css' : undefined}
						/>
					{/if}
					{#if !gradedUrl && grade?.treatment.overlayBackground}
						<span
							class="pointer-events-none absolute inset-0 mix-blend-color"
							style:background={grade.treatment.overlayBackground}
							data-color-grade-overlay
						></span>
					{/if}
					{#if grade?.treatment.hasGrade}
						<span
							class="pointer-events-none absolute top-1 right-1 flex h-1.5 w-6 overflow-hidden rounded-full border border-black/45 shadow-sm"
							aria-hidden="true"
							data-color-grade-indicator
						>
							<span class="h-full flex-1 bg-red-500"></span>
							<span class="h-full flex-1 bg-lime-400"></span>
							<span class="h-full flex-1 bg-sky-500"></span>
						</span>
					{/if}
				</span>

				<span
					class="truncate border-t border-black/40 bg-[#202127] px-1.5 text-[10px] font-medium text-zinc-300"
				>
					{item.label}
				</span>
			</button>
		{:else}
			<p class="flex min-w-full items-center justify-center px-3 text-xs text-white/45">
				{m.video_editor_no_media()}
			</p>
		{/each}
	</div>

	<div
		class="relative h-[120px] cursor-ew-resize touch-none overflow-hidden bg-[#1d1e23] outline-none focus-visible:ring-2 focus-visible:ring-orange-300 focus-visible:ring-inset"
		role="group"
		aria-label={m.video_editor_timeline_navigator()}
		onpointerdown={startScrub}
		onpointermove={moveScrub}
		onpointerup={finishScrub}
		onpointercancel={cancelScrub}
		data-color-timeline-scrub
	>
		<div class="relative h-[14px] border-b border-black/45 bg-[#202127]">
			<div
				class="absolute inset-y-0 left-0 flex w-11 items-center justify-center border-r border-black/40 font-mono text-[9px] text-white/45"
			>
				I/O
			</div>
			<div class="absolute inset-y-0 right-0" style={`left:${LABEL_WIDTH}px`}>
				{#if timelineStore.inPoint !== null || timelineStore.outPoint !== null}
					{@const rangeStart = timelineStore.inPoint ?? 0}
					{@const rangeEnd = timelineStore.outPoint ?? maxFrame}
					<div
						class="absolute inset-y-[4px] rounded-sm bg-orange-400/45 ring-1 ring-orange-300/60"
						style={`left:${frameRatio(rangeStart) * 100}%;width:${Math.max(0.2, (frameRatio(rangeEnd) - frameRatio(rangeStart)) * 100)}%`}
						data-color-timeline-range
					></div>
				{/if}
			</div>
		</div>

		<div class="relative h-5 border-b border-black/45">
			<div class="absolute inset-y-0 right-0" style={`left:${LABEL_WIDTH}px`}>
				{#each RULER_RATIOS as ratio}
					<span
						class="absolute top-0 h-full border-l border-white/20 pt-1 pl-1 font-mono text-[8px] text-white/40 first:text-white/55"
						style={`left:${ratio * 100}%`}
					>
						{formatClock(Math.round(ratio * maxFrame))}
					</span>
				{/each}
			</div>
		</div>

		<div class="relative h-[86px] overflow-hidden" data-color-timeline-tracks>
			<div class="relative h-[86px]">
				{#each visualTracks as track, index (track.id)}
					<div
						class="absolute right-0 left-0 border-b border-white/[0.07]"
						style={`top:${index * trackRowHeight}px;height:${trackRowHeight}px`}
					>
						<span
							class="absolute inset-y-0 left-0 flex w-8 items-center justify-center truncate border-r border-black/40 px-1 text-[9px] font-semibold text-zinc-400"
						>
							{track.name}
						</span>
						<div class="absolute inset-y-0 right-0" style={`left:${LABEL_WIDTH}px`}>
							{#each itemsForTrack(track) as item (item.id)}
								<button
									type="button"
									class="absolute min-w-4 overflow-hidden rounded-[2px] border text-left transition-colors {selectedIds.has(
										item.id
									)
										? 'z-10 border-orange-500 bg-orange-500/20 shadow-[0_0_0_1px_rgba(249,115,22,0.45)]'
										: 'border-sky-500/70 bg-sky-500/45 hover:border-sky-300'}"
									style={`left:${frameRatio(item.from) * 100}%;width:${Math.max(0.6, colorTimelineRatio(item.durationInFrames, maxFrame) * 100)}%;top:${miniClipTop()}px;height:${miniClipHeight()}px`}
									aria-label={item.label}
									aria-pressed={selectedIds.has(item.id)}
									onpointerdown={(event) => event.stopPropagation()}
									onclick={() => seekAndSelect(item)}
									data-color-mini-clip={item.id}
								></button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div
			class="pointer-events-none absolute top-[14px] right-0 bottom-0"
			style={`left:${LABEL_WIDTH}px`}
		>
			{#each timelineStore.markers as marker, index (marker.id)}
				<button
					type="button"
					class="pointer-events-auto absolute top-0 z-20 h-11 w-11 -translate-x-1/2"
					style={`left:${frameRatio(marker.frame) * 100}%`}
					aria-label={marker.label || m.video_editor_marker_number({ number: index + 1 })}
					onpointerdown={(event) => event.stopPropagation()}
					onclick={() => seekMarker(marker)}
					data-color-timeline-marker={marker.id}
				>
					<span
						class="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[1px] border border-black/70"
						style={`background:${marker.color}`}
					></span>
					<span
						class="absolute top-1.5 bottom-0 left-1/2 w-px -translate-x-1/2 opacity-65"
						style={`background:${marker.color}`}
					></span>
				</button>
			{/each}
			<div
				class="pointer-events-auto absolute top-0 bottom-0 z-30 w-11 -translate-x-1/2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
				style={`left:${frameRatio(displayFrame) * 100}%`}
				role="slider"
				tabindex="0"
				aria-label={m.video_editor_playhead()}
				aria-valuemin="0"
				aria-valuemax={maxFrame}
				aria-valuenow={Math.min(maxFrame, Math.max(0, displayFrame))}
				aria-valuetext={formatTimelinePreviewTimecode(displayFrame, timelineStore.fps)}
				aria-disabled={timelineStore.seekLocked}
				onkeydown={onTimelineKeydown}
				data-color-timeline-playhead
			>
				<span
					class="absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2 bg-orange-300 shadow-[0_0_5px_oklch(0.8_0.13_65_/_0.8)]"
				></span>
				<span
					class="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] border border-black/70 bg-orange-300"
				></span>
			</div>
		</div>
	</div>
</section>
