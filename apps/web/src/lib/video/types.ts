import type { components } from '$lib/api/types';

export type VideoConstraint = components['schemas']['MediaConstraint'];

export type VideoPreparationStage =
	| 'inspecting'
	| 'remuxing'
	| 'compressing'
	| 'uploading'
	| 'finalizing'
	| 'processing';

export interface VideoPreparationProgress {
	stage: VideoPreparationStage;
	fraction: number;
	message: string;
}

export interface VideoMetadata {
	sizeBytes: number;
	mimeType: string;
	durationSeconds: number;
	width: number;
	height: number;
	videoCodec: string | null;
	audioCodec: string | null;
	hasVideoTrack: boolean;
	canDecode: boolean;
}

export interface VideoEditRecipe {
	version: 1;
	trim: {
		startSeconds: number;
		endSeconds: number;
	};
	crop: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
}

export interface PreparedVideo {
	file: File;
	metadata: VideoMetadata;
	changed: boolean;
	operation: 'original' | 'remuxed' | 'transcoded' | 'edited';
}

export class VideoPreparationError extends Error {
	code:
		| 'no-video-track'
		| 'cannot-decode'
		| 'too-long'
		| 'encoder-unavailable'
		| 'cannot-fit'
		| 'invalid-edit';

	constructor(code: VideoPreparationError['code'], message: string) {
		super(message);
		this.name = 'VideoPreparationError';
		this.code = code;
	}
}
