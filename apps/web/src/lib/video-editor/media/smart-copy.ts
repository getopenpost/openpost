import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	type EncodedPacket,
	Input,
	MkvOutputFormat,
	MovOutputFormat,
	Mp4OutputFormat,
	Output,
	type OutputFormat,
	type InputAudioTrack,
	type InputVideoTrack,
	WebMOutputFormat
} from 'mediabunny';
import type { SmartCopyPlan } from './smart-copy-plan';
import { resolveMediaBlob } from './resolve-media-blob';

export interface SmartCopyArtifact {
	fileName: string;
	blob: Blob;
}

export interface SmartCopyProgress {
	phase: 'preparing' | 'encoding' | 'finalizing';
	progress: number;
}

export interface SmartCopyOptions {
	signal?: AbortSignal;
	onProgress?: (progress: SmartCopyProgress) => void;
}

function outputFormat(format: SmartCopyPlan['format']): OutputFormat {
	switch (format) {
		case 'webm':
			return new WebMOutputFormat();
		case 'mp4':
			return new Mp4OutputFormat();
		case 'mov':
			return new MovOutputFormat();
		case 'mkv':
			return new MkvOutputFormat();
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

async function copyVideoPackets(
	track: InputVideoTrack,
	source: EncodedVideoPacketSource,
	startSeconds: number,
	endSeconds: number,
	tolerance: number,
	options: SmartCopyOptions
): Promise<void> {
	const sink = new EncodedPacketSink(track);
	const first = await sink.getKeyPacket(startSeconds + tolerance, { verifyKeyPackets: true });
	if (!first || Math.abs(first.timestamp - startSeconds) > tolerance) {
		throw new Error('SMART_COPY_KEYFRAME_MISMATCH');
	}
	const duration = endSeconds - startSeconds;
	const actualEnd = first.timestamp + duration;
	const last = await sink.getPacket(Math.max(first.timestamp, actualEnd - Number.EPSILON));
	const endPacket = last ? await sink.getNextPacket(last) : undefined;
	const decoderConfig = await track.getDecoderConfig();
	const packetStats = await track.computePacketStats(180);
	const fallbackDuration = 1 / Math.max(1, packetStats?.averagePacketRate ?? 30);
	let firstOutputPacket = true;
	let sequenceNumber = 0;
	try {
		for await (const packet of sink.packets(first, endPacket ?? undefined)) {
			throwIfAborted(options.signal);
			const timestamp = packet.timestamp - first.timestamp;
			if (timestamp < -tolerance || timestamp >= duration) continue;
			const packetDuration = Math.min(
				packet.duration > 0 ? packet.duration : fallbackDuration,
				Math.max(0, duration - timestamp)
			);
			if (packetDuration <= 0) continue;
			await source.add(
				packet.clone({
					timestamp: Math.max(0, timestamp),
					duration: packetDuration,
					sequenceNumber: sequenceNumber++
				}),
				{
					decoderConfig: firstOutputPacket ? (decoderConfig ?? undefined) : undefined
				}
			);
			firstOutputPacket = false;
			options.onProgress?.({
				phase: 'encoding',
				progress: Math.min(1, Math.max(0, (timestamp + packetDuration) / duration))
			});
		}
	} finally {
		source.close();
	}
	if (firstOutputPacket) throw new Error('SMART_COPY_EMPTY_VIDEO');
}

async function copyVideoAndAudioPackets(
	videoTrack: InputVideoTrack,
	videoSource: EncodedVideoPacketSource,
	audioTrack: InputAudioTrack,
	audioSource: EncodedAudioPacketSource,
	startSeconds: number,
	endSeconds: number,
	tolerance: number,
	options: SmartCopyOptions
): Promise<void> {
	await copyVideoPackets(videoTrack, videoSource, startSeconds, endSeconds, tolerance, options);

	const duration = endSeconds - startSeconds;
	const querySink = new EncodedPacketSink(audioTrack);
	const before = await querySink.getPacket(startSeconds);
	const after = before ? await querySink.getNextPacket(before) : await querySink.getFirstPacket();
	const first =
		before && after
			? Math.abs(startSeconds - before.timestamp) <= Math.abs(after.timestamp - startSeconds)
				? before
				: after
			: (before ?? after);
	if (!first) {
		audioSource.close();
		return;
	}
	const end = first.timestamp + duration;
	const decoderConfig = await audioTrack.getDecoderConfig();
	let sequenceNumber = 0;
	let firstOutputPacket = true;
	const addPacket = async (packet: EncodedPacket, nextTimestamp: number): Promise<void> => {
		const timestamp = packet.timestamp - first.timestamp;
		if (timestamp < 0 || timestamp >= duration) return;
		const sourceDuration =
			packet.duration > 0 ? packet.duration : Math.max(0, nextTimestamp - packet.timestamp);
		const packetDuration = Math.min(sourceDuration, Math.max(0, duration - timestamp));
		if (packetDuration <= 0) return;
		await audioSource.add(
			packet.clone({ timestamp, duration: packetDuration, sequenceNumber: sequenceNumber++ }),
			{ decoderConfig: firstOutputPacket ? (decoderConfig ?? undefined) : undefined }
		);
		firstOutputPacket = false;
	};
	let pending: EncodedPacket | null = null;
	try {
		for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
			throwIfAborted(options.signal);
			if (packet.timestamp + tolerance < first.timestamp) continue;
			if (pending) await addPacket(pending, packet.timestamp);
			if (packet.timestamp >= end) {
				pending = null;
				break;
			}
			pending = packet;
		}
		if (pending) await addPacket(pending, end);
	} finally {
		audioSource.close();
	}
	if (firstOutputPacket) throw new Error('SMART_COPY_EMPTY_AUDIO');
}

export async function smartCopy(
	plan: SmartCopyPlan,
	projectName: string,
	options: SmartCopyOptions = {}
): Promise<SmartCopyArtifact> {
	throwIfAborted(options.signal);
	options.onProgress?.({ phase: 'preparing', progress: 0 });
	const blob = await resolveMediaBlob(plan.media);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	const format = outputFormat(plan.format);
	const target = new BufferTarget();
	const output = new Output({ format, target });
	let started = false;
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack || (await videoTrack.getCodec()) !== plan.videoCodec) {
			throw new Error('SMART_COPY_VIDEO_CODEC_CHANGED');
		}
		const videoSource = new EncodedVideoPacketSource(plan.videoCodec);
		output.addVideoTrack(videoSource, {
			frameRate: plan.media.fps > 0 ? plan.media.fps : undefined,
			rotation: videoTrack.rotation
		});

		let audioTrack: InputAudioTrack | null = null;
		let audioSource: EncodedAudioPacketSource | null = null;
		if (plan.includeAudio && plan.audioCodec) {
			audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack || (await audioTrack.getCodec()) !== plan.audioCodec) {
				throw new Error('SMART_COPY_AUDIO_CODEC_CHANGED');
			}
			audioSource = new EncodedAudioPacketSource(plan.audioCodec);
			output.addAudioTrack(audioSource);
		}

		const onAbort = (): void => {
			if (output.state === 'started') void output.cancel();
		};
		options.signal?.addEventListener('abort', onAbort, { once: true });
		try {
			await output.start();
			started = true;
			if (audioTrack && audioSource) {
				await copyVideoAndAudioPackets(
					videoTrack,
					videoSource,
					audioTrack,
					audioSource,
					plan.sourceStartSeconds,
					plan.sourceEndSeconds,
					plan.keyframeToleranceSeconds,
					options
				);
			} else {
				await copyVideoPackets(
					videoTrack,
					videoSource,
					plan.sourceStartSeconds,
					plan.sourceEndSeconds,
					plan.keyframeToleranceSeconds,
					options
				);
			}
			throwIfAborted(options.signal);
			options.onProgress?.({ phase: 'finalizing', progress: 1 });
			await output.finalize();
		} finally {
			options.signal?.removeEventListener('abort', onAbort);
		}
	} catch (error) {
		if (started && output.state === 'started') {
			try {
				await output.cancel();
			} catch {
				// Keep the packet-copy failure as the useful error.
			}
		}
		throw error;
	} finally {
		if (!input.disposed) input.dispose();
	}

	if (!target.buffer) throw new Error('Smart copy produced no data.');
	const safeName = projectName.replace(/[\\/:*?"<>|]+/g, '_');
	return {
		fileName: `${safeName}.${plan.format}`,
		blob: new Blob([target.buffer], { type: format.mimeType })
	};
}
