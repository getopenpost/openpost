import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import type { QuickCutSource } from './types';
import { collectKeyframeTimestamps, extractKeyframeTimestamps } from './keyframes';
import { createHash } from './fingerprint';

export async function probeSourceFile(
	file: File,
	handle?: FileSystemFileHandle,
	existingId?: string,
	signal?: AbortSignal
): Promise<QuickCutSource> {
	signal?.throwIfAborted();
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const duration = await input.computeDuration().catch(() => 0);
		signal?.throwIfAborted();
		const videoTracksRaw = await input.getVideoTracks().catch(() => []);
		const audioTracksRaw = await input.getAudioTracks().catch(() => []);
		signal?.throwIfAborted();
		const videoTrack = videoTracksRaw[0] ?? (await input.getPrimaryVideoTrack().catch(() => null));
		const audioTrack = audioTracksRaw[0] ?? (await input.getPrimaryAudioTrack().catch(() => null));
		signal?.throwIfAborted();
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
			signal?.throwIfAborted();
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
		const videoStreams: QuickCutSource['videoStreams'] = [];
		for (let index = 0; index < videoTracksRaw.length; index++) {
			const track = videoTracksRaw[index]!;
			let fpsTrack: number | null = null;
			try {
				const stats = await track.computePacketStats(180).catch(() => null);
				if (stats?.averagePacketRate) fpsTrack = Math.round(stats.averagePacketRate * 1000) / 1000;
			} catch {
				// ignore
			}
			let kf: number[] = [];
			let kfState: QuickCutSource['videoStreams'][number]['keyframeState'] = 'unknown';
			try {
				const sink = new EncodedPacketSink(track);
				kf = await collectKeyframeTimestamps(sink, signal);
				kfState = kf.length > 0 ? 'known' : 'unknown';
			} catch (error) {
				if (signal?.aborted) throw signal.reason ?? error;
				kf = [];
				kfState = 'unknown';
			}
			videoStreams.push({
				index,
				codec: track.codec ?? null,
				width: track.displayWidth ?? 0,
				height: track.displayHeight ?? 0,
				rotation: track.rotation ?? 0,
				fps: fpsTrack ?? fps,
				keyframeTimestamps: kf,
				keyframeState: kfState
			});
		}
		const audioStreams: QuickCutSource['audioStreams'] = [];
		for (let index = 0; index < audioTracksRaw.length; index++) {
			const track = audioTracksRaw[index]!;
			let ch: number | null = null;
			// SAFETY: mediabunny audio tracks expose numberOfChannels per WebCodecs spec
			const mc = (track as { numberOfChannels?: number }).numberOfChannels;
			if (mc !== undefined && mc !== null) ch = mc;
			else {
				// SAFETY: fallback for older mediabunny builds that use channelCount
				const alt = (track as { channelCount?: number }).channelCount;
				if (alt !== undefined && alt !== null) ch = alt;
			}
			audioStreams.push({
				index,
				codec: track.codec ?? null,
				sampleRate: track.sampleRate ?? null,
				channels: ch
			});
		}
		let keyframeTimestamps: number[] = [];
		let keyframeState: QuickCutSource['keyframeState'] = 'unknown';
		if (videoStreams.length > 0) {
			keyframeTimestamps = videoStreams[0]!.keyframeTimestamps;
			keyframeState = videoStreams[0]!.keyframeState === 'known' ? 'known' : 'unknown';
		} else if (!videoTrack) {
			keyframeState = 'audio-only';
		} else {
			try {
				keyframeTimestamps = await extractKeyframeTimestamps(file, signal);
				keyframeState = keyframeTimestamps.length > 0 ? 'known' : 'unknown';
			} catch (error) {
				if (signal?.aborted) throw signal.reason ?? error;
				keyframeTimestamps = [];
				keyframeState = 'unknown';
			}
		}
		const lastModified = file.lastModified;
		let contentFingerprint: string | undefined;
		try {
			contentFingerprint = await createHash(file);
			signal?.throwIfAborted();
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
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
			file,
			videoStreams,
			audioStreams,
			selectedVideoTrackIndex: undefined,
			selectedAudioTrackIndices: undefined
		};
	} finally {
		try {
			input.dispose?.();
		} catch {
			// ignore
		}
	}
}

export async function resolveSourceFile(
	source: QuickCutSource,
	signal?: AbortSignal
): Promise<File> {
	signal?.throwIfAborted();
	if (source.file) return source.file;
	if (source.handle) {
		try {
			const file = await source.handle.getFile();
			signal?.throwIfAborted();
			return file;
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
			throw new Error(`Source ${source.name} is missing. Reconnect the file.`);
		}
	}
	throw new Error(`Source ${source.name} has no file or handle.`);
}
