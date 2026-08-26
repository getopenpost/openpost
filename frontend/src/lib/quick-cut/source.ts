import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { QuickCutSource } from './types';
import { extractKeyframeTimestamps } from './keyframes';
import { createHash } from './fingerprint';

export async function probeSourceFile(
	file: File,
	handle?: FileSystemFileHandle,
	existingId?: string
): Promise<QuickCutSource> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const duration = await input.computeDuration().catch(() => 0);
		const videoTrack = await input.getPrimaryVideoTrack().catch(() => null);
		const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
		let width = 0;
		let height = 0;
		let videoCodec: string | null = null;
		let audioCodec: string | null = null;
		let sampleRate: number | null = null;
		let channels: number | null = null;
		let rotation: QuickCutSource['rotation'] = 0;
		let fps: number | null = null;
		if (videoTrack) {
			width = videoTrack.displayWidth;
			height = videoTrack.displayHeight;
			videoCodec = videoTrack.codec;
			rotation = videoTrack.rotation;
			const stats = await videoTrack.computePacketStats(180).catch(() => null);
			if (stats?.averagePacketRate) fps = Math.round(stats.averagePacketRate * 1000) / 1000;
		}
		if (audioTrack) {
			audioCodec = audioTrack.codec;
			sampleRate = audioTrack.sampleRate;
			// SAFETY: audioTrack from mediabunny may expose numberOfChannels per WebCodecs spec
			const maybeChannels = (audioTrack as { numberOfChannels?: number }).numberOfChannels;
			if (maybeChannels !== undefined && maybeChannels !== null) channels = maybeChannels;
			else {
				// SAFETY: fallback for older mediabunny builds that use channelCount
				const alt = (audioTrack as { channelCount?: number }).channelCount;
				if (alt !== undefined && alt !== null) channels = alt;
			}
		}
		let keyframeTimestamps: number[] = [];
		let keyframeState: QuickCutSource['keyframeState'] = 'unknown';
		try {
			keyframeTimestamps = await extractKeyframeTimestamps(file);
			if (!videoTrack) keyframeState = 'audio-only';
			else if (keyframeTimestamps.length > 0) keyframeState = 'known';
			else keyframeState = 'unknown';
		} catch {
			keyframeTimestamps = [];
			keyframeState = videoTrack ? 'unknown' : 'audio-only';
		}
		const lastModified = file.lastModified;
		let contentFingerprint: string | undefined;
		try {
			contentFingerprint = await createHash(file);
		} catch {
			contentFingerprint = undefined;
		}
		return {
			id: existingId ?? crypto.randomUUID(),
			name: file.name,
			size: file.size,
			mimeType: file.type || 'video/mp4',
			duration,
			width,
			height,
			videoCodec,
			audioCodec,
			sampleRate,
			channels,
			rotation,
			fps,
			keyframeTimestamps,
			keyframeState,
			lastModified,
			contentFingerprint,
			handle,
			file
		};
	} finally {
		try {
			input.dispose?.();
		} catch {
			// ignore
		}
	}
}

export async function resolveSourceFile(source: QuickCutSource): Promise<File> {
	if (source.file) return source.file;
	if (source.handle) {
		try {
			return await source.handle.getFile();
		} catch {
			throw new Error(`Source ${source.name} is missing. Reconnect the file.`);
		}
	}
	throw new Error(`Source ${source.name} has no file or handle.`);
}
