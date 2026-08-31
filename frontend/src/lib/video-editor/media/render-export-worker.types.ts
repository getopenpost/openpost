import type { Project } from '../project/types';
import type { MediaMetadata } from './types';
import type {
	AudioExportOptions,
	RenderedExportArtifact,
	RenderExportOptions,
	RenderExportProgress
} from './render-export';
import type { ImageSequenceExportOptions } from './image-sequence-export';

export type WorkerVideoExportOptions = Omit<RenderExportOptions, 'signal' | 'onProgress'>;
export type WorkerAudioExportOptions = Omit<AudioExportOptions, 'signal' | 'onProgress'>;
export type WorkerImageSequenceExportOptions = Omit<
	ImageSequenceExportOptions,
	'signal' | 'onProgress'
>;

interface WorkerRenderStartBase {
	type: 'start';
	requestId: string;
	project: Project;
	media: MediaMetadata[];
	workspaceRoot: FileSystemDirectoryHandle;
}

export interface WorkerVideoRenderStart extends WorkerRenderStartBase {
	mode: 'video';
	options: WorkerVideoExportOptions;
}

export interface WorkerAudioRenderStart extends WorkerRenderStartBase {
	mode: 'audio';
	options: WorkerAudioExportOptions;
}

export interface WorkerImageSequenceRenderStart extends WorkerRenderStartBase {
	mode: 'image-sequence';
	options: WorkerImageSequenceExportOptions;
}

export interface WorkerRenderCancel {
	type: 'cancel';
	requestId: string;
}

export interface WorkerSequenceBatchAck {
	type: 'sequence-batch-ack';
	requestId: string;
	batchId: number;
}

export type RenderExportWorkerRequest =
	| WorkerVideoRenderStart
	| WorkerAudioRenderStart
	| WorkerImageSequenceRenderStart
	| WorkerRenderCancel
	| WorkerSequenceBatchAck;

export interface WorkerSequenceBatchFrame {
	index: number;
	frameNumber: number;
	fileName: string;
	blob: Blob;
}

export type RenderExportWorkerResponse =
	| {
			type: 'progress';
			requestId: string;
			progress: RenderExportProgress;
	  }
	| {
			type: 'sequence-batch';
			requestId: string;
			batchId: number;
			frames: WorkerSequenceBatchFrame[];
	  }
	| {
			type: 'complete';
			requestId: string;
			artifact: RenderedExportArtifact;
	  }
	| {
			type: 'sequence-complete';
			requestId: string;
			frameCount: number;
			totalBytes: number;
	  }
	| {
			type: 'cancelled';
			requestId: string;
	  }
	| {
			type: 'error';
			requestId: string;
			error: string;
	  };
