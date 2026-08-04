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
	type InputAudioTrack,
	type InputVideoTrack,
	type OutputFormat,
	type VideoCodec
} from 'mediabunny';
import { projectDurationUS, type VideoProjectDocumentV1 } from '@openpost/video-project';
import {
	createFileSystemAccessOutputTarget,
	createStreamingOutputTarget
} from '$lib/video/stream-target';
import { openVideoProjectSource } from './source-access';
import { quickCutCompatibility, type QuickCutSegment } from './lossless';

const KEYFRAME_TOLERANCE_SECONDS = 0.002;
const PROGRESS_INTERVAL_MS = 50;

export interface LosslessExportOptions {
	projectID?: string;
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
	outputFileHandle?: FileSystemFileHandle;
	format?: 'mp4' | 'webm';
}

interface AudioTrackPlan {
	track: InputAudioTrack;
	codec: AudioCodec;
	source: EncodedAudioPacketSource;
	maximumPacketCount?: number;
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
	const stream = options.outputFileHandle
		? await createFileSystemAccessOutputTarget(options.outputFileHandle, options.signal)
		: await createStreamingOutputTarget(options.signal);
	let completed = false;
	try {
		const [tracks, videoTracks, audioTracks] = await Promise.all([
			input.getTracks(),
			input.getVideoTracks(),
			input.getAudioTracks()
		]);
		const unsupportedTracks = tracks.filter(
			(track) => !track.isVideoTrack() && !track.isAudioTrack()
		);
		if (unsupportedTracks.length > 0) {
			throw new Error(
				`Quick Cut found ${unsupportedTracks.length} subtitle or data track${unsupportedTracks.length === 1 ? '' : 's'}. It will not silently remove source tracks.`
			);
		}
		if (videoTracks.length === 0) throw new Error('The source has no video track.');
		if (videoTracks.length > 1) {
			throw new Error(
				'Quick Cut found more than one video track. Choose a single video track before exporting.'
			);
		}
		const videoTrack = videoTracks[0]!;
		const videoCodec = await videoTrack.getCodec();
		if (!videoCodec) throw new Error('The source video codec is unknown.');
		const audioCodecs = await Promise.all(audioTracks.map((track) => track.getCodec()));
		if (audioCodecs.some((codec) => codec === null)) {
			throw new Error(
				'Quick Cut cannot identify every audio track, so it will not silently drop one.'
			);
		}
		const format = selectOutputFormat(
			videoCodec,
			audioCodecs as AudioCodec[],
			source.mime_type,
			options.format
		);
		const resolvedSegments = await resolveVideoSegments(videoTrack, compatibility.segments);
		const [videoPacketStats, ...audioPacketStats] =
			format instanceof Mp4OutputFormat
				? await Promise.all([
						videoTrack.computePacketStats(),
						...audioTracks.map((track) => track.computePacketStats())
					])
				: [null, ...audioTracks.map(() => null)];
		const output = new Output({ format, target: stream.target });
		const videoSource = new EncodedVideoPacketSource(videoCodec);
		output.addVideoTrack(videoSource, {
			rotation: format.supportsVideoRotationMetadata ? await videoTrack.getRotation() : 0,
			maximumPacketCount: videoPacketStats?.packetCount,
			name: (await videoTrack.getName()) ?? undefined,
			disposition: await videoTrack.getDisposition()
		});
		const audioPlans: AudioTrackPlan[] = audioTracks.map((track, index) => ({
			track,
			codec: audioCodecs[index]!,
			source: new EncodedAudioPacketSource(audioCodecs[index]!),
			maximumPacketCount: audioPacketStats[index]?.packetCount
		}));
		for (const plan of audioPlans) {
			output.addAudioTrack(plan.source, {
				maximumPacketCount: plan.maximumPacketCount,
				name: (await plan.track.getName()) ?? undefined,
				disposition: await plan.track.getDisposition()
			});
		}
		output.setMetadataTags(await input.getMetadataTags());
		const abort = () => void output.cancel();
		options.signal?.addEventListener('abort', abort, { once: true });
		try {
			await output.start();
			const reportProgress = throttledProgress(options.onProgress);
			await Promise.all([
				copyVideoSegments(videoTrack, videoSource, resolvedSegments, projectDurationUS(project), {
					...options,
					onProgress: reportProgress
				}),
				...audioPlans.map((plan) =>
					copyAudioSegments(plan.track, plan.source, resolvedSegments, options.signal)
				)
			]);
			videoSource.close();
			for (const plan of audioPlans) plan.source.close();
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
		await validateLosslessOutput(
			rendered,
			videoCodec,
			audioCodecs as AudioCodec[],
			projectDurationUS(project)
		);
		options.onProgress?.(1);
		// OPFS-backed File objects are snapshots of the bytes, but Chromium can
		// still read them lazily when a download starts. Keep a successful staging
		// entry alive so the browser can finish taking ownership. The stream target
		// removes entries older than 24 hours before the next export; failed and
		// cancelled exports are removed immediately below.
		completed = true;
		return rendered;
	} finally {
		if (!input.disposed) input.dispose();
		if (!completed) await stream.discard();
	}
}

function selectOutputFormat(
	videoCodec: VideoCodec,
	audioCodecs: AudioCodec[],
	sourceMimeType: string,
	preferred?: 'mp4' | 'webm'
): OutputFormat {
	const mp4 = new Mp4OutputFormat({ fastStart: 'reserve' });
	const webm = new WebMOutputFormat();
	const formats: OutputFormat[] = preferred
		? preferred === 'webm'
			? [webm]
			: [mp4]
		: sourceMimeType.toLowerCase().includes('webm')
			? [webm, mp4]
			: [mp4, webm];
	const format = formats.find((candidate) => {
		const limits = candidate.getSupportedTrackCounts();
		return (
			candidate.getSupportedVideoCodecs().includes(videoCodec) &&
			audioCodecs.every((codec) => candidate.getSupportedAudioCodecs().includes(codec)) &&
			limits.video.max >= 1 &&
			limits.audio.max >= audioCodecs.length &&
			limits.total.max >= audioCodecs.length + 1
		);
	});
	if (!format) {
		throw new Error(
			`The ${videoCodec}${audioCodecs.length ? `/${audioCodecs.join('+')}` : ''} tracks cannot all be stream-copied into MP4 or WebM in this browser.`
		);
	}
	return format;
}

async function resolveVideoSegments(
	track: InputVideoTrack,
	segments: QuickCutSegment[]
): Promise<QuickCutSegment[]> {
	const sink = new EncodedPacketSink(track);
	const resolved: QuickCutSegment[] = [];
	for (const segment of segments) {
		const requestedStart = segment.source_start_us / 1_000_000;
		// getKeyPacket returns the key packet at or before the query. Querying one
		// tolerance past the requested boundary also resolves a packet whose stored
		// timestamp differs by harmless container rounding.
		const packet = await sink.getKeyPacket(requestedStart + KEYFRAME_TOLERANCE_SECONDS, {
			verifyKeyPackets: true
		});
		if (!packet || Math.abs(packet.timestamp - requestedStart) > KEYFRAME_TOLERANCE_SECONDS) {
			throw new Error(
				`A kept section starts at ${timeLabel(segment.source_start_us)}, between source keyframes. Snap the in point to a keyframe or use a precise export.`
			);
		}
		resolved.push({ ...segment, source_start_us: packet.microsecondTimestamp });
	}
	return resolved;
}

async function copyVideoSegments(
	track: InputVideoTrack,
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
		const startPacket = await sink.getKeyPacket(start + KEYFRAME_TOLERANCE_SECONDS, {
			verifyKeyPackets: true
		});
		if (!startPacket || Math.abs(startPacket.timestamp - start) > KEYFRAME_TOLERANCE_SECONDS) {
			throw new Error('A verified keyframe changed while the source was being exported.');
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
			await source.add(
				packet.clone({
					timestamp: outputOffset + relativeTimestamp,
					duration: Math.min(packet.duration, remaining),
					sequenceNumber: sequenceNumber++
				}),
				meta
			);
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
	track: InputAudioTrack,
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
	expectedVideoCodec: VideoCodec,
	expectedAudioCodecs: AudioCodec[],
	expectedDurationUS: number
): Promise<void> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		if (!(await input.canRead())) throw new Error('The fast export is not a readable media file.');
		const [videoTracks, audioTracks] = await Promise.all([
			input.getVideoTracks(),
			input.getAudioTracks()
		]);
		if (videoTracks.length !== 1 || (await videoTracks[0]!.getCodec()) !== expectedVideoCodec) {
			throw new Error('The fast export did not preserve the source video track.');
		}
		const actualAudioCodecs = await Promise.all(audioTracks.map((track) => track.getCodec()));
		if (
			actualAudioCodecs.length !== expectedAudioCodecs.length ||
			actualAudioCodecs.some((codec, index) => codec !== expectedAudioCodecs[index])
		) {
			throw new Error('The fast export did not preserve every source audio track.');
		}
		const duration = await input.computeDuration();
		if (Math.abs(duration - expectedDurationUS / 1_000_000) > 0.5) {
			throw new Error('The fast export duration differs from the kept timeline.');
		}
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function throttledProgress(
	callback?: (fraction: number) => void
): ((fraction: number) => void) | undefined {
	if (!callback) return undefined;
	let lastAt = 0;
	return (fraction) => {
		const now = performance.now();
		if (fraction < 1 && now - lastAt < PROGRESS_INTERVAL_MS) return;
		lastAt = now;
		callback(fraction);
	};
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
