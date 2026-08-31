/**
 * Media probe worker: metadata extraction + thumbnail via mediabunny.
 *
 * One job per message: probe a File into MediaProbeResult (duration,
 * dimensions, fps estimate, keyframe timestamps, codecs) plus a JPEG
 * thumbnail blob. Heavy work stays off the main thread.
 *
 * Ported from FreeCut (MIT) media-processor.worker.ts and adapted to OpenPost.
 */

import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input } from 'mediabunny';
import { ensureProResDecoderForCodec, isProResCodec } from './prores-decoder';
import { isAudioCodecSupported } from './audio-codec-support';
import type { VideoFrameRateMetrics } from './types';
import { probeVideoFrameRate } from './video-frame-rate';

export interface MediaProbeResult {
	durationSeconds: number;
	width: number;
	height: number;
	fps: number;
	frameRateMetrics?: VideoFrameRateMetrics;
	videoCodec?: string;
	videoCodecSupported: boolean;
	audioCodec?: string;
	audioCodecSupported: boolean;
	bitrate?: number;
	keyframeTimestamps?: number[];
	gopInterval?: number;
	thumbnailBlob?: Blob;
	hasAudio: boolean;
	/** Composited frame count for animated GIF/WebP images; absent when static. */
	animationFrameCount?: number;
	kind: 'video' | 'audio' | 'image';
}

const KEYFRAME_MAX_PACKETS = 5_000;
const THUMBNAIL_MAX_EDGE = 320;
/** Animated-image frames decoded at probe time before extrapolating duration. */
const ANIMATION_PROBE_MAX_FRAMES = 600;
/** Upper bound on animated frames; hostile containers beyond this are rejected. */
const MAX_ANIMATED_FRAMES = 2_000;
/** Frames with zero or missing delay display for 100ms (FreeCut parity). */
const DEFAULT_DELAY_MS = 100;

async function extractKeyframes(input: Input): Promise<number[] | undefined> {
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) return undefined;
		const sink = new EncodedPacketSink(track);
		const timestamps: number[] = [];
		let packet = await sink.getFirstKeyPacket({ metadataOnly: true });
		while (packet && timestamps.length < KEYFRAME_MAX_PACKETS) {
			timestamps.push(packet.timestamp);
			packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
		}
		if (timestamps.length < 2) return undefined;
		// Deduplicate near-identical timestamps (sub-ms jitter).
		// SAFETY: length >= 2 checked above.
		const deduped: number[] = [timestamps[0] as number];
		for (const ts of timestamps.slice(1)) {
			if (ts - deduped[deduped.length - 1]! > 0.001) deduped.push(ts);
		}
		return deduped.length >= 2 ? deduped : undefined;
	} catch {
		return undefined;
	}
}

async function generateThumbnail(
	input: Input,
	atSecond: number,
	strict = false
): Promise<Blob | undefined> {
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) return undefined;
		const height = Math.min(320, track.displayHeight);
		const scale = track.displayHeight > 0 ? height / track.displayHeight : 1;
		const sink = new CanvasSink(track, {
			width: Math.round(track.displayWidth * scale),
			height: Math.round(track.displayHeight * scale),
			fit: 'fill'
		});
		const wrapped = await sink.getCanvas(Math.min(atSecond, 0.1));
		if (!wrapped) return undefined;
		const blob =
			wrapped.canvas instanceof OffscreenCanvas
				? await wrapped.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
				: await new Promise<Blob | null>((resolve) =>
						// SAFETY: this branch is the HTMLCanvasElement half of the union.
						(wrapped.canvas as HTMLCanvasElement).toBlob(resolve, 'image/jpeg', 0.8)
					);
		return blob ?? undefined;
	} catch (error) {
		if (strict) throw error;
		return undefined;
	}
}

interface AnimationProbe {
	frameCount: number;
	durationSeconds: number;
	fps: number;
}

/**
 * Read real animation truth (composited frame count, total loop duration,
 * effective fps) with the WebCodecs ImageDecoder. Returns null for static
 * images or when the API is unavailable.
 */
async function probeAnimatedImage(file: File): Promise<AnimationProbe | null> {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Optional platform API feature detection.
	if (typeof ImageDecoder === 'undefined') return null;
	let decoder: ImageDecoder | null = null;
	try {
		decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
		await Promise.all([decoder.tracks.ready, decoder.completed]);
		const track = decoder.tracks.selectedTrack;
		if (!track || !track.animated || track.frameCount <= 1) return null;
		const frameCount = track.frameCount;
		if (frameCount > MAX_ANIMATED_FRAMES) {
			throw new Error(`Animation exceeds the ${MAX_ANIMATED_FRAMES} frame limit.`);
		}
		const sampledCount = Math.min(frameCount, ANIMATION_PROBE_MAX_FRAMES);
		const timestampsUs: number[] = [];
		const ownDurationsMs: number[] = [];
		for (let index = 0; index < sampledCount; index++) {
			const result = await decoder.decode({ frameIndex: index });
			const videoFrame = result.image;
			try {
				timestampsUs.push(videoFrame.timestamp ?? -1);
				ownDurationsMs.push((videoFrame.duration ?? 0) / 1000);
			} finally {
				videoFrame.close();
			}
		}
		const sampledDurationsMs = ownDurationsMs.map((own, index) => {
			if (own > 0) return own;
			const current = timestampsUs[index];
			const next = timestampsUs[index + 1];
			if (current !== undefined && next !== undefined && current >= 0 && next > current) {
				return (next - current) / 1000;
			}
			return DEFAULT_DELAY_MS;
		});
		const totalMs = sampledDurationsMs.reduce((sum, value) => sum + value, 0);
		if (!(totalMs > 0)) return null;
		// Containers beyond the sampling cap scale their measured prefix linearly.
		const durationSeconds = (totalMs / 1000) * (frameCount / sampledCount);
		return {
			frameCount,
			durationSeconds,
			fps: durationSeconds > 0 ? frameCount / durationSeconds : 0
		};
	} catch (error) {
		if (error instanceof Error && error.message.includes('frame limit')) throw error;
		return null;
	} finally {
		decoder?.close();
	}
}

self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
	const { id, file } = event.data;
	try {
		const kind: MediaProbeResult['kind'] = file.type.startsWith('audio/')
			? 'audio'
			: file.type.startsWith('image/')
				? 'image'
				: 'video';

		if (kind === 'image') {
			const bitmap = await createImageBitmap(file);
			const width = bitmap.width;
			const height = bitmap.height;
			const animation = await probeAnimatedImage(file);
			const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(width, height));
			const thumbnailWidth = Math.max(1, Math.round(width * scale));
			const thumbnailHeight = Math.max(1, Math.round(height * scale));
			let thumbnailBlob: Blob | undefined;
			try {
				const canvas = new OffscreenCanvas(thumbnailWidth, thumbnailHeight);
				const context = canvas.getContext('2d');
				if (context) {
					context.drawImage(bitmap, 0, 0, thumbnailWidth, thumbnailHeight);
					thumbnailBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
				}
			} catch {
				// A thumbnail is optional. Keep the decoded source usable when JPEG encoding fails.
			} finally {
				bitmap.close();
			}
			const result: MediaProbeResult = {
				kind,
				durationSeconds: animation?.durationSeconds ?? 0,
				width,
				height,
				fps: animation?.fps ?? 0,
				videoCodecSupported: true,
				audioCodecSupported: true,
				thumbnailBlob,
				hasAudio: false,
				animationFrameCount: animation?.frameCount
			};
			self.postMessage({ id, ok: true, result });
			return;
		}

		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const duration = await input.computeDuration();
		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTrack = await input.getPrimaryAudioTrack();

		let fps = 30;
		let frameRateMetrics: VideoFrameRateMetrics | undefined;
		let width = 0;
		let height = 0;
		let videoCodec: string | undefined;
		let keyframeTimestamps: number[] | undefined;
		if (videoTrack) {
			({ fps, metrics: frameRateMetrics } = await probeVideoFrameRate(videoTrack));
			width = videoTrack.displayWidth;
			height = videoTrack.displayHeight;
			videoCodec = videoTrack.codec ?? undefined;
			await ensureProResDecoderForCodec(videoCodec);
			keyframeTimestamps = await extractKeyframes(input);
		}
		const videoCodecSupported = videoTrack
			? isProResCodec(videoCodec)
				? false
				: await videoTrack.canDecode().catch(() => true)
			: true;

		let gopInterval: number | undefined;
		if (keyframeTimestamps && keyframeTimestamps.length >= 2) {
			const span =
				// SAFETY: length >= 2 checked above.
				(keyframeTimestamps[keyframeTimestamps.length - 1] as number) - keyframeTimestamps[0]!;
			gopInterval = span / (keyframeTimestamps.length - 1);
		}

		const thumbnailBlob = videoTrack
			? await generateThumbnail(input, duration > 2 ? 1 : duration / 2, isProResCodec(videoCodec))
			: undefined;

		const result: MediaProbeResult = {
			kind,
			durationSeconds: duration || 0,
			width,
			height,
			fps: kind === 'audio' ? 0 : fps,
			frameRateMetrics,
			videoCodec: videoCodec ?? undefined,
			videoCodecSupported,
			audioCodec: audioTrack?.codec ?? undefined,
			audioCodecSupported: isAudioCodecSupported(audioTrack?.codec),
			keyframeTimestamps,
			gopInterval,
			thumbnailBlob,
			hasAudio: Boolean(audioTrack)
		};
		self.postMessage({ id, ok: true, result });
		// SAFETY: probe inputs implement dispose when the build supports it.
		input.dispose?.();
	} catch (error) {
		self.postMessage({
			id,
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
