import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	Output,
	type AudioCodec,
	type OutputFormat,
	type VideoCodec
} from 'mediabunny';
import { ensureAc3DecoderForCodec } from '$lib/video-editor/media/ac3-decoder';
import { createStreamingOutputTarget, type StreamingOutputTarget } from '$lib/video/stream-target';
import {
	getSelectedAudioStreams,
	getSelectedVideoStream,
	KEYFRAME_TOLERANCE_SECONDS
} from './model';
import { resolveSourceFile } from './source';
import type { QuickCutScratchArtifact, QuickCutSegment, QuickCutSource } from './types';
import { copyContainerMetadata, readTrackMetadata } from './container-metadata';

type LocalExportProgress = (fraction: number, bytesWritten: number) => void;

export class UnsupportedSmartCutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedSmartCutError';
	}
}

export interface SmartCutOptions {
	source: QuickCutSource;
	segment: QuickCutSegment;
	boundary: number;
	createFormat: () => OutputFormat;
	fileName: string;
	mimeType: string;
	signal?: AbortSignal;
	onProgress?: LocalExportProgress;
}

function isSupportedVideoCodec(
	codec: string,
	supported: readonly VideoCodec[]
): codec is VideoCodec {
	return supported.some((candidate) => candidate === codec);
}

function isSupportedAudioCodec(
	codec: string,
	supported: readonly AudioCodec[]
): codec is AudioCodec {
	return supported.some((candidate) => candidate === codec);
}

export function nextSmartCutBoundary(
	segment: Pick<QuickCutSegment, 'start' | 'end'>,
	keyframes: readonly number[]
): number | null {
	let boundary: number | null = null;
	for (const timestamp of keyframes) {
		if (
			timestamp <= segment.start + KEYFRAME_TOLERANCE_SECONDS ||
			timestamp >= segment.end - KEYFRAME_TOLERANCE_SECONDS
		)
			continue;
		if (boundary === null || timestamp < boundary) boundary = timestamp;
	}
	return boundary;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function decoderDimensionsMatch(
	left: VideoDecoderConfig | null,
	right: VideoDecoderConfig | null
): boolean {
	if (!left || !right) return left === right;
	return left.codedWidth === right.codedWidth && left.codedHeight === right.codedHeight;
}

async function executeConversion(
	conversion: Conversion,
	streaming: StreamingOutputTarget,
	signal: AbortSignal | undefined,
	onProgress: ((fraction: number) => void) | undefined
): Promise<void> {
	conversion.onProgress = (fraction) => onProgress?.(Math.min(1, Math.max(0, fraction)));
	const abort = (): void => void conversion.cancel().catch(() => undefined);
	signal?.addEventListener('abort', abort, { once: true });
	try {
		await conversion.execute();
	} catch (error) {
		await streaming.discard().catch(() => undefined);
		throw error;
	} finally {
		signal?.removeEventListener('abort', abort);
	}
}

async function transcodeVideoPrefix(
	options: SmartCutOptions,
	file: File,
	videoCodec: VideoCodec,
	videoIndex: number,
	frameRate: number
): Promise<{ file: File; streaming: StreamingOutputTarget }> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const streaming = await createStreamingOutputTarget(options.signal);
	try {
		const conversion = await Conversion.init({
			input,
			output: new Output({ format: options.createFormat(), target: streaming.target }),
			trim: { start: options.segment.start, end: options.boundary },
			video: (track, trackNumber) => {
				if (trackNumber - 1 !== videoIndex) return { discard: true };
				return { codec: videoCodec, frameRate, forceTranscode: true };
			},
			audio: () => ({ discard: true })
		});
		if (!conversion.isValid) {
			throw new UnsupportedSmartCutError(
				'The boundary GOP cannot be encoded with the source codec.'
			);
		}
		await executeConversion(conversion, streaming, options.signal, (fraction) =>
			options.onProgress?.(fraction * 0.45, streaming.bytesWritten)
		);
		return {
			file: await streaming.file('smart-cut-prefix', options.createFormat().mimeType),
			streaming
		};
	} catch (error) {
		await streaming.discard().catch(() => undefined);
		throw error;
	} finally {
		input.dispose();
	}
}

async function transcodeAudio(
	options: SmartCutOptions,
	file: File,
	audioIndices: ReadonlySet<number>
): Promise<{ file: File; streaming: StreamingOutputTarget }> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const streaming = await createStreamingOutputTarget(options.signal);
	try {
		const conversion = await Conversion.init({
			input,
			output: new Output({ format: options.createFormat(), target: streaming.target }),
			trim: { start: options.segment.start, end: options.segment.end },
			video: () => ({ discard: true }),
			audio: (track, trackNumber) =>
				audioIndices.has(trackNumber - 1) ? { forceTranscode: true } : { discard: true }
		});
		if (!conversion.isValid) {
			throw new UnsupportedSmartCutError('The selected audio tracks cannot be encoded exactly.');
		}
		await executeConversion(conversion, streaming, options.signal, (fraction) =>
			options.onProgress?.(0.45 + fraction * 0.25, streaming.bytesWritten)
		);
		return {
			file: await streaming.file('smart-cut-audio', options.createFormat().mimeType),
			streaming
		};
	} catch (error) {
		await streaming.discard().catch(() => undefined);
		throw error;
	} finally {
		input.dispose();
	}
}

export async function exportSmartCut(options: SmartCutOptions): Promise<QuickCutScratchArtifact> {
	throwIfAborted(options.signal);
	const selectedVideo = getSelectedVideoStream(options.source);
	if (!selectedVideo?.codec || !selectedVideo.fps || selectedVideo.fps <= 0) {
		throw new UnsupportedSmartCutError(
			'Smart Cut needs a selected video track with a known codec and frame rate.'
		);
	}
	const probeFormat = options.createFormat();
	const supportedVideoCodecs = probeFormat.getSupportedVideoCodecs();
	if (!isSupportedVideoCodec(selectedVideo.codec, supportedVideoCodecs)) {
		throw new UnsupportedSmartCutError(
			'The output container cannot stream-copy the source video codec.'
		);
	}
	const videoCodec = selectedVideo.codec;
	const file = await resolveSourceFile(options.source, options.signal);
	const selectedAudios = getSelectedAudioStreams(options.source);
	for (const audio of selectedAudios) await ensureAc3DecoderForCodec(audio.codec);
	const prefixDuration = options.boundary - options.segment.start;
	const totalDuration = options.segment.end - options.segment.start;

	let prefix: Awaited<ReturnType<typeof transcodeVideoPrefix>> | null = null;
	let audio: Awaited<ReturnType<typeof transcodeAudio>> | null = null;
	let originalInput: Input | null = null;
	let prefixInput: Input | null = null;
	let audioInput: Input | null = null;
	const finalStreaming = await createStreamingOutputTarget(options.signal);
	const finalOutput = new Output({ format: options.createFormat(), target: finalStreaming.target });
	let outputStarted = false;
	try {
		prefix = await transcodeVideoPrefix(
			options,
			file,
			videoCodec,
			selectedVideo.index,
			selectedVideo.fps
		);
		if (selectedAudios.length > 0) {
			audio = await transcodeAudio(
				options,
				file,
				new Set(selectedAudios.map((track) => track.index))
			);
		}

		originalInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		prefixInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(prefix.file) });
		const originalVideoTracks = await originalInput.getVideoTracks();
		const originalTrack = originalVideoTracks[selectedVideo.index] ?? null;
		const prefixTrack = await prefixInput.getPrimaryVideoTrack();
		if (!originalTrack || !prefixTrack || (await prefixTrack.getCodec()) !== videoCodec) {
			throw new UnsupportedSmartCutError(
				'The encoded boundary is not compatible with the source video track.'
			);
		}
		const [originalConfig, prefixConfig] = await Promise.all([
			originalTrack.getDecoderConfig(),
			prefixTrack.getDecoderConfig()
		]);
		if (!decoderDimensionsMatch(originalConfig, prefixConfig)) {
			throw new UnsupportedSmartCutError(
				'The browser encoder cannot match the source decoder dimensions.'
			);
		}

		const videoSource = new EncodedVideoPacketSource(videoCodec);
		await copyContainerMetadata(originalInput, finalOutput);
		finalOutput.addVideoTrack(videoSource, {
			...(await readTrackMetadata(originalTrack)),
			frameRate: selectedVideo.fps,
			rotation: originalTrack.rotation
		});
		const audioSources: EncodedAudioPacketSource[] = [];
		let audioTracks: Awaited<ReturnType<Input['getAudioTracks']>> = [];
		if (audio) {
			audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audio.file) });
			audioTracks = await audioInput.getAudioTracks();
			const originalAudioTracks = await originalInput.getAudioTracks();
			if (audioTracks.length !== selectedAudios.length) {
				throw new UnsupportedSmartCutError(
					'The exact audio render changed the selected track count.'
				);
			}
			for (let index = 0; index < audioTracks.length; index++) {
				const track = audioTracks[index]!;
				const codec = await track.getCodec();
				const supportedAudioCodecs = probeFormat.getSupportedAudioCodecs();
				if (!codec || !isSupportedAudioCodec(codec, supportedAudioCodecs)) {
					throw new UnsupportedSmartCutError(
						'The exact audio codec is not supported by the output container.'
					);
				}
				const source = new EncodedAudioPacketSource(codec);
				audioSources.push(source);
				const selectedTrack = selectedAudios[index];
				const originalAudioTrack = selectedTrack
					? originalAudioTracks[selectedTrack.index]
					: undefined;
				finalOutput.addAudioTrack(
					source,
					originalAudioTrack ? await readTrackMetadata(originalAudioTrack) : undefined
				);
			}
		}

		const abort = (): void => {
			if (finalOutput.state === 'started') void finalOutput.cancel();
		};
		options.signal?.addEventListener('abort', abort, { once: true });
		try {
			await finalOutput.start();
			outputStarted = true;
			const prefixSink = new EncodedPacketSink(prefixTrack);
			const prefixFirst = await prefixSink.getFirstPacket();
			if (!prefixFirst)
				throw new UnsupportedSmartCutError('The encoded boundary contains no video packets.');
			let videoSequence = 0;
			let firstVideoPacket = true;
			const fallbackVideoDuration = 1 / selectedVideo.fps;
			for await (const packet of prefixSink.packets(prefixFirst)) {
				throwIfAborted(options.signal);
				const timestamp = packet.timestamp - prefixFirst.timestamp;
				if (timestamp < -KEYFRAME_TOLERANCE_SECONDS || timestamp >= prefixDuration) continue;
				const duration = Math.min(
					packet.duration > 0 ? packet.duration : fallbackVideoDuration,
					Math.max(0, prefixDuration - timestamp)
				);
				if (duration <= 0) continue;
				await videoSource.add(
					packet.clone({
						timestamp: Math.max(0, timestamp),
						duration,
						sequenceNumber: videoSequence++
					}),
					{ decoderConfig: firstVideoPacket ? (prefixConfig ?? undefined) : undefined }
				);
				firstVideoPacket = false;
			}
			if (firstVideoPacket) {
				throw new UnsupportedSmartCutError(
					'The encoded boundary contains no usable video packets.'
				);
			}

			const originalSink = new EncodedPacketSink(originalTrack);
			const tailFirst = await originalSink.getKeyPacket(
				options.boundary + KEYFRAME_TOLERANCE_SECONDS,
				{ verifyKeyPackets: true }
			);
			if (
				!tailFirst ||
				Math.abs(tailFirst.timestamp - options.boundary) > KEYFRAME_TOLERANCE_SECONDS
			) {
				throw new UnsupportedSmartCutError(
					'The planned stream-copy boundary is not an encoded keyframe.'
				);
			}
			const tailLast = await originalSink.getPacket(
				Math.max(tailFirst.timestamp, options.segment.end - Number.EPSILON)
			);
			const afterTail = tailLast ? await originalSink.getNextPacket(tailLast) : undefined;
			let firstTailPacket = true;
			for await (const packet of originalSink.packets(tailFirst, afterTail ?? undefined)) {
				throwIfAborted(options.signal);
				const timestamp = prefixDuration + packet.timestamp - tailFirst.timestamp;
				if (timestamp < prefixDuration - KEYFRAME_TOLERANCE_SECONDS || timestamp >= totalDuration)
					continue;
				const duration = Math.min(
					packet.duration > 0 ? packet.duration : fallbackVideoDuration,
					Math.max(0, totalDuration - timestamp)
				);
				if (duration <= 0) continue;
				await videoSource.add(
					packet.clone({ timestamp, duration, sequenceNumber: videoSequence++ }),
					{
						decoderConfig: firstTailPacket ? (originalConfig ?? undefined) : undefined
					}
				);
				firstTailPacket = false;
				options.onProgress?.(
					0.7 + Math.min(0.2, ((timestamp + duration) / totalDuration) * 0.2),
					finalStreaming.bytesWritten
				);
			}
			if (firstTailPacket) {
				throw new UnsupportedSmartCutError(
					'The stream-copy tail contains no usable video packets.'
				);
			}
			videoSource.close();

			for (let index = 0; index < audioTracks.length; index++) {
				const track = audioTracks[index]!;
				const source = audioSources[index]!;
				const sink = new EncodedPacketSink(track);
				const first = await sink.getFirstPacket();
				if (!first) {
					source.close();
					throw new UnsupportedSmartCutError('The exact audio render contains no packets.');
				}
				const config = await track.getDecoderConfig();
				let sequence = 0;
				let isFirst = true;
				for await (const packet of sink.packets(first)) {
					throwIfAborted(options.signal);
					const timestamp = packet.timestamp - first.timestamp;
					if (timestamp < 0 || timestamp >= totalDuration) continue;
					const duration = Math.min(packet.duration, Math.max(0, totalDuration - timestamp));
					if (duration <= 0) continue;
					await source.add(packet.clone({ timestamp, duration, sequenceNumber: sequence++ }), {
						decoderConfig: isFirst ? (config ?? undefined) : undefined
					});
					isFirst = false;
				}
				source.close();
			}

			options.onProgress?.(0.95, finalStreaming.bytesWritten);
			await finalOutput.finalize();
		} finally {
			options.signal?.removeEventListener('abort', abort);
		}

		const scratchFile = await finalStreaming.file(options.fileName, options.mimeType);
		options.onProgress?.(1, scratchFile.size);
		return {
			scratchPath: finalStreaming.storageKey ?? scratchFile.name,
			fileName: scratchFile.name,
			scratchFile,
			wasLossless: false,
			reason: `Re-encoded the ${prefixDuration.toFixed(2)}s leading boundary, then stream-copied the remaining video.`,
			estimatedBytes: scratchFile.size
		};
	} catch (error) {
		if (outputStarted && finalOutput.state === 'started') {
			await finalOutput.cancel().catch(() => undefined);
		}
		await finalStreaming.discard().catch(() => undefined);
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (error instanceof UnsupportedSmartCutError) throw error;
		if (
			error instanceof DOMException &&
			(error.name === 'NotSupportedError' || error.name === 'EncodingError')
		) {
			throw new UnsupportedSmartCutError(error.message);
		}
		throw error;
	} finally {
		originalInput?.dispose();
		prefixInput?.dispose();
		audioInput?.dispose();
		await prefix?.streaming.discard().catch(() => undefined);
		await audio?.streaming.discard().catch(() => undefined);
	}
}
