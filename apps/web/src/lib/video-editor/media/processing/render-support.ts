/**
 * Plumbing shared by the workers that re-render a video frame by frame — frame interpolation and
 * upscaling. Both decode with `VideoSampleSink`, replace or invent frames, and encode with
 * `VideoSampleSource`; only the middle differs.
 *
 * Kept out of the feature barrel on purpose: nothing outside `workers/` should reach for this.
 */

import { createLogger } from '../../workspace-fs/logger';
import { ensureProResDecoderForCodec } from '../prores-decoder';
import { ensureAc3DecoderForCodec } from '../ac3-decoder';
import { isAudioCodecSupported } from '../audio-codec-support';
import { clampPacketToTimeline } from './audio-packet-timeline';

const logger = createLogger('RenderSupport');

export type Mediabunny = typeof import('mediabunny');
export type InputInstance = InstanceType<Mediabunny['Input']>;
export type OutputInstance = InstanceType<Mediabunny['Output']>;
export type VideoSampleInstance = InstanceType<Mediabunny['VideoSample']>;
export type VideoSampleSourceInstance = InstanceType<Mediabunny['VideoSampleSource']>;
type EncodedPacketInstance = InstanceType<Mediabunny['EncodedPacket']>;
type EncodedAudioPacketSourceInstance = InstanceType<Mediabunny['EncodedAudioPacketSource']>;
type AudioSampleInstance = InstanceType<Mediabunny['AudioSample']>;
type AudioSampleSourceInstance = InstanceType<Mediabunny['AudioSampleSource']>;

export class Cancelled extends Error {
	constructor() {
		super('cancelled');
		this.name = 'Cancelled';
	}
}

/** Job-scoped cancellation, checked between frames. */
export class CancellationRegistry {
	private readonly cancelled = new Set<string>();

	cancel(jobId: string): void {
		this.cancelled.add(jobId);
	}

	clear(jobId: string): void {
		this.cancelled.delete(jobId);
	}

	isCancelled(jobId: string): boolean {
		return this.cancelled.has(jobId);
	}

	throwIfCancelled(jobId: string): void {
		if (this.cancelled.has(jobId)) throw new Cancelled();
	}
}

/**
 * Hands samples to the encoder one deep, so the hardware encode of frame N overlaps the decode and
 * inference that produce frame N+1. Awaiting every `add()` inline instead — the obvious way to
 * write it — serializes encode behind inference and costs roughly a third of the wall clock.
 *
 * Depth of one, not unbounded: `add()` is mediabunny's backpressure signal, and a fully un-awaited
 * queue would buffer raw frames until memory ran out.
 *
 * `add()` takes ownership of the sample and closes it even when the encode rejects.
 */
export class EncodeQueue {
	private pending: Promise<void> | null = null;
	private encoded = 0;

	constructor(private readonly source: VideoSampleSourceInstance) {}

	get count(): number {
		return this.encoded;
	}

	async add(sample: VideoSampleInstance): Promise<void> {
		const previous = this.pending;
		this.pending = this.source.add(sample).finally(() => sample.close());
		this.encoded++;
		if (previous) await previous;
	}

	async drain(): Promise<void> {
		await this.pending;
		this.pending = null;
	}
}

/**
 * Preserves source audio while video frames are re-rendered. Compatible codecs use exact packet
 * passthrough. Decodable codecs that MP4 cannot carry, including AC-3, are transcoded once.
 *
 * Packets are pumped in step with the video timeline rather than all up front — the muxer would
 * otherwise buffer the entire video track while waiting for audio to catch up.
 *
 * Sources without audio and tracks the user explicitly accepted as unsupported become a no-op
 * rather than a `null` the render loop has to branch on.
 */
interface PacketAudioStream {
	readonly kind: 'packet';
	readonly source: EncodedAudioPacketSourceInstance;
	readonly packets: AsyncGenerator<EncodedPacketInstance>;
}

interface SampleAudioStream {
	readonly kind: 'sample';
	readonly source: AudioSampleSourceInstance;
	readonly samples: AsyncGenerator<AudioSampleInstance>;
}

type AudioStream = PacketAudioStream | SampleAudioStream;

class AudioCopier {
	private nextPacket: EncodedPacketInstance | null = null;
	private nextSample: AudioSampleInstance | null = null;
	private meta: EncodedAudioChunkMetadata | undefined;

	/** Null once exhausted, and from the start when there is no audio to copy. */
	private stream: AudioStream | null;

	private constructor(stream: AudioStream | null, decoderConfig: AudioDecoderConfig | null) {
		this.stream = stream;
		this.meta = decoderConfig ? { decoderConfig } : undefined;
	}

	static inert(): AudioCopier {
		return new AudioCopier(null, null);
	}

	static enabled(stream: AudioStream, decoderConfig: AudioDecoderConfig | null): AudioCopier {
		return new AudioCopier(stream, decoderConfig);
	}

	/** Emit every packet whose presentation time has been reached by the video track. */
	async pumpUntil(timestamp: number): Promise<void> {
		const stream = this.stream;
		if (!stream) return;
		if (stream.kind === 'sample') {
			for (;;) {
				this.nextSample ??= (await stream.samples.next()).value ?? null;
				const sample = this.nextSample;
				if (!sample) {
					this.stream = null;
					return;
				}
				if (sample.timestamp > timestamp) return;
				this.nextSample = null;
				try {
					await stream.source.add(sample);
				} finally {
					sample.close();
				}
			}
		}

		for (;;) {
			this.nextPacket ??= (await stream.packets.next()).value ?? null;
			const packet = this.nextPacket;
			if (!packet) {
				this.stream = null;
				return;
			}
			if (packet.timestamp > timestamp) return;
			this.nextPacket = null;

			const clamped = clampPacketToTimeline(packet);
			if (!clamped) continue;

			// `meta` carries the decoder config and is only required on the first packet emitted.
			await stream.source.add(clamped, this.meta);
			this.meta = undefined;
		}
	}

	async drain(): Promise<void> {
		await this.pumpUntil(Number.POSITIVE_INFINITY);
	}
}

/** Use lossless packet passthrough when possible and transcode only when the container requires it. */
export async function setupAudioCopy(
	mb: Mediabunny,
	input: InputInstance,
	output: OutputInstance
): Promise<AudioCopier> {
	const track = await input.getPrimaryAudioTrack();
	const codec = track?.codec;
	if (!track || !codec) return AudioCopier.inert();
	if (!isAudioCodecSupported(codec)) {
		logger.warn('Leaving an explicitly unsupported audio track out of processed media', { codec });
		return AudioCopier.inert();
	}
	if (output.format.getSupportedAudioCodecs().includes(codec)) {
		const source = new mb.EncodedAudioPacketSource(codec);
		output.addAudioTrack(source);
		const packets = new mb.EncodedPacketSink(track).packets();
		return AudioCopier.enabled({ kind: 'packet', source, packets }, await track.getDecoderConfig());
	}

	await ensureAc3DecoderForCodec(codec);
	const outputCodecs = output.format.getSupportedAudioCodecs();
	const transcodedCodec = await mb.getFirstEncodableAudioCodec(outputCodecs, {
		numberOfChannels: track.numberOfChannels,
		sampleRate: track.sampleRate,
		bitrate: 192_000
	});
	if (!transcodedCodec) {
		throw new Error(`No encoder can preserve the ${codec} audio track in processed media.`);
	}
	logger.info('Transcoding audio because the output container cannot carry it verbatim', {
		fromCodec: codec,
		toCodec: transcodedCodec
	});
	const source = new mb.AudioSampleSource({ codec: transcodedCodec, bitrate: 192_000 });
	output.addAudioTrack(source);
	const samples = new mb.AudioSampleSink(track).samples();
	return AudioCopier.enabled({ kind: 'sample', source, samples }, null);
}

export async function getSourceBlobFromOpfs(path: string, mimeType?: string): Promise<Blob> {
	const root = await navigator.storage.getDirectory();
	const parts = path.split('/').filter(Boolean);
	if (parts.length === 0) throw new Error('Invalid OPFS source path');

	let dir = root;
	for (let i = 0; i < parts.length - 1; i++) {
		dir = await dir.getDirectoryHandle(parts[i]!);
	}
	const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!);
	const file = await fileHandle.getFile();
	return !mimeType || file.type ? file : new Blob([file], { type: mimeType });
}

/** Scratch `.mp4` files under one OPFS directory, keyed by job id. */
export class OpfsScratch {
	constructor(private readonly directory: string) {}

	private async dir(): Promise<FileSystemDirectoryHandle> {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(this.directory, { create: true });
	}

	async createWritable(jobId: string): Promise<FileSystemWritableFileStream> {
		const handle = await (await this.dir()).getFileHandle(`${jobId}.mp4`, { create: true });
		return handle.createWritable();
	}

	async remove(jobId: string): Promise<void> {
		try {
			await (await this.dir()).removeEntry(`${jobId}.mp4`);
		} catch {
			// Nothing to clean up.
		}
	}
}

/**
 * Frame rate implied by the median inter-frame gap. Median, not mean: one long gap at a dropped
 * frame or a scene cut would otherwise drag the estimate down.
 */
export function medianFps(gaps: number[], fallback: number): number {
	if (gaps.length === 0) return fallback;
	const sorted = [...gaps].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	const gap = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
	return gap > 0 ? 1 / gap : fallback;
}

export function createRenderCanvas(width: number, height: number) {
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error(`Failed to acquire 2D context for a ${width}x${height} render`);
	return { canvas, ctx };
}

interface VideoDisplaySize {
	width: number;
	height: number;
}

const KEYFRAME_INTERVAL_SECONDS = 2;
const STREAM_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

interface VideoEncodeSettings {
	bitrate: InstanceType<Mediabunny['Quality']>;
	latencyMode: 'quality' | 'realtime';
}

type EncodableCodec = 'hevc' | 'avc' | 'vp9' | 'av1';

/**
 * Preference order. HEVC and H.264 come first because they are hardware-encoded and universally
 * playable, but neither survives every frame size: a 1080x1920 phone video upscales to 2160x3840,
 * and hardware encoders commonly cap height near 2304. VP9 and AV1 are software-encoded — slower,
 * but they accept sizes the hardware refuses, and MP4 carries both.
 */
const CODEC_PREFERENCE: readonly EncodableCodec[] = ['hevc', 'avc', 'vp9', 'av1'];

function addVideoTrack(
	mb: Mediabunny,
	output: OutputInstance,
	codec: EncodableCodec,
	settings: VideoEncodeSettings,
	frameRate: number
): VideoSampleSourceInstance {
	const source = new mb.VideoSampleSource({
		codec,
		bitrate: settings.bitrate,
		latencyMode: settings.latencyMode,
		keyFrameInterval: KEYFRAME_INTERVAL_SECONDS
	});
	output.addVideoTrack(source, { frameRate });
	return source;
}

/**
 * Exercise Mediabunny's real encoder path with one blank frame. `canEncodeVideo()` cannot perform
 * this preflight faithfully: it omits the output track's frame rate and the sample's display size,
 * while `VideoSampleSource` adds both to the WebCodecs config. Chrome can approve that incomplete
 * HEVC probe and reject the encoder when the first frame arrives.
 */
async function canEncodeFrame(
	mb: Mediabunny,
	codec: EncodableCodec,
	settings: VideoEncodeSettings,
	frame: { width: number; height: number; fps: number },
	canvas: OffscreenCanvas
): Promise<boolean> {
	const output = new mb.Output({
		format: new mb.Mp4OutputFormat({ fastStart: false }),
		target: new mb.NullTarget()
	});
	const source = addVideoTrack(mb, output, codec, settings, frame.fps);

	const sample = new mb.VideoSample(canvas, {
		timestamp: 0,
		duration: 1 / frame.fps
	});
	try {
		await output.start();
		await source.add(sample);
		return true;
	} catch {
		return false;
	} finally {
		sample.close();
		await output.cancel();
	}
}

async function pickCodec(
	mb: Mediabunny,
	format: InstanceType<Mediabunny['Mp4OutputFormat']>,
	settings: VideoEncodeSettings,
	frame: { width: number; height: number; fps: number }
): Promise<EncodableCodec> {
	const containable = new Set<string>(format.getSupportedVideoCodecs());
	const candidates = CODEC_PREFERENCE.filter((codec) => containable.has(codec));
	const { canvas, ctx } = createRenderCanvas(frame.width, frame.height);
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, frame.width, frame.height);

	try {
		for (const codec of candidates) {
			if (await canEncodeFrame(mb, codec, settings, frame, canvas)) return codec;
		}
	} finally {
		canvas.width = 1;
		canvas.height = 1;
	}
	throw new Error(
		`This browser cannot encode ${frame.width}x${frame.height} video with any of: ${candidates.join(', ')}.`
	);
}

export async function createMp4Encoder(
	mb: Mediabunny,
	writable: FileSystemWritableFileStream,
	frame: { width: number; height: number; fps: number }
) {
	const settings: VideoEncodeSettings = {
		bitrate: mb.QUALITY_HIGH,
		latencyMode: 'quality'
	};
	const format = new mb.Mp4OutputFormat({ fastStart: false });
	const codec = await pickCodec(mb, format, settings, frame);
	logger.info('Encoding render output', {
		codec,
		width: frame.width,
		height: frame.height
	});

	const output = new mb.Output({
		format,
		target: new mb.StreamTarget(writable, {
			chunked: true,
			chunkSize: STREAM_CHUNK_SIZE_BYTES
		})
	});
	const videoSource = addVideoTrack(mb, output, codec, settings, frame.fps);
	return { output, videoSource, codec };
}

/**
 * The frame size `VideoSample.draw()` will actually produce, which is not always what the
 * container claims.
 *
 * `InputVideoTrack.displayWidth` prefers the container's own display metadata, and plenty of
 * encoders write a rotated track's `tkhd` dimensions as the *coded* (landscape) size while also
 * setting a 90-degree rotation matrix. Sizing a canvas from that and then calling `draw()` — which
 * honours rotation — squashes a portrait video into a landscape frame. `VideoSample` derives its
 * own display size from square-pixel dimensions and rotation, ignoring that metadata; so do we.
 */
export function displaySize(
	squarePixelWidth: number,
	squarePixelHeight: number,
	rotation: number
): VideoDisplaySize {
	const upright = rotation % 180 === 0;
	return {
		width: upright ? squarePixelWidth : squarePixelHeight,
		height: upright ? squarePixelHeight : squarePixelWidth
	};
}

/**
 * Open the source and hand back a video sink plus the true display size of its frames. Disposes
 * the decoder if anything throws.
 */
export async function openVideoSource(
	mb: Mediabunny,
	sourceBlob: Blob
): Promise<{
	input: InputInstance;
	sink: InstanceType<Mediabunny['VideoSampleSink']>;
	totalSeconds: number;
	width: number;
	height: number;
}> {
	const input = new mb.Input({
		source: new mb.BlobSource(sourceBlob),
		formats: [mb.MP4, mb.QTFF, mb.WEBM, mb.MATROSKA]
	});
	// Anything that throws past this point must release the decoder — these workers outlive the
	// job, so a leaked Input holds its decoder for the life of the page.
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new Error('Source has no video track');
		await ensureProResDecoderForCodec(videoTrack.codec);

		const [squarePixelWidth, squarePixelHeight, rotation, totalSeconds] = await Promise.all([
			videoTrack.getSquarePixelWidth(),
			videoTrack.getSquarePixelHeight(),
			videoTrack.getRotation(),
			input.computeDuration()
		]);
		const { width, height } = displaySize(squarePixelWidth, squarePixelHeight, rotation);
		if (!(width > 0) || !(height > 0)) {
			throw new Error(`Source reported an unusable frame size of ${width}x${height}`);
		}

		return {
			input,
			sink: new mb.VideoSampleSink(videoTrack),
			totalSeconds,
			width,
			height
		};
	} catch (error) {
		input.dispose();
		throw error;
	}
}
