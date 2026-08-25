// oxlint-disable
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { QuickCutSource } from './types';
import { extractKeyframeTimestamps } from './keyframes';

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
		let rotation = 0;
		let fps: number | null = null;
		if (videoTrack) {
			width =
				// SAFETY: type assertion is safe for this quick-cut path
				(videoTrack as unknown as { displayWidth?: number }).displayWidth ??
				// SAFETY: type assertion is safe for this quick-cut path
				(videoTrack as unknown as { codedWidth?: number }).codedWidth ??
				0;
			height =
				// SAFETY: type assertion is safe for this quick-cut path
				(videoTrack as unknown as { displayHeight?: number }).displayHeight ??
				// SAFETY: type assertion is safe for this quick-cut path
				(videoTrack as unknown as { codedHeight?: number }).codedHeight ??
				0;
			videoCodec = videoTrack.codec ?? (await videoTrack.getCodec().catch(() => null)) ?? null;
			// SAFETY: type assertion is safe for this quick-cut path
			rotation = (videoTrack as unknown as { rotation?: number }).rotation ?? 0;
			try {
				const stats = await // SAFETY: type assertion is safe for this quick-cut path
				(
					videoTrack as unknown as {
						computePacketStats?: (n: number) => Promise<{ averagePacketRate: number } | null>;
					}
				).computePacketStats?.(180);
				if (stats?.averagePacketRate) fps = Math.round(stats.averagePacketRate * 1000) / 1000;
			} catch {
				// ignore
			}
			// SAFETY: type assertion is safe for this quick-cut path
			if (!fps) fps = (videoTrack as unknown as { frameRate?: number }).frameRate ?? 30;
		}
		if (audioTrack) {
			audioCodec = audioTrack.codec ?? (await audioTrack.getCodec().catch(() => null)) ?? null;
			// SAFETY: type assertion is safe for this quick-cut path
			sampleRate = (audioTrack as unknown as { sampleRate?: number }).sampleRate ?? null;
			channels =
				// SAFETY: type assertion is safe for this quick-cut path
				(audioTrack as unknown as { numberOfChannels?: number }).numberOfChannels ??
				// SAFETY: type assertion is safe for this quick-cut path
				(audioTrack as unknown as { channelCount?: number }).channelCount ??
				null;
		}
		let keyframeTimestamps: number[] = [];
		try {
			keyframeTimestamps = await extractKeyframeTimestamps(file);
		} catch {
			keyframeTimestamps = [];
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
		} catch (e) {
			throw new Error(`Source ${source.name} is missing. Reconnect the file.`);
		}
	}
	throw new Error(`Source ${source.name} has no file or handle.`);
}

export function sourceMetadata(source: QuickCutSource) {
	const { handle: _h, file: _f, ...meta } = source;
	return meta;
}
