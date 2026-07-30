import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	Input,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	type ConversionVideoOptions,
	type InputAudioTrack
} from 'mediabunny';
import { firstPlatformVideoCodec } from './support';
import { createStreamingOutputTarget } from './stream-target';
import type { VideoEditRecipe } from './types';
import { VideoPreparationError } from './types';

export async function renderVideoEdit(
	source: File,
	recipe: VideoEditRecipe,
	onProgress: (fraction: number) => void,
	signal?: AbortSignal
): Promise<File> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(source) });
	try {
		const sourceAudioTrack = await input.getPrimaryAudioTrack();
		const sourceAudioCodec = await sourceAudioTrack?.getCodec();
		const canCopyAAC = sourceAudioTrack !== null && sourceAudioCodec === 'aac';
		const video: ConversionVideoOptions = {};
		if (recipe.crop) {
			const width = even(recipe.crop.width);
			const height = even(recipe.crop.height);
			const codec = await firstPlatformVideoCodec(width, height);
			if (!codec) {
				throw new VideoPreparationError(
					'encoder-unavailable',
					'Cropping is not available in this browser because it cannot encode H.264 video.'
				);
			}
			video.codec = codec;
			video.bitrate = QUALITY_HIGH;
			video.crop = {
				left: Math.round(recipe.crop.x),
				top: Math.round(recipe.crop.y),
				width,
				height
			};
		}
		const stream = await createStreamingOutputTarget(signal);
		let completed = false;
		try {
			const output = new Output({ format: new Mp4OutputFormat(), target: stream.target });
			const conversion = await Conversion.init({
				input,
				output,
				composable: true,
				trim: {
					start: recipe.trim.startSeconds,
					end: recipe.trim.endSeconds
				},
				video,
				audio: canCopyAAC
					? { discard: true }
					: sourceAudioTrack
						? { codec: 'aac', bitrate: 128_000, forceTranscode: true }
						: { discard: true }
			});
			const videoIncluded = conversion.utilizedTracks.some((track) => track.type === 'video');
			const encodedAudioIncluded =
				sourceAudioTrack !== null && conversion.utilizedTracks.includes(sourceAudioTrack);
			if (!videoIncluded || (sourceAudioTrack !== null && !canCopyAAC && !encodedAudioIncluded)) {
				throw new VideoPreparationError(
					'invalid-edit',
					sourceAudioTrack
						? 'This browser cannot preserve the audio in a platform-ready MP4. Upload the original or use a browser with AAC encoding support.'
						: 'This video cannot be edited in this browser.'
				);
			}
			const copiedAudioSource = canCopyAAC ? new EncodedAudioPacketSource('aac') : null;
			if (copiedAudioSource) output.addAudioTrack(copiedAudioSource);
			conversion.onProgress = onProgress;
			const abort = () => {
				void conversion.cancel();
				void output.cancel();
			};
			signal?.addEventListener('abort', abort, { once: true });
			try {
				await output.start();
				await Promise.all([
					conversion.execute(),
					copiedAudioSource && sourceAudioTrack
						? copyAACAudio(
								sourceAudioTrack,
								copiedAudioSource,
								recipe.trim.startSeconds,
								recipe.trim.endSeconds,
								signal
							)
						: Promise.resolve()
				]);
				await output.finalize();
			} finally {
				signal?.removeEventListener('abort', abort);
			}
			const base = source.name.replace(/\.[^./\\]+$/, '');
			const rendered = await stream.file(`${base}-edited.mp4`, 'video/mp4');
			if (sourceAudioTrack && (await audioCodec(rendered)) !== 'aac') {
				throw new VideoPreparationError(
					'invalid-edit',
					'This browser could not preserve the video audio as AAC. The original file was not changed.'
				);
			}
			completed = true;
			return rendered;
		} finally {
			if (!completed) await stream.discard();
		}
	} finally {
		if (!input.disposed) input.dispose();
	}
}

async function copyAACAudio(
	track: InputAudioTrack,
	source: EncodedAudioPacketSource,
	trimStart: number,
	trimEnd: number,
	signal?: AbortSignal
): Promise<void> {
	const sink = new EncodedPacketSink(track);
	const before = await sink.getPacket(trimStart);
	const after = before ? await sink.getNextPacket(before) : await sink.getFirstPacket();
	let first = closestPacket(trimStart, before, after);
	const decoderConfig = await track.getDecoderConfig();
	const duration = Math.max(0, trimEnd - trimStart);
	let firstOutputPacket = true;
	try {
		if (!first) return;
		const timestampBase = first.timestamp;
		for await (const packet of sink.packets(first)) {
			assertNotAborted(signal);
			const timestamp = Math.max(0, packet.timestamp - timestampBase);
			if (timestamp >= duration) break;
			await source.add(packet.clone({ timestamp }), {
				decoderConfig: firstOutputPacket ? (decoderConfig ?? undefined) : undefined
			});
			firstOutputPacket = false;
			first = null;
		}
	} finally {
		source.close();
	}
}

function closestPacket<T extends { timestamp: number }>(
	target: number,
	before: T | null,
	after: T | null
): T | null {
	if (!before) return after;
	if (!after) return before;
	return Math.abs(target - before.timestamp) <= Math.abs(after.timestamp - target) ? before : after;
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

async function audioCodec(file: File): Promise<string | null> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const track = await input.getPrimaryAudioTrack();
		return track ? await track.getCodec() : null;
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function even(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}
