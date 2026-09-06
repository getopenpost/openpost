export interface Beat {
	readonly time: number;
	readonly strength: number;
	readonly index: number;
}

export interface BeatAnalysisResult {
	readonly bpm: number;
	readonly confidence: number;
	readonly beats: Beat[];
	readonly duration: number;
	readonly downbeats: number[];
}

export interface BeatDetectionConfig {
	readonly minBpm: number;
	readonly maxBpm: number;
	readonly sensitivity: number;
	readonly windowSize: number;
	readonly hopSize: number;
}

export const DEFAULT_BEAT_CONFIG: BeatDetectionConfig = {
	minBpm: 60,
	maxBpm: 200,
	sensitivity: 0.5,
	windowSize: 2048,
	hopSize: 512
} as const;

export const BEAT_MARKER_COLOR = '#38bdf8';
export const DOWNBEAT_MARKER_COLOR = '#f59e0b';
