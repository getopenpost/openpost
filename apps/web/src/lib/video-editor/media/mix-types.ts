import type { AudioDuckingSettings } from '../audio/audio-ducking';
import type { AudioEffect } from '../audio/audio-effects';
import type { TransitionGainSpan } from '../audio/transition-crossfade';
import type { ResolvedAudioEqSettings, ResolvedAudioNoiseReductionSettings } from '../audio/types';

export interface GainPoint {
	whenSeconds: number;
	value: number;
}

/** One scheduled clip in the offline audio mixdown. */
export interface MixEntry {
	toneFrequency?: number;
	ducking?: AudioDuckingSettings;
	duckStartSeconds?: number;
	duckEndSeconds?: number;
	duckTrackAliases?: string[];
	itemId: string;
	mediaId: string;
	/** Root mixer track used by preview channel strips. */
	trackId?: string;
	/** Timeline seconds where playback starts in the mixdown. */
	whenSeconds: number;
	/** Seconds into the source media where this clip begins. */
	sourceOffsetSeconds: number;
	/** Maximum source-time remainder introduced by rounding a clip to timeline frames. */
	sourceFrameDuration?: number;
	/** Source seconds played per real second (the item's speed). */
	playbackRate: number;
	/** Output-relative tempo samples for a persisted variable-speed curve. */
	playbackRateCurve?: Array<{ atSeconds: number; rate: number }>;
	/** Exact source window consumed by a variable-speed entry. */
	sourceWindowStartSeconds?: number;
	sourceWindowEndSeconds?: number;
	/** Independent pitch offset. Tempo remains owned by playbackRate. */
	pitchShiftSemitones: number;
	/** Ordered outer-to-inner parametric EQ stages. */
	audioEqStages: ResolvedAudioEqSettings[];
	/** Ordered audio effect rack shared by preview and export. */
	audioEffects: AudioEffect[];
	/** Per-clip noise reduction applied before time-stretch and EQ. */
	noiseReduction?: ResolvedAudioNoiseReductionSettings;
	/** Read the source window backward while keeping timeline time forward. */
	reversed: boolean;
	/** Real seconds this clip occupies in the mixdown. */
	durationSeconds: number;
	gainPoints: GainPoint[];
	/** Preview automation before the current root track fader. */
	previewGainPoints: GainPoint[];
	/** Current root track fader baked into gainPoints for export. */
	mixerTrackGain: number;
	transitionGainSpans: TransitionGainSpan[];
}
