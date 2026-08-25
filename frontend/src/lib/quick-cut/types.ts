export type CutMode = 'nearestKeyframe' | 'exact';
export type LoopMode = 'off' | 'segment' | 'all';

export interface QuickCutSegment {
	id: string;
	start: number;
	end: number;
	name?: string;
	enabled?: boolean;
}

export interface QuickCutProject {
	version: 1;
	id: string;
	name: string;
	sourceFileName: string;
	sourceFileSize?: number;
	sourceMimeType?: string;
	duration: number;
	segments: QuickCutSegment[];
	cutMode: CutMode;
	merge: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface SegmentValidationError {
	segmentId: string;
	kind:
		| 'start_negative'
		| 'end_beyond_duration'
		| 'end_not_after_start'
		| 'zero_length'
		| 'overlap'
		| 'invalid_time';
	message: string;
}

export interface QuickCutExportChoice {
	wasLossless: boolean;
	reason: string;
	requiresTranscode: boolean;
}

export interface KeyframeStatus {
	aligned: boolean;
	nearestKeyframe: number | null;
	distance: number | null;
}
