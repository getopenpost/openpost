import {
	ALL_FORMATS,
	BlobSource,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	Mp4OutputFormat,
	Output,
	WebMOutputFormat,
	type AudioCodec,
	type EncodedPacket,
	type OutputFormat,
	type VideoCodec
} from 'mediabunny';
import { projectDurationUS, type VideoProjectDocumentV1 } from '@openpost/video-project';
import { createStreamingOutputTarget } from '$lib/video/stream-target';
import { openVideoProjectSource } from './source-access';
import { quickCutCompatibility, type QuickCutSegment } from './lossless';

const KEYFRAME_TOLERANCE_SECONDS = 0.002;

export interface LosslessExportOptions {
	projectID?: string;
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
}

export async function exportQuickCutLosslessly(
	project: VideoProjectDocumentV1,
	options: LosslessExportOptions = {}
): Promise<File> {
	const compatibility = quickCutCompatibility(project);
	if (!compatibility.compatible || !compatibility.segments.length) {
		throw new Error('This project contains edits that require the full renderer.');
	}
	const source = project.sources[compatibility.segments[0]!.source_id]!;
	const file = await openVideoProjectSource(options.projectID, source, options.signal);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const stream = await createStreamingOutputTarget(options.signal);
	let completed = false;
	try {
		const [videoTrack, audioTrack] = await Promise.all([
			input.getPrimaryVideoTrack(),
			input.getPrimaryAudioTrack()
		]);
		if (!videoTrack) throw new Error('The source has no video track.');
		const videoCodec = await videoTrack.getCodec();
		const audioCodec = audioTrack ? await audioTrack.getCodec() : null;
		if (!videoCodec) throw new Error('The source video codec is unknown.');
		const format = selectOutputFormat(videoCodec, audioCodec);
		const output = new Output({ format, target: stream.target });
		const videoSource = new EncodedVideoPacketSource(videoCodec);
		const audioSource = audioTrack && audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
		output.addVideoTrack(videoSource, {
			rotation: format.supportsVideoRotationMetadata ? await videoTrack.getRotation() : 0
		});
		if (audioSource) output.addAudioTrack(audioSource);
		const abort = () => void output.cancel();
		options.signal?.addEventListener('abort', abort, { once: true });
		try {
			await output.start();
			await Promise.all([
				copyVideoSegments(
					videoTrack,
					videoSource,
					compatibility.segments,
					projectDurationUS(project),
					options
				),
				audioTrack && audioSource
					? copyAudioSegments(audioTrack, audioSource, compatibility.segments, options.signal)
					: Promise.resolve()
			]);
			videoSource.close();
			audioSource?.close();
			await output.finalize();
		} catch (cause) {
			if (output.state === 'started' || output.state === 'finalizing') {
				await output.cancel().catch(() => undefined);
			}
			throw cause;
		} finally {
			options.signal?.removeEventListener('abort', abort);
		}
		const rendered = await stream.file(
			`${safeFileName(project.title)}-quick-cut${format.fileExtension}`,
			format.mimeType
		);
		await validateLosslessOutput(rendered, videoCodec, projectDurationUS(project));
		completed = true;
		options.onProgress?.(1);
		return rendered;
	} finally {
		if (!input.disposed) input.dispose();
		if (!completed) await stream.discard();
	}
}

function selectOutputFormat(videoCodec: VideoCodec, audioCodec: AudioCodec | null): OutputFormat {
	const formats: OutputFormat[] = [
		new Mp4OutputFormat({ fastStart: 'reserve' }),
		new WebMOutputFormat()
	];
	const format = formats.find(
		(candidate) =>
			candidate.getSupportedVideoCodecs().includes(videoCodec) &&
			(!audioCodec || candidate.getSupportedAudioCodecs().includes(audioCodec))
	);
	if (!format) {
		throw new Error(
			`The ${videoCodec}${audioCodec ? `/${audioCodec}` : ''} source cannot be stream-copied into MP4 or WebM in this browser.`
		);
	}
	return format;
}

async function copyVideoSegments(
	track: NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>,
	source: EncodedVideoPacketSource,
	segments: QuickCutSegment[],
	totalDurationUS: number,
	options: LosslessExportOptions
): Promise<void> {
	const sink = new EncodedPacketSink(track);
	const decoderConfig = await track.getDecoderConfig();
	const meta: EncodedVideoChunkMetadata = { decoderConfig: decoderConfig ?? undefined };
	let sequenceNumber = 0;
	let outputOffset = 0;
	for (const segment of segments) {
		options.signal?.throwIfAborted();
		const start = segment.source_start_us / 1_000_000;
		const end = segment.source_end_us / 1_000_000;
		const startPacket = await sink.getKeyPacket(start, { verifyKeyPackets: true });
		if (!startPacket || Math.abs(startPacket.timestamp - start) > KEYFRAME_TOLERANCE_SECONDS) {
			throw new Error(
				`A kept section starts at ${timeLabel(segment.source_start_us)}, between source keyframes. Snap the in point to a keyframe or use Full Studio export.`
			);
		}
		const endPacket = await sink.getPacket(Math.max(start, end - 0.000001));
		if (!endPacket) throw new Error('The end of a kept section could not be read.');
		for await (const packet of sink.packets(startPacket)) {
			options.signal?.throwIfAborted();
			if (pastEndPacket(packet, endPacket)) break;
			if (packet.timestamp + packet.duration <= start) continue;
			const relativeTimestamp = Math.max(0, packet.timestamp - start);
			const remaining = end - packet.timestamp;
			if (remaining <= 0) continue;
			const clone = packet.clone({
				timestamp: outputOffset + relativeTimestamp,
				duration: Math.min(packet.duration, remaining),
				sequenceNumber: sequenceNumber++
			});
			await source.add(clone, meta);
			options.onProgress?.(
				Math.min(
					0.98,
					(segment.timeline_start_us + relativeTimestamp * 1_000_000) / totalDurationUS
				)
			);
		}
		outputOffset += end - start;
	}
}

async function copyAudioSegments(
	track: NonNullable<Awaited<ReturnType<Input['getPrimaryAudioTrack']>>>,
	source: EncodedAudioPacketSource,
	segments: QuickCutSegment[],
	signal?: AbortSignal
): Promise<void> {
	const sink = new EncodedPacketSink(track);
	const decoderConfig = await track.getDecoderConfig();
	const meta: EncodedAudioChunkMetadata = { decoderConfig: decoderConfig ?? undefined };
	let sequenceNumber = 0;
	let outputOffset = 0;
	for (const segment of segments) {
		signal?.throwIfAborted();
		const start = segment.source_start_us / 1_000_000;
		const end = segment.source_end_us / 1_000_000;
		let packet = await sink.getPacket(start);
		if (!packet) packet = await sink.getFirstPacket();
		if (!packet) continue;
		for await (const candidate of sink.packets(packet)) {
			signal?.throwIfAborted();
			if (candidate.timestamp >= end) break;
			if (candidate.timestamp + candidate.duration <= start) continue;
			const relativeTimestamp = Math.max(0, candidate.timestamp - start);
			const remaining = end - candidate.timestamp;
			if (remaining <= 0) continue;
			await source.add(
				candidate.clone({
					timestamp: outputOffset + relativeTimestamp,
					duration: Math.min(candidate.duration, remaining),
					sequenceNumber: sequenceNumber++
				}),
				meta
			);
		}
		outputOffset += end - start;
	}
}

function pastEndPacket(packet: EncodedPacket, endPacket: EncodedPacket): boolean {
	if (packet.sequenceNumber >= 0 && endPacket.sequenceNumber >= 0) {
		return packet.sequenceNumber > endPacket.sequenceNumber;
	}
	return packet.timestamp > endPacket.timestamp + Math.max(0.25, endPacket.duration * 4);
}

async function validateLosslessOutput(
	file: File,
	expectedCodec: VideoCodec,
	expectedDurationUS: number
): Promise<void> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		if (!(await input.canRead())) throw new Error('The fast export is not a readable media file.');
		const track = await input.getPrimaryVideoTrack();
		if (!track || (await track.getCodec()) !== expectedCodec) {
			throw new Error('The fast export did not preserve the source video codec.');
		}
		const duration = await input.computeDuration();
		if (Math.abs(duration - expectedDurationUS / 1_000_000) > 0.5) {
			throw new Error('The fast export duration differs from the kept timeline.');
		}
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function safeFileName(value: string): string {
	return (
		value
			.trim()
			.replace(/[^a-z0-9_-]+/giu, '-')
			.replace(/^-+|-+$/gu, '') || 'video'
	);
}

function timeLabel(timestampUS: number): string {
	const seconds = timestampUS / 1_000_000;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${(seconds % 60).toFixed(3).padStart(6, '0')}`;
}
