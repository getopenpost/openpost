import {
	ALL_FORMATS,
	BlobSource,
	StreamTarget,
	Conversion,
	Input,
	Output,
	Mp4OutputFormat,
	MkvOutputFormat,
	WebMOutputFormat,
	MovOutputFormat,
	Mp3OutputFormat,
	WavOutputFormat,
	OggOutputFormat,
	FlacOutputFormat,
	canEncodeAudio,
	canEncodeVideo,
	Quality,
	type AudioCodec,
	type VideoCodec,
	type ConversionVideoOptions,
	type ConversionAudioOptions,
	type OutputFormat
} from 'mediabunny';
import type { MediaOutputFormat } from '@openpost/social-images';

export const MEDIA_MAX_BYTES = 250 * 1024 * 1024;
const OUTPUT_MAX_BYTES = 500 * 1024 * 1024;
export type VideoChoice = 'auto' | 'copy' | VideoCodec;
export type AudioChoice = 'auto' | 'copy' | 'mute' | AudioCodec;
export interface MediaSettings {
	format: MediaOutputFormat;
	audioOnly: boolean;
	videoCodec: VideoChoice;
	audioCodec: AudioChoice;
	videoBitrate: number;
	audioBitrate: number;
	height?: number;
	compress: boolean;
}
export interface MediaInfo {
	format: string;
	duration: number;
	tracks: { type: string; codec: string; detail: string }[];
}

export function mediaOutputFormat(format: MediaOutputFormat): OutputFormat {
	switch (format) {
		case 'mp4':
			return new Mp4OutputFormat({ fastStart: false });
		case 'm4a':
			return new Mp4OutputFormat({ fastStart: false });
		case 'mkv':
			return new MkvOutputFormat();
		case 'webm':
			return new WebMOutputFormat();
		case 'mov':
			return new MovOutputFormat();
		case 'mp3':
			return new Mp3OutputFormat();
		case 'wav':
			return new WavOutputFormat();
		case 'ogg':
			return new OggOutputFormat();
		case 'flac':
			return new FlacOutputFormat();
	}
}

export function openLocalMedia(file: File): Input {
	if (!file.size) throw new Error('This file is empty. Choose a video or audio file.');
	if (file.size > MEDIA_MAX_BYTES) throw new Error('Choose a file smaller than 250 MB.');
	return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

export async function inspectLocalMedia(input: Input): Promise<MediaInfo> {
	const tracks = await input.getTracks();
	if (!tracks.length) throw new Error('No readable media tracks were found. Choose another file.');
	const format = await input.getFormat();
	const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
	const details = await Promise.all(
		tracks.map(async (track) => {
			let detail = '';
			if (track.isVideoTrack()) detail = `${track.displayWidth} × ${track.displayHeight} px`;
			if (track.isAudioTrack())
				detail = `${track.numberOfChannels} ${track.numberOfChannels === 1 ? 'channel' : 'channels'} · ${track.sampleRate} Hz`;
			return { type: track.type, codec: track.codec ?? 'Unknown', detail };
		})
	);
	const names = new Map([
		['Matroska', 'MKV'],
		['QuickTime File Format', 'MOV'],
		['WAVE', 'WAV']
	]);
	return { format: names.get(format.name) ?? format.name, duration, tracks: details };
}

export async function inspectConvertedMedia(blob: Blob): Promise<MediaInfo> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		return await inspectLocalMedia(input);
	} finally {
		input.dispose();
	}
}

let audioExtensions: Promise<void> | undefined;
async function prepareAudioEncoders(): Promise<void> {
	audioExtensions ??= (async () => {
		if (!(await canEncodeAudio('mp3'))) {
			const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
			registerMp3Encoder();
		}
		if (!(await canEncodeAudio('aac'))) {
			const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
			registerAacEncoder();
		}
	})().catch((error) => {
		audioExtensions = undefined;
		throw error;
	});
	return audioExtensions;
}

export async function mediaCodecOptions(format: MediaOutputFormat) {
	await prepareAudioEncoders();
	const output = mediaOutputFormat(format);
	const video = await Promise.all(
		output
			.getSupportedVideoCodecs()
			.map(async (codec) => ((await canEncodeVideo(codec)) ? codec : null))
	);
	const audio = await Promise.all(
		output
			.getSupportedAudioCodecs()
			.map(async (codec) => ((await canEncodeAudio(codec)) ? codec : null))
	);
	return {
		video: video.filter((codec): codec is VideoCodec => codec !== null),
		audio: audio.filter((codec): codec is AudioCodec => codec !== null)
	};
}

// The primary tracks are explicit in the UI. Reject failed tracks so a download
// cannot silently lose its soundtrack when a decoder or encoder is unavailable.
export async function convertLocalMedia(
	input: Input,
	settings: MediaSettings,
	signal: AbortSignal,
	onProgress: (progress: number) => void
): Promise<Blob> {
	await prepareAudioEncoders();
	signal.throwIfAborted();
	const video = await input.getPrimaryVideoTrack();
	const audio = await input.getPrimaryAudioTrack();
	if (settings.audioOnly && !audio) throw new Error('This file has no audio track to convert.');
	if (!settings.audioOnly && !video)
		throw new Error('This file has no video track. Use the audio converter instead.');
	const format = mediaOutputFormat(settings.format);
	let result = new Blob([]);
	const target = new StreamTarget(
		new WritableStream({
			write({ data, position }) {
				const end = position + data.byteLength;
				if (end > OUTPUT_MAX_BYTES)
					throw new Error(
						'The output exceeds 500 MB. Choose a compressed format or a shorter source.'
					);
				// Container headers can be backpatched. Blob slices keep these writes
				// bounded without repeatedly copying a growing ArrayBuffer.
				const gap = Math.max(0, position - result.size);
				result = new Blob([
					result.slice(0, position),
					new Uint8Array(gap),
					data,
					result.slice(end)
				]);
			}
		}),
		{ chunked: true, chunkSize: 1024 * 1024 }
	);
	const output = new Output({ format, target });
	let conversion: Conversion | undefined;
	const cancel = () => {
		void conversion?.cancel().catch(() => {});
	};
	signal.addEventListener('abort', cancel, { once: true });
	try {
		const copyVideo = settings.videoCodec === 'copy';
		const copyAudio = settings.audioCodec === 'copy';
		if (
			!settings.audioOnly &&
			copyVideo &&
			(!video?.codec || !format.getSupportedVideoCodecs().includes(video.codec))
		)
			throw new Error(
				'This container cannot keep the source video codec. Choose Automatic or another codec.'
			);
		if (
			audio &&
			copyAudio &&
			(!audio.codec || !format.getSupportedAudioCodecs().includes(audio.codec))
		)
			throw new Error(
				'This container cannot keep the source audio codec. Choose Automatic or another codec.'
			);
		const videoCodec =
			settings.videoCodec === 'copy'
				? (video?.codec ?? undefined)
				: settings.videoCodec === 'auto'
					? undefined
					: settings.videoCodec;
		const audioCodec =
			settings.audioCodec === 'copy'
				? (audio?.codec ?? undefined)
				: settings.audioCodec === 'auto' || settings.audioCodec === 'mute'
					? undefined
					: settings.audioCodec;
		const videoOptions: ConversionVideoOptions = { discard: settings.audioOnly };
		if (!settings.audioOnly) {
			videoOptions.codec = videoCodec;
			videoOptions.forceTranscode =
				settings.compress || !['auto', 'copy'].includes(settings.videoCodec);
			if (videoOptions.forceTranscode)
				videoOptions.quality = new Quality({ bitrate: settings.videoBitrate });
			if (settings.height && video && settings.height < video.displayHeight)
				videoOptions.height = settings.height;
		}
		const audioOptions: ConversionAudioOptions = { discard: settings.audioCodec === 'mute' };
		if (!audioOptions.discard) {
			audioOptions.codec = audioCodec;
			audioOptions.forceTranscode = !['auto', 'copy'].includes(settings.audioCodec);
			if (audioUsesBitrate(settings.audioCodec))
				audioOptions.quality = new Quality({ bitrate: settings.audioBitrate });
		}
		conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			showWarnings: false,
			video: videoOptions,
			audio: audioOptions
		});
		signal.throwIfAborted();
		const failed = conversion.discardedTracks.filter(
			(track) => track.reason !== 'discarded_by_user'
		);
		if (!conversion.isValid || failed.length) {
			const types = [...new Set(failed.map(({ track }) => track.type))].join(' and ') || 'media';
			throw new Error(
				`This browser cannot convert the selected ${types} tracks with these settings. Try keeping the source codec, another output format, or a current Chrome or Edge browser.`
			);
		}
		conversion.onProgress = (progress) => onProgress(Math.min(1, Math.max(0, progress)));
		await conversion.execute();
		signal.throwIfAborted();
		if (!result.size) throw new Error('No output was created. Try another format.');
		return new Blob([result], {
			type: settings.format === 'm4a' ? 'audio/mp4' : format.mimeType
		});
	} finally {
		signal.removeEventListener('abort', cancel);
		if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
	}
}

export function audioUsesBitrate(codec: AudioChoice): boolean {
	return !['auto', 'copy', 'mute', 'flac'].includes(codec) && !codec.startsWith('pcm');
}
const codecLabels = new Map([
	['avc', 'H.264 / AVC'],
	['hevc', 'H.265 / HEVC'],
	['vp8', 'VP8'],
	['vp9', 'VP9'],
	['av1', 'AV1'],
	['aac', 'AAC'],
	['opus', 'Opus'],
	['mp3', 'MP3'],
	['flac', 'FLAC'],
	['vorbis', 'Vorbis'],
	['pcm-s16', 'PCM, 16-bit']
]);
export function mediaCodecLabel(codec: string): string {
	return codecLabels.get(codec) ?? codec;
}
export function mediaBytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
