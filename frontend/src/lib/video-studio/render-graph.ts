import {
	derivePrimarySequence,
	interpolateKeyframes,
	isPrimarySequenceClip,
	type CaptionCue,
	type CaptionStyle,
	type PrimarySequenceClip,
	type Transition,
	type VariantID,
	type VideoEffect,
	type VideoPresentation,
	type VideoProjectDocumentV1,
	type VisualTrackItem
} from '@openpost/video-project';

export interface EvaluatedPrimaryLayer {
	type: 'primary';
	clip_id: string;
	source_id: string;
	source_time_us: number;
	presentation: VideoPresentation;
	effects: VideoEffect[];
	opacity: number;
	transition?: {
		type: Transition['type'];
		progress: number;
		role: 'incoming' | 'outgoing';
	};
}

export interface EvaluatedVisualLayer {
	type: 'visual';
	item: VisualTrackItem;
	local_time_us: number;
	presentation: VideoPresentation;
	opacity: number;
}

export interface EvaluatedCaption {
	cue: CaptionCue;
	style: CaptionStyle;
	active_word_index: number;
}

export interface EvaluatedFrame {
	timestamp_us: number;
	variant_id: VariantID;
	width: number;
	height: number;
	background_color: string;
	safe_area: { top: number; right: number; bottom: number; left: number };
	primary_layers: EvaluatedPrimaryLayer[];
	visual_layers: EvaluatedVisualLayer[];
	captions: EvaluatedCaption[];
}

export interface EvaluatedAudioSource {
	item_id: string;
	source_id: string;
	source_time_us: number;
	playback_rate: number;
	gain: number;
	role: 'primary' | 'voice' | 'music' | 'system' | 'effects' | 'other';
}

export interface EvaluatedAudioBlock {
	start_us: number;
	end_us: number;
	sources: EvaluatedAudioSource[];
	ducking_active: boolean;
}

export function evaluateFrame(
	project: VideoProjectDocumentV1,
	variantID: VariantID,
	timestampUS: number
): EvaluatedFrame {
	const variant = project.variants.find((candidate) => candidate.id === variantID);
	if (!variant) throw new Error(`Unknown video variant: ${variantID}`);
	const derived = derivePrimarySequence(project);
	const active = derived.filter(
		(item) =>
			item.kind === 'clip' &&
			timestampUS >= item.timeline_start_us &&
			timestampUS < item.timeline_end_us
	);
	const primaryLayers = active.map((item, activeIndex) => {
		const clip = project.primary_sequence[item.index]!;
		if (!isPrimarySequenceClip(clip)) throw new Error('Primary clip timing is inconsistent.');
		const localUS = timestampUS - item.timeline_start_us;
		const transition = evaluateTransition(project, item.index, localUS, item.duration_us);
		const transitionOpacity =
			transition?.role === 'incoming'
				? transition.progress
				: transition?.role === 'outgoing'
					? 1 - transition.progress
					: 1;
		return {
			type: 'primary' as const,
			clip_id: clip.id,
			source_id: clip.source_id,
			source_time_us:
				clip.mode === 'freeze'
					? clip.source_in_us
					: clip.source_in_us + Math.round(localUS * clip.speed),
			presentation: evaluatePresentation(clip, variantID, localUS),
			effects: structuredClone(clip.effects),
			opacity: transitionOpacity,
			transition:
				transition ??
				(active.length > 1
					? {
							type: 'cross-dissolve' as const,
							progress: activeIndex / Math.max(1, active.length - 1),
							role: activeIndex === 0 ? ('outgoing' as const) : ('incoming' as const)
						}
					: undefined)
		};
	});
	const visualLayers: EvaluatedVisualLayer[] = [];
	for (const track of project.visual_tracks) {
		if (track.hidden) continue;
		for (const item of track.items) {
			const localUS = timestampUS - item.timeline_start_us;
			const override = item.variant_overrides?.[variantID];
			if (localUS < 0 || localUS >= item.duration_us || !(override?.visible ?? item.visible))
				continue;
			const base = item.presentation;
			const presentation = evaluatePresentationValue(
				mergePresentation(base, override?.presentation),
				localUS
			);
			visualLayers.push({
				type: 'visual',
				item,
				local_time_us: localUS,
				presentation,
				opacity: presentation.opacity
			});
		}
	}
	const captions = project.caption_tracks
		.filter((track) => track.visible)
		.flatMap((track) =>
			track.cues
				.filter((cue) => timestampUS >= cue.start_us && timestampUS < cue.end_us)
				.map((cue) => ({
					cue,
					style: { ...track.style, ...(track.variant_overrides?.[variantID] ?? {}) },
					active_word_index: cue.words.findIndex(
						(word) => timestampUS >= word.start_us && timestampUS < word.end_us
					)
				}))
		);
	return {
		timestamp_us: timestampUS,
		variant_id: variantID,
		width: variant.width,
		height: variant.height,
		background_color: variant.background_color,
		safe_area: { ...variant.safe_area },
		primary_layers: primaryLayers,
		visual_layers: visualLayers,
		captions
	};
}

export function evaluateAudio(
	project: VideoProjectDocumentV1,
	startUS: number,
	endUS: number
): EvaluatedAudioBlock {
	const sources: EvaluatedAudioSource[] = [];
	const primary = derivePrimarySequence(project);
	for (const item of primary) {
		if (item.timeline_end_us <= startUS || item.timeline_start_us >= endUS) continue;
		const clip = project.primary_sequence[item.index]!;
		if (!isPrimarySequenceClip(clip)) continue;
		if (clip.audio.muted) continue;
		const localUS = Math.max(0, startUS - item.timeline_start_us);
		sources.push({
			item_id: clip.id,
			source_id: clip.source_id,
			source_time_us: clip.source_in_us + Math.round(localUS * clip.speed),
			playback_rate: clip.speed,
			gain: gainForClip(
				clip.audio.gain_db,
				clip.audio.gain_db_keyframes,
				clip.audio.fade_in_us,
				clip.audio.fade_out_us,
				localUS,
				item.duration_us
			),
			role: 'primary'
		});
	}
	let duckingActive = false;
	for (const track of project.audio_tracks) {
		if (track.muted) continue;
		for (const item of track.items) {
			const itemEnd = item.timeline_start_us + item.duration_us;
			if (itemEnd <= startUS || item.timeline_start_us >= endUS || item.muted) continue;
			const localUS = Math.max(0, startUS - item.timeline_start_us);
			const gain = gainForClip(
				item.gain_db,
				item.gain_db_keyframes,
				item.fade_in_us,
				item.fade_out_us,
				localUS,
				item.duration_us
			);
			sources.push({
				item_id: item.id,
				source_id: item.source_id,
				source_time_us: item.source_in_us + Math.round(localUS * item.speed),
				playback_rate: item.speed,
				gain,
				role: track.role
			});
			duckingActive ||= item.duck_others && gain > 0;
		}
	}
	if (duckingActive) {
		for (const source of sources) {
			if (source.role === 'music' || source.role === 'system') source.gain *= 0.25;
		}
	}
	return { start_us: startUS, end_us: endUS, sources, ducking_active: duckingActive };
}

function evaluatePresentation(
	clip: PrimarySequenceClip,
	variantID: VariantID,
	localUS: number
): VideoPresentation {
	return evaluatePresentationValue(
		mergePresentation(clip.video, clip.variant_overrides?.[variantID]),
		localUS
	);
}

function mergePresentation(
	base: VideoPresentation,
	override: Partial<VideoPresentation> | undefined
): VideoPresentation {
	return {
		...structuredClone(base),
		...(override ?? {}),
		crop: { ...base.crop, ...(override?.crop ?? {}) },
		keyframes: { ...(base.keyframes ?? {}), ...(override?.keyframes ?? {}) }
	};
}

function evaluatePresentationValue(
	presentation: VideoPresentation,
	localUS: number
): VideoPresentation {
	const next = structuredClone(presentation);
	for (const property of ['position_x', 'position_y', 'scale', 'rotation', 'opacity'] as const) {
		const keyframes = presentation.keyframes?.[property];
		if (keyframes?.length) next[property] = interpolateKeyframes(keyframes, localUS);
	}
	for (const [property, cropProperty] of [
		['crop_x', 'x'],
		['crop_y', 'y'],
		['crop_width', 'width'],
		['crop_height', 'height']
	] as const) {
		const keyframes = presentation.keyframes?.[property];
		if (keyframes?.length) next.crop[cropProperty] = interpolateKeyframes(keyframes, localUS);
	}
	return next;
}

function evaluateTransition(
	project: VideoProjectDocumentV1,
	index: number,
	localUS: number,
	durationUS: number
): EvaluatedPrimaryLayer['transition'] {
	const clip = project.primary_sequence[index]!;
	if (!isPrimarySequenceClip(clip)) return undefined;
	const incoming = clip.transition_in;
	if (incoming && localUS < incoming.duration_us) {
		return {
			type: incoming.type,
			progress: clamp01(localUS / incoming.duration_us),
			role: 'incoming'
		};
	}
	const outgoing = clip.transition_out;
	if (outgoing && durationUS - localUS <= outgoing.duration_us) {
		return {
			type: outgoing.type,
			progress: clamp01((localUS - (durationUS - outgoing.duration_us)) / outgoing.duration_us),
			role: 'outgoing'
		};
	}
	return undefined;
}

function gainForClip(
	gainDB: number,
	keyframes: import('@openpost/video-project').NumericKeyframe[] | undefined,
	fadeInUS: number,
	fadeOutUS: number,
	localUS: number,
	durationUS: number
): number {
	const evaluatedGainDB = keyframes?.length ? interpolateKeyframes(keyframes, localUS) : gainDB;
	const base = 10 ** (evaluatedGainDB / 20);
	const fadeIn = fadeInUS > 0 ? clamp01(localUS / fadeInUS) : 1;
	const fadeOut = fadeOutUS > 0 ? clamp01((durationUS - localUS) / fadeOutUS) : 1;
	return base * Math.min(fadeIn, fadeOut);
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}
