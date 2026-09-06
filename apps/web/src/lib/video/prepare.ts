import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	type ConversionVideoOptions
} from 'mediabunny';
import { effectiveVideoConstraints, formatBytes, isCanonicalPlatformVideo } from './constraints';
import { firstPlatformVideoCodec } from './support';
import { createStreamingOutputTarget } from './stream-target';
import type {
	PreparedVideo,
	VideoConstraint,
	VideoMetadata,
	VideoPreparationProgress
} from './types';
import { VideoPreparationError } from './types';

const AUDIO_BITRATE = 128_000;
const MIN_VIDEO_BITRATE = 300_000;
const MAX_VIDEO_BITRATE = 12_000_000;
const MAX_DIMENSION = 1920;
const MIN_DIMENSION = 480;
const SIZE_HEADROOM = 0.88;
const MAX_ATTEMPTS = 3;

interface FittedVideoDimensions {
	width: number;
	height: number;
}

export async function prepareVideoForUpload(
	file: File,
	constraints: VideoConstraint[],
	onProgress: (progress: VideoPreparationProgress) => void = () => {},
	signal?: AbortSignal
): Promise<PreparedVideo> {
	assertNotAborted(signal);
	onProgress({ stage: 'inspecting', fraction: 0.02, message: 'Checking video' });
	const metadata = await probeVideo(file, signal);
	const effective = effectiveVideoConstraints(constraints);

	if (!metadata.hasVideoTrack) {
		throw new VideoPreparationError('no-video-track', 'That file does not contain a video track.');
	}
	if (!metadata.canDecode) {
		throw new VideoPreparationError(
			'cannot-decode',
			'This browser cannot read that video. Try an MP4 file encoded with H.264.'
		);
	}
	if (metadata.durationSeconds > effective.maxDurationSeconds) {
		throw new VideoPreparationError(
			'too-long',
			`This video is ${formatDuration(metadata.durationSeconds)}. The selected accounts allow ${formatDuration(effective.maxDurationSeconds)}. Trim it before uploading.`
		);
	}

	if (isCanonicalPlatformVideo(metadata) && file.size <= effective.maxBytes) {
		onProgress({ stage: 'inspecting', fraction: 1, message: 'Video is ready' });
		return { file, metadata, changed: false, operation: 'original' };
	}

	if (
		metadata.videoCodec === 'avc' &&
		(metadata.audioCodec === null || metadata.audioCodec === 'aac') &&
		file.size <= effective.maxBytes
	) {
		const remuxed = await remuxToMP4(
			file,
			(fraction) => {
				onProgress({
					stage: 'remuxing',
					fraction: 0.08 + fraction * 0.92,
					message: 'Preparing MP4'
				});
			},
			signal
		);
		if (remuxed) {
			const preparedFile = toMP4File(remuxed, file.name);
			const preparedMetadata = await probeVideo(preparedFile, signal);
			if (isCanonicalPlatformVideo(preparedMetadata)) {
				return {
					file: preparedFile,
					metadata: preparedMetadata,
					changed: true,
					operation: 'remuxed'
				};
			}
		}
	}

	const encoded = await compressVideo(
		file,
		metadata,
		effective.maxBytes,
		(fraction) => {
			onProgress({
				stage: 'compressing',
				fraction: 0.08 + fraction * 0.92,
				message: file.size > effective.maxBytes ? 'Compressing video' : 'Converting video'
			});
		},
		signal
	);
	if (!encoded) {
		const message =
			file.size > effective.maxBytes
				? `This browser could not reduce the video below ${formatBytes(effective.maxBytes)}.`
				: 'This browser cannot create the H.264 MP4 required by the selected accounts.';
		throw new VideoPreparationError(
			file.size > effective.maxBytes ? 'cannot-fit' : 'encoder-unavailable',
			`${message} Try Chrome or Edge, or convert the file to H.264 MP4 first.`
		);
	}

	const preparedFile = toMP4File(encoded, file.name);
	return {
		file: preparedFile,
		metadata: {
			...metadata,
			mimeType: 'video/mp4',
			videoCodec: 'avc',
			audioCodec: metadata.audioCodec === null ? null : 'aac',
			sizeBytes: preparedFile.size
		},
		changed: true,
		operation: 'transcoded'
	};
}

export async function probeVideo(file: File, signal?: AbortSignal): Promise<VideoMetadata> {
	const input = new Input({
		formats: ALL_FORMATS,
		source: new BlobSource(file)
	});
	const abort = () => {
		if (!input.disposed) input.dispose();
	};
	signal?.addEventListener('abort', abort, { once: true });
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) {
			return {
				sizeBytes: file.size,
				mimeType: normalizedVideoMIME(file),
				durationSeconds: 0,
				width: 0,
				height: 0,
				videoCodec: null,
				audioCodec: null,
				hasVideoTrack: false,
				canDecode: false
			};
		}
		const [canDecode, videoCodec, width, height, audioTrack, duration] = await Promise.all([
			videoTrack.canDecode(),
			videoTrack.getCodec(),
			videoTrack.getDisplayWidth(),
			videoTrack.getDisplayHeight(),
			input.getPrimaryAudioTrack(),
			input.computeDuration()
		]);
		const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
		return {
			sizeBytes: file.size,
			mimeType: normalizedVideoMIME(file),
			durationSeconds: Math.max(0.001, duration),
			width,
			height,
			videoCodec,
			audioCodec,
			hasVideoTrack: true,
			canDecode
		};
	} finally {
		signal?.removeEventListener('abort', abort);
		if (!input.disposed) input.dispose();
	}
}

async function remuxToMP4(
	file: File,
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<Blob | null> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const stream = await createStreamingOutputTarget(signal);
		let completed = false;
		try {
			const output = new Output({ format: new Mp4OutputFormat(), target: stream.target });
			const conversion = await Conversion.init({ input, output });
			if (!conversion.isValid) return null;
			conversion.onProgress = onProgress;
			const abort = () => void conversion.cancel();
			signal?.addEventListener('abort', abort, { once: true });
			try {
				await conversion.execute();
			} finally {
				signal?.removeEventListener('abort', abort);
			}
			const file = await stream.file(`remuxed-${crypto.randomUUID()}.mp4`, 'video/mp4');
			completed = true;
			return file;
		} finally {
			if (!completed) await stream.discard();
		}
	} finally {
		if (!input.disposed) input.dispose();
	}
}

async function compressVideo(
	source: Blob,
	metadata: VideoMetadata,
	maxBytes: number,
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<Blob | null> {
	let dimensions = fitDimensions(metadata.width, metadata.height, MAX_DIMENSION);
	let videoBitrate = targetVideoBitrate(metadata.durationSeconds, maxBytes);
	let floor = 0;

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		assertNotAborted(signal);
		const codec = await firstPlatformVideoCodec(dimensions.width, dimensions.height);
		if (!codec) return null;

		const base = floor;
		const span = (1 - base) * 0.9;
		floor = base + span;
		const encoded = await encodeOnce(
			source,
			{
				codec,
				width: dimensions.width,
				height: dimensions.height,
				videoBitrate
			},
			(fraction) => onProgress(base + fraction * span),
			signal
		);
		if (!encoded) return null;
		if (encoded.size <= maxBytes) return encoded;

		videoBitrate = Math.max(
			MIN_VIDEO_BITRATE,
			Math.floor(videoBitrate * (maxBytes / encoded.size) * 0.88)
		);
		const next = fitDimensions(
			dimensions.width,
			dimensions.height,
			Math.max(MIN_DIMENSION, Math.floor(Math.max(dimensions.width, dimensions.height) * 0.8))
		);
		if (
			next.width === dimensions.width ||
			next.height === dimensions.height ||
			Math.max(next.width, next.height) < MIN_DIMENSION
		) {
			return null;
		}
		dimensions = next;
	}
	return null;
}

async function encodeOnce(
	source: Blob,
	params: { codec: 'avc'; width: number; height: number; videoBitrate: number },
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<Blob | null> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
	try {
		const sourceAudioTrack = await input.getPrimaryAudioTrack();
		const stream = await createStreamingOutputTarget(signal);
		let completed = false;
		try {
			const output = new Output({ format: new Mp4OutputFormat(), target: stream.target });
			const video: ConversionVideoOptions = {
				codec: params.codec,
				bitrate: params.videoBitrate,
				width: params.width,
				height: params.height,
				fit: 'contain',
				forceTranscode: true
			};
			const conversion = await Conversion.init({
				input,
				output,
				video,
				audio: { codec: 'aac', bitrate: AUDIO_BITRATE, forceTranscode: true }
			});
			if (
				!conversion.isValid ||
				(sourceAudioTrack !== null && !conversion.utilizedTracks.includes(sourceAudioTrack))
			) {
				return null;
			}
			conversion.onProgress = onProgress;
			const abort = () => void conversion.cancel();
			signal?.addEventListener('abort', abort, { once: true });
			try {
				await conversion.execute();
			} finally {
				signal?.removeEventListener('abort', abort);
			}
			const file = await stream.file(`prepared-${crypto.randomUUID()}.mp4`, 'video/mp4');
			completed = true;
			return file;
		} finally {
			if (!completed) await stream.discard();
		}
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function fitDimensions(width: number, height: number, longestEdge: number): FittedVideoDimensions {
	const longest = Math.max(width, height);
	const scale = longest > longestEdge ? longestEdge / longest : 1;
	return {
		width: toEven(width * scale),
		height: toEven(height * scale)
	};
}

function targetVideoBitrate(durationSeconds: number, maxBytes: number): number {
	const usableBits = maxBytes * 8 * SIZE_HEADROOM;
	return Math.min(
		MAX_VIDEO_BITRATE,
		Math.max(
			MIN_VIDEO_BITRATE,
			Math.floor(usableBits / Math.max(1, durationSeconds)) - AUDIO_BITRATE
		)
	);
}

function toEven(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function toMP4File(blob: Blob, originalName: string): File {
	const base = originalName.replace(/\.[^./\\]+$/, '');
	return new File([blob], `${base}.mp4`, { type: 'video/mp4', lastModified: Date.now() });
}

function normalizedVideoMIME(file: File): string {
	if (/\.mp4$/i.test(file.name)) return 'video/mp4';
	return file.type || 'application/octet-stream';
}

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds)) return 'the platform limit';
	const total = Math.ceil(seconds);
	const minutes = Math.floor(total / 60);
	const remainder = total % 60;
	return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}
