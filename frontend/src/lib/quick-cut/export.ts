import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	AdtsOutputFormat,
	FlacOutputFormat,
	Mp4OutputFormat,
	Mp3OutputFormat,
	MovOutputFormat,
	MkvOutputFormat,
	OggOutputFormat,
	Output,
	WavOutputFormat,
	WebMOutputFormat,
	type OutputFormat,
	type VideoCodec,
	type AudioCodec
} from 'mediabunny';
import type { QuickCutSegment, QuickCutSource, CutMode } from './types';
import {
	findNearestKeyframe,
	findSnapKeyframe,
	estimateOutputBytes,
	resolveSegmentCutMode,
	KEYFRAME_TOLERANCE_SECONDS,
	getSelectedVideoStream,
	getSelectedAudioStreams,
	validateStreamSelection
} from './model';
import { createStreamingOutputTarget } from '$lib/video/stream-target';
import { probeSourceFile, resolveSourceFile } from './source';
import { ensureAc3DecoderForCodec } from '$lib/video-editor/media/ac3-decoder';
import { requireWorkspaceRoot } from '$lib/video-editor/workspace-fs/root';
import { openBlobWriter, exists, removeEntry } from '$lib/video-editor/workspace-fs/fs-primitives';
import {
	projectExportFilePath,
	exportFilePath,
	PROJECTS_DIR,
	EXPORTS_DIR,
	sanitizeWorkspaceFileName
} from '$lib/video-editor/workspace-fs/paths';

export class UnsupportedStreamCopyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedStreamCopyError';
	}
}

export interface QuickCutExportProgress {
	phase: 'preparing' | 'copying' | 'transcoding' | 'finalizing';
	segmentIndex: number;
	totalSegments: number;
	bytesWritten: number;
	elapsedMs: number;
	etaMs: number | null;
	fraction: number;
}

export interface QuickCutExportOptions {
	sources: QuickCutSource[];
	segments: QuickCutSegment[];
	cutMode: CutMode;
	merge: boolean;
	signal?: AbortSignal;
	onProgress?: (p: QuickCutExportProgress) => void;
}

type LocalExportProgress = (fraction: number, bytesWritten: number) => void;

export interface QuickCutScratchArtifact {
	scratchPath: string;
	fileName: string;
	scratchFile: File;
	wasLossless: boolean;
	reason: string;
	estimatedBytes: number;
}

export async function discardScratchFile(scratchPath: string): Promise<void> {
	try {
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle('openpost-video-streams', { create: false });
		await dir.removeEntry(scratchPath).catch(() => undefined);
	} catch {
		// ignore
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function outputFormatForSource(source: QuickCutSource): OutputFormat {
	const type = (source.mimeType ?? '').toLowerCase();
	const name = source.name.toLowerCase();
	if (type.includes('mpeg') || name.endsWith('.mp3')) return new Mp3OutputFormat();
	if (type.includes('wav') || name.endsWith('.wav')) return new WavOutputFormat();
	if (type.includes('flac') || name.endsWith('.flac')) return new FlacOutputFormat();
	if (type.includes('ogg') || name.endsWith('.ogg')) return new OggOutputFormat();
	if (type.includes('aac') || name.endsWith('.aac')) return new AdtsOutputFormat();
	if (type.includes('webm') || name.endsWith('.webm')) return new WebMOutputFormat();
	if (type.includes('quicktime') || name.endsWith('.mov')) return new MovOutputFormat();
	if (type.includes('x-matroska') || name.endsWith('.mkv')) return new MkvOutputFormat();
	return new Mp4OutputFormat();
}

function mimeForFormat(format: OutputFormat): string {
	return format.mimeType;
}

function extensionForFormat(format: OutputFormat): string {
	if (format instanceof Mp3OutputFormat) return 'mp3';
	if (format instanceof WavOutputFormat) return 'wav';
	if (format instanceof FlacOutputFormat) return 'flac';
	if (format instanceof OggOutputFormat) return 'ogg';
	if (format instanceof AdtsOutputFormat) return 'aac';
	if (format instanceof WebMOutputFormat) return 'webm';
	if (format instanceof MovOutputFormat) return 'mov';
	if (format instanceof MkvOutputFormat) return 'mkv';
	return 'mp4';
}

function safeBaseName(name: string): string {
	return name.replace(/\.[^.]+$/, '') || 'output';
}

function segmentFileName(base: string, segment: QuickCutSegment, ext: string): string {
	return `${base} [${segment.start.toFixed(2)}-${segment.end.toFixed(2)}].${ext}`;
}

function mergedFileName(sources: QuickCutSource[], ext: string): string {
	const base = sources[0] ? safeBaseName(sources[0].name) : 'output';
	return `${base} [merged ${Date.now()}].${ext}`;
}

export interface PreflightResult {
	eligible: boolean;
	reason: string;
	requiresTranscode: boolean;
	outputFormat: OutputFormat;
	estimatedBytes: number;
	snapInfo: Array<{
		segmentId: string;
		snappedStart: number;
		delta: number;
		direction: 'before' | 'after' | 'exact';
	}>;
	perSegment: Array<{
		segmentId: string;
		requiresTranscode: boolean;
		reason: string;
		snappedStart: number | null;
	}>;
}

export async function preflightExport(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	cutMode: CutMode,
	merge: boolean
): Promise<PreflightResult> {
	if (segments.length === 0)
		return {
			eligible: false,
			reason: 'No segments selected.',
			requiresTranscode: false,
			outputFormat: new Mp4OutputFormat(),
			estimatedBytes: 0,
			snapInfo: [],
			perSegment: []
		};
	const enabled = segments.filter((s) => s.enabled !== false);
	if (enabled.length === 0)
		return {
			eligible: false,
			reason: 'No enabled segments.',
			requiresTranscode: false,
			outputFormat: new Mp4OutputFormat(),
			estimatedBytes: 0,
			snapInfo: [],
			perSegment: []
		};
	const sourceById = new Map(sources.map((s) => [s.id, s]));
	for (const seg of enabled) {
		if (!sourceById.has(seg.sourceId))
			return {
				eligible: false,
				reason: `Segment ${seg.id.slice(0, 6)} has missing source.`,
				requiresTranscode: false,
				outputFormat: new Mp4OutputFormat(),
				estimatedBytes: 0,
				snapInfo: [],
				perSegment: []
			};
		const src = sourceById.get(seg.sourceId)!;
		if (seg.end > src.duration + 0.001)
			return {
				eligible: false,
				reason: `Segment end beyond source duration for ${src.name}.`,
				requiresTranscode: false,
				outputFormat: new Mp4OutputFormat(),
				estimatedBytes: 0,
				snapInfo: [],
				perSegment: []
			};
		if (seg.end <= seg.start)
			return {
				eligible: false,
				reason: 'Segment end must be after start.',
				requiresTranscode: false,
				outputFormat: new Mp4OutputFormat(),
				estimatedBytes: 0,
				snapInfo: [],
				perSegment: []
			};
	}
	const firstSource = sourceById.get(enabled[0]!.sourceId)!;
	const outputFormat = outputFormatForSource(firstSource);
	const estimatedBytes = estimateOutputBytes(enabled, sources);
	// Validate stream selections are possible
	for (const src of sources) {
		const err = validateStreamSelection(src);
		if (err) {
			return {
				eligible: false,
				reason: `${src.name}: ${err}`,
				requiresTranscode: false,
				outputFormat,
				estimatedBytes,
				snapInfo: [],
				perSegment: []
			};
		}
	}
	if (merge) {
		const selectedSources = enabled.map((segment) => sourceById.get(segment.sourceId)!);
		const hasVideo = selectedSources.some((source) => getSelectedVideoStream(source) !== null);
		const hasAudioOnly = selectedSources.some((source) => getSelectedVideoStream(source) === null);
		if (hasVideo && hasAudioOnly) {
			return {
				eligible: false,
				reason: 'Video and audio-only segments cannot share one merged visual output.',
				requiresTranscode: false,
				outputFormat,
				estimatedBytes,
				snapInfo: [],
				perSegment: []
			};
		}
	}
	let requiresTranscode = false;
	let reason = 'Stream copy is possible.';
	const snapInfo: PreflightResult['snapInfo'] = [];
	const perSegment: PreflightResult['perSegment'] = [];
	// Per-segment decisions
	for (const seg of enabled) {
		const src = sourceById.get(seg.sourceId)!;
		const kfs = src.keyframeTimestamps;
		const segmentCutMode = resolveSegmentCutMode(seg, cutMode);
		const sourceFormat = outputFormatForSource(src);
		const selectedVideo = getSelectedVideoStream(src);
		const selectedAudios = getSelectedAudioStreams(src);
		// SAFETY: selectedVideo.codec is a string from probeSourceFile via mediabunny track codec
		const sourceVideoCodec = (selectedVideo?.codec ?? null) as VideoCodec | null;
		const hasUnsupportedVideo =
			sourceVideoCodec !== null &&
			!sourceFormat.getSupportedVideoCodecs().includes(sourceVideoCodec);
		const hasUnsupportedAudio = selectedAudios.some(
			// SAFETY: selected audio codec strings are from mediabunny probe
			(a) =>
				a.codec !== null && !sourceFormat.getSupportedAudioCodecs().includes(a.codec as AudioCodec)
		);
		if (hasUnsupportedVideo || hasUnsupportedAudio) {
			perSegment.push({
				segmentId: seg.id,
				requiresTranscode: true,
				reason: 'Source codecs require re-encoding for the selected container',
				snappedStart: null
			});
			continue;
		}
		if (selectedVideo === null && selectedAudios.length === 0) {
			perSegment.push({
				segmentId: seg.id,
				requiresTranscode: true,
				reason: 'No tracks selected for this source',
				snappedStart: null
			});
			continue;
		}
		const isAudioOnlySelection = selectedVideo === null && selectedAudios.length > 0;
		if (src.keyframeState === 'audio-only' || isAudioOnlySelection) {
			const exactAudio = segmentCutMode === 'exact';
			perSegment.push({
				segmentId: seg.id,
				requiresTranscode: exactAudio,
				reason: exactAudio
					? 'Exact audio cuts require sample-accurate re-encoding'
					: 'Lossless audio packet copy',
				snappedStart: null
			});
			continue;
		}
		if (!src.fps || src.fps <= 0) {
			perSegment.push({
				segmentId: seg.id,
				requiresTranscode: true,
				reason: 'Frame rate is unavailable; re-encoding preserves timing',
				snappedStart: null
			});
			continue;
		}
		if (src.keyframeState === 'unknown' && seg.start > KEYFRAME_TOLERANCE_SECONDS) {
			perSegment.push({
				segmentId: seg.id,
				requiresTranscode: true,
				reason: 'Keyframe map unavailable; re-encoding preserves the requested start',
				snappedStart: null
			});
			continue;
		}
		if (segmentCutMode === 'exact') {
			const aligned =
				seg.start <= KEYFRAME_TOLERANCE_SECONDS
					? true
					: findNearestKeyframe(seg.start, kfs, KEYFRAME_TOLERANCE_SECONDS).aligned;
			if (!aligned) {
				perSegment.push({
					segmentId: seg.id,
					requiresTranscode: true,
					reason: `Start ${seg.start.toFixed(2)}s not on keyframe`,
					snappedStart: null
				});
			} else {
				perSegment.push({
					segmentId: seg.id,
					requiresTranscode: false,
					reason: 'On keyframe',
					snappedStart: seg.start
				});
				snapInfo.push({ segmentId: seg.id, snappedStart: seg.start, delta: 0, direction: 'exact' });
			}
		} else {
			const snap = findSnapKeyframe(seg.start, kfs);
			snapInfo.push({
				segmentId: seg.id,
				snappedStart: snap.snapped,
				delta: snap.delta,
				direction: snap.direction
			});
			perSegment.push({
				segmentId: seg.id,
				requiresTranscode: false,
				reason: `Snaps ${snap.direction}`,
				snappedStart: snap.snapped
			});
		}
	}
	// Merge-level decision: if any per-segment requires transcode and merge, then merged requires transcode; also check codec/dimensions
	if (merge && enabled.length > 1) {
		const firstVideo = getSelectedVideoStream(firstSource);
		const firstAudios = getSelectedAudioStreams(firstSource);
		const firstVideoCodec = firstVideo?.codec ?? null;
		const firstW = firstVideo?.width ?? 0;
		const firstH = firstVideo?.height ?? 0;
		const firstFps = firstVideo?.fps ?? null;
		const firstRotation = firstVideo?.rotation ?? 0;
		const firstAudioCodec = firstAudios[0]?.codec ?? null;
		const firstSR = firstAudios[0]?.sampleRate ?? null;
		const firstCh = firstAudios[0]?.channels ?? null;
		const firstAudioCount = firstAudios.length;
		for (const seg of enabled) {
			const src = sourceById.get(seg.sourceId)!;
			const selVideo = getSelectedVideoStream(src);
			const selAudios = getSelectedAudioStreams(src);
			if ((selVideo?.codec ?? null) !== firstVideoCodec) {
				requiresTranscode = true;
				reason = 'Selected segments use different codecs and require re-encoding for merge.';
				break;
			}
			if ((selAudios[0]?.codec ?? null) !== firstAudioCodec) {
				requiresTranscode = true;
				reason = 'Selected audio codecs differ and require re-encoding for merge.';
				break;
			}
			if ((selVideo?.width ?? 0) !== firstW || (selVideo?.height ?? 0) !== firstH) {
				requiresTranscode = true;
				reason = 'Selected segments have different dimensions and require re-encoding.';
				break;
			}
			if (
				((selVideo?.fps ?? null) === null) !== (firstFps === null) ||
				(selVideo?.fps !== null && firstFps !== null && Math.abs(selVideo.fps - firstFps) > 0.001)
			) {
				requiresTranscode = true;
				reason = 'Selected segments use different frame rates and require re-encoding.';
				break;
			}
			if (selAudios.length !== firstAudioCount) {
				requiresTranscode = true;
				reason = 'Audio track counts differ and require re-encoding.';
				break;
			}
			if (
				firstAudios.length > 0 &&
				(selAudios[0]?.sampleRate !== firstSR || selAudios[0]?.channels !== firstCh)
			) {
				requiresTranscode = true;
				reason = 'Audio configuration differs and requires re-encoding.';
				break;
			}
			if ((selVideo?.rotation ?? 0) !== firstRotation) {
				requiresTranscode = true;
				reason = 'Rotation differs and requires re-encoding.';
				break;
			}
			const fmt = outputFormatForSource(src);
			const supported = fmt.getSupportedVideoCodecs();
			// SAFETY: validated shape before cast
			const codec = firstVideoCodec as VideoCodec | null;
			if (codec && !supported.includes(codec)) {
				requiresTranscode = true;
				reason = 'Codec not supported in container and requires re-encoding.';
				break;
			}
			if (fmt.constructor.name !== outputFormat.constructor.name) {
				requiresTranscode = true;
				reason = 'Sources use different containers and require re-encoding.';
				break;
			}
		}
		// Also if any per-segment requires transcode for exact, merged requires transcode
		if (!requiresTranscode && perSegment.some((p) => p.requiresTranscode)) {
			requiresTranscode = true;
			reason = 'One or more segments not on keyframe; merged exact cut requires re-encoding.';
		}
		if (
			!requiresTranscode &&
			enabled.every((segment) => resolveSegmentCutMode(segment, cutMode) === 'nearestKeyframe')
		) {
			const hasBeforeSnap = snapInfo.some(
				(s) => s.direction === 'before' && Math.abs(s.delta) > 0.001
			);
			if (hasBeforeSnap)
				reason =
					'Nearest keyframe will include a small amount before the kept range for lossless copy.';
			else reason = 'Lossless copy using nearest keyframes.';
		}
	} else if (!requiresTranscode) {
		// For individual exports, requiresTranscode is per segment, not global; but for merged false, we keep global false and let perSegment decide
		// If any perSegment requires transcode, we don't force all to transcode; caller will handle per segment
		const anyNeedsTranscode = perSegment.some((p) => p.requiresTranscode);
		if (anyNeedsTranscode) {
			// For individual, not merged, we don't set global requiresTranscode; each segment will be handled individually
			reason = 'Some segments require re-encoding; others can be stream copied.';
		}
	}
	// Storage estimate with fixed reserve and explicit state
	let storageState: 'ok' | 'unknown' | 'insufficient' = 'unknown';
	try {
		const storage = globalThis.navigator?.storage;
		if (storage?.estimate) {
			const est = await storage.estimate();
			const quota = est.quota ?? 0;
			const usage = est.usage ?? 0;
			if (quota === 0) storageState = 'unknown';
			else {
				const reserve = 50 * 1024 * 1024;
				const headroom = estimatedBytes + reserve;
				if (usage + headroom > quota) storageState = 'insufficient';
				else storageState = 'ok';
			}
		}
	} catch {
		storageState = 'unknown';
	}
	if (storageState === 'insufficient') {
		return {
			eligible: false,
			reason: 'Not enough storage for this export.',
			requiresTranscode: false,
			outputFormat,
			estimatedBytes,
			snapInfo,
			perSegment
		};
	}
	// For individual exports, global requiresTranscode should be false; perSegment decides
	const globalRequiresTranscode = merge
		? requiresTranscode || perSegment.some((segment) => segment.requiresTranscode)
		: false;
	return {
		eligible: true,
		reason,
		requiresTranscode: globalRequiresTranscode,
		outputFormat,
		estimatedBytes,
		snapInfo,
		perSegment
	};
}

function getSnapForSegment(preflight: PreflightResult, segmentId: string): number | null {
	const info = preflight.snapInfo.find((s) => s.segmentId === segmentId);
	return info ? info.snappedStart : null;
}

async function exportSingleStreamCopy(
	source: QuickCutSource,
	segment: QuickCutSegment,
	snappedStart: number | null,
	signal?: AbortSignal,
	onProgress?: LocalExportProgress
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const selectedVideo = getSelectedVideoStream(source);
	const selectedAudios = getSelectedAudioStreams(source);
	if (!selectedVideo && selectedAudios.length === 0) {
		throw new UnsupportedStreamCopyError(`No tracks selected for ${source.name}.`);
	}
	const file = await resolveSourceFile(source, signal);
	const format = outputFormatForSource(source);
	const ext = extensionForFormat(format);
	const base = safeBaseName(source.name);
	const streaming = await createStreamingOutputTarget(signal);
	let input: Input | null = null;
	try {
		input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const trimStart = snappedStart ?? segment.start;
		const trimEnd = segment.end;
		if (selectedVideo) {
			const videoTracks = await input.getVideoTracks().catch(() => []);
			const videoTrack =
				videoTracks.find((t, idx) => idx === selectedVideo.index) ??
				(await input.getPrimaryVideoTrack().catch(() => null));
			if (!videoTrack) {
				throw new UnsupportedStreamCopyError(`No video track for ${source.name}.`);
			}
			if (trimStart > KEYFRAME_TOLERANCE_SECONDS) {
				const keyPacket = await new EncodedPacketSink(videoTrack).getKeyPacket(
					trimStart + KEYFRAME_TOLERANCE_SECONDS,
					{ verifyKeyPackets: true }
				);
				if (!keyPacket || Math.abs(keyPacket.timestamp - trimStart) > KEYFRAME_TOLERANCE_SECONDS) {
					throw new UnsupportedStreamCopyError(
						`Start ${trimStart.toFixed(3)}s is not an encoded keyframe for ${source.name}.`
					);
				}
			}
		}
		const hasVideo = selectedVideo !== null;
		const hasAudio = selectedAudios.length > 0;
		const conversion = await Conversion.init({
			input,
			output: new Output({ format, target: streaming.target }),
			trim: { start: trimStart, end: trimEnd },
			video: hasVideo ? { forceTranscode: false } : { discard: true },
			audio: hasAudio ? { forceTranscode: false } : { discard: true }
		});
		if (!conversion.isValid) {
			await streaming.discard();
			throw new UnsupportedStreamCopyError('Stream copy not valid for this segment.');
		}
		conversion.onProgress = (fraction) =>
			onProgress?.(Math.min(1, Math.max(0, fraction)), streaming.bytesWritten);
		onProgress?.(0, streaming.bytesWritten);
		if (signal) {
			const abort = () => void conversion.cancel().catch(() => undefined);
			signal.addEventListener('abort', abort, { once: true });
			try {
				await conversion.execute();
			} finally {
				signal.removeEventListener('abort', abort);
			}
		} else {
			await conversion.execute();
		}
		onProgress?.(1, streaming.bytesWritten);
		const scratchFile = await streaming.file(
			segmentFileName(base, segment, ext),
			mimeForFormat(format)
		);
		return {
			scratchPath: streaming.storageKey ?? scratchFile.name,
			fileName: scratchFile.name,
			scratchFile,
			wasLossless: true,
			reason:
				snappedStart !== null && snappedStart !== segment.start
					? `Snapped to ${snappedStart.toFixed(3)}s for lossless.`
					: 'Stream copy.',
			estimatedBytes: scratchFile.size
		};
	} catch (e) {
		await streaming.discard().catch(() => undefined);
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		if (e instanceof UnsupportedStreamCopyError) throw e;
		throw e;
	} finally {
		try {
			input?.dispose?.();
		} catch {
			// ignore
		}
	}
}

async function exportSingleTranscode(
	source: QuickCutSource,
	segment: QuickCutSegment,
	signal?: AbortSignal,
	onProgress?: LocalExportProgress
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const selectedVideo = getSelectedVideoStream(source);
	const selectedAudios = getSelectedAudioStreams(source);
	if (!selectedVideo && selectedAudios.length === 0) {
		throw new Error(`No tracks selected for ${source.name}.`);
	}
	const file = await resolveSourceFile(source, signal);
	const format = outputFormatForSource(source);
	const ext = extensionForFormat(format);
	const base = safeBaseName(source.name);
	const streaming = await createStreamingOutputTarget(signal);
	let input: Input | null = null;
	try {
		input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		for (const aud of selectedAudios) await ensureAc3DecoderForCodec(aud.codec);
		if (selectedVideo) await ensureAc3DecoderForCodec(selectedVideo.codec);
		const hasVideo = selectedVideo !== null;
		const hasAudio = selectedAudios.length > 0;
		const conversion = await Conversion.init({
			input,
			output: new Output({ format, target: streaming.target }),
			trim: { start: segment.start, end: segment.end },
			video: hasVideo ? { forceTranscode: true } : { discard: true },
			audio: hasAudio ? { forceTranscode: true } : { discard: true }
		});
		if (!conversion.isValid) {
			await streaming.discard();
			throw new Error('Transcode conversion not valid.');
		}
		conversion.onProgress = (fraction) =>
			onProgress?.(Math.min(1, Math.max(0, fraction)), streaming.bytesWritten);
		onProgress?.(0, streaming.bytesWritten);
		if (signal) {
			const abort = () => void conversion.cancel().catch(() => undefined);
			signal.addEventListener('abort', abort, { once: true });
			try {
				await conversion.execute();
			} finally {
				signal.removeEventListener('abort', abort);
			}
		} else {
			await conversion.execute();
		}
		onProgress?.(1, streaming.bytesWritten);
		const scratchFile = await streaming.file(
			segmentFileName(base, segment, ext),
			mimeForFormat(format)
		);
		return {
			scratchPath: streaming.storageKey ?? scratchFile.name,
			fileName: scratchFile.name,
			scratchFile,
			wasLossless: false,
			reason: 'Exact cut required re-encoding.',
			estimatedBytes: scratchFile.size
		};
	} catch (e) {
		await streaming.discard().catch(() => undefined);
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		throw e;
	} finally {
		try {
			input?.dispose?.();
		} catch {
			// ignore
		}
	}
}

async function exportMergedAudioStreamCopy(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	preflight: PreflightResult,
	signal?: AbortSignal,
	onProgress?: LocalExportProgress
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const sourceById = new Map(sources.map((source) => [source.id, source]));
	const format = preflight.outputFormat;
	const streaming = await createStreamingOutputTarget(signal);
	const output = new Output({ format, target: streaming.target });
	const inputs: Input[] = [];
	let audioSource: EncodedAudioPacketSource | null = null;
	let expectedCodec: AudioCodec | null = null;
	let sequenceNumber = 0;
	let outputTime = 0;
	const totalDuration = segments.reduce(
		(total, segment) => total + Math.max(0, segment.end - segment.start),
		0
	);
	try {
		onProgress?.(0, streaming.bytesWritten);
		for (const segment of segments) {
			throwIfAborted(signal);
			const source = sourceById.get(segment.sourceId);
			if (!source) throw new Error(`Source missing for segment ${segment.id}.`);
			const file = await resolveSourceFile(source, signal);
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
			inputs.push(input);
			const selectedAudios = getSelectedAudioStreams(source);
			if (selectedAudios.length === 0)
				throw new UnsupportedStreamCopyError(`No audio track selected for ${source.name}.`);
			const selIdx = selectedAudios[0]!.index;
			const audioTracks = await input.getAudioTracks().catch(() => []);
			const track = audioTracks[selIdx] ?? (await input.getPrimaryAudioTrack().catch(() => null));
			if (!track) throw new UnsupportedStreamCopyError(`No audio track for ${source.name}.`);
			const codec = await track.getCodec();
			if (!codec || !format.getSupportedAudioCodecs().includes(codec)) {
				throw new UnsupportedStreamCopyError(`Audio codec cannot be copied from ${source.name}.`);
			}
			if (!audioSource) {
				expectedCodec = codec;
				audioSource = new EncodedAudioPacketSource(codec);
				output.addAudioTrack(audioSource);
				await output.start();
			} else if (codec !== expectedCodec) {
				throw new UnsupportedStreamCopyError('Audio codec mismatch during merge.');
			}
			const sink = new EncodedPacketSink(track);
			const first = await sink.getPacket(segment.start);
			if (!first) throw new UnsupportedStreamCopyError(`No audio packet at ${segment.start}s.`);
			const duration = segment.end - segment.start;
			const packetEnd = first.timestamp + duration;
			const last = await sink.getPacket(Math.max(first.timestamp, packetEnd - Number.EPSILON));
			const afterLast = last ? await sink.getNextPacket(last) : undefined;
			const decoderConfig = await track.getDecoderConfig();
			let firstOutputPacket = true;
			let pending: typeof first | null = null;
			const addPacket = async (packet: typeof first, nextTimestamp: number): Promise<void> => {
				const timestamp = packet.timestamp - first.timestamp;
				if (timestamp < 0 || timestamp >= duration) return;
				const sourceDuration =
					packet.duration > 0 ? packet.duration : Math.max(0, nextTimestamp - packet.timestamp);
				const packetDuration = Math.min(sourceDuration, Math.max(0, duration - timestamp));
				if (packetDuration <= 0) return;
				await audioSource!.add(
					packet.clone({
						timestamp: outputTime + timestamp,
						duration: packetDuration,
						sequenceNumber: sequenceNumber++
					}),
					{ decoderConfig: firstOutputPacket ? (decoderConfig ?? undefined) : undefined }
				);
				firstOutputPacket = false;
				onProgress?.(
					totalDuration > 0
						? Math.min(1, (outputTime + timestamp + packetDuration) / totalDuration)
						: 1,
					streaming.bytesWritten
				);
			};
			for await (const packet of sink.packets(first, afterLast ?? undefined)) {
				throwIfAborted(signal);
				if (pending) await addPacket(pending, packet.timestamp);
				if (packet.timestamp - first.timestamp >= duration) {
					pending = null;
					break;
				}
				pending = packet;
			}
			if (pending) await addPacket(pending, first.timestamp + duration);
			if (firstOutputPacket) {
				throw new UnsupportedStreamCopyError(`No audio packets copied from ${source.name}.`);
			}
			outputTime += duration;
		}
		if (!audioSource) throw new UnsupportedStreamCopyError('No audio tracks to merge.');
		audioSource.close();
		await output.finalize();
		const scratchFile = await streaming.file(
			mergedFileName(sources, extensionForFormat(format)),
			mimeForFormat(format)
		);
		onProgress?.(1, scratchFile.size);
		return {
			scratchPath: streaming.storageKey ?? scratchFile.name,
			fileName: scratchFile.name,
			scratchFile,
			wasLossless: true,
			reason: 'Merged audio packet copy.',
			estimatedBytes: scratchFile.size
		};
	} catch (error) {
		if (output.state === 'started') await output.cancel().catch(() => undefined);
		await streaming.discard().catch(() => undefined);
		throw error;
	} finally {
		for (const input of inputs) input.dispose?.();
	}
}

async function exportMergedStreamCopy(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	preflight: PreflightResult,
	signal?: AbortSignal,
	onProgress?: LocalExportProgress
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const sourceById = new Map(sources.map((s) => [s.id, s]));
	const firstSource = sourceById.get(segments[0]!.sourceId)!;
	const format = preflight.outputFormat;
	const ext = extensionForFormat(format);
	const streaming = await createStreamingOutputTarget(signal);
	const output = new Output({ format, target: streaming.target });
	const firstFile = await resolveSourceFile(firstSource, signal);
	const firstInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(firstFile) });
	const firstSelVideo = getSelectedVideoStream(firstSource);
	if (!firstSelVideo) {
		await streaming.discard();
		firstInput.dispose?.();
		throw new UnsupportedStreamCopyError('No video track selected for merge.');
	}
	const firstVideoTracks = await firstInput.getVideoTracks().catch(() => []);
	const videoTrack =
		firstVideoTracks[firstSelVideo.index] ??
		(await firstInput.getPrimaryVideoTrack().catch(() => null));
	if (!videoTrack) {
		await streaming.discard();
		firstInput.dispose?.();
		throw new UnsupportedStreamCopyError('No video track for merge.');
	}
	const videoCodec = await videoTrack.getCodec();
	if (!videoCodec) {
		await streaming.discard();
		firstInput.dispose?.();
		throw new UnsupportedStreamCopyError('Cannot determine video codec.');
	}
	// SAFETY: validated shape before cast
	const maybeVideoCodec = videoCodec as VideoCodec;
	const supported = format.getSupportedVideoCodecs();
	if (!supported.includes(maybeVideoCodec)) {
		await streaming.discard();
		firstInput.dispose?.();
		throw new UnsupportedStreamCopyError('Codec not supported in container.');
	}
	const videoSource = new EncodedVideoPacketSource(maybeVideoCodec);
	const fps = firstSource.fps;
	if (fps === null)
		throw new UnsupportedStreamCopyError(
			'Unknown FPS cannot be used for lossless stream-copy; requires re-encode.'
		);
	const rotation = videoTrack.rotation;
	output.addVideoTrack(videoSource, { frameRate: fps, rotation });
	const firstSelAudios = getSelectedAudioStreams(firstSource);
	let audioTrack: Awaited<ReturnType<Input['getPrimaryAudioTrack']>> | null = null;
	let audioSource: EncodedAudioPacketSource | null = null;
	let audioCodec: string | null = null;
	if (firstSelAudios.length > 0) {
		const firstAudioTracks = await firstInput.getAudioTracks().catch(() => []);
		audioTrack =
			firstAudioTracks[firstSelAudios[0]!.index] ??
			(await firstInput.getPrimaryAudioTrack().catch(() => null));
		if (audioTrack) {
			audioCodec = await audioTrack.getCodec();
			if (audioCodec) {
				// SAFETY: validated shape before cast
				const maybeAudioCodec = audioCodec as AudioCodec;
				audioSource = new EncodedAudioPacketSource(maybeAudioCodec);
				output.addAudioTrack(audioSource);
			}
		} else {
			await streaming.discard();
			firstInput.dispose?.();
			throw new UnsupportedStreamCopyError('Audio track missing for merge.');
		}
	} else {
		const anySelectedAudio = sources.some((s) => getSelectedAudioStreams(s).length > 0);
		if (anySelectedAudio) {
			await streaming.discard();
			firstInput.dispose?.();
			throw new UnsupportedStreamCopyError(
				'Audio missing in first source but present in others; requires transcode.'
			);
		}
	}
	const onAbort = () => {
		if (output.state === 'started') void output.cancel();
	};
	signal?.addEventListener('abort', onAbort, { once: true });
	let muxedTime = 0;
	let videoSeq = 0;
	let audioSeq = 0;
	const totalDuration = segments.reduce((total, segment) => {
		const snappedStart = getSnapForSegment(preflight, segment.id) ?? segment.start;
		return total + Math.max(0, segment.end - snappedStart);
	}, 0);
	const inputsToDispose: Input[] = [firstInput];
	try {
		await output.start();
		onProgress?.(0, streaming.bytesWritten);
		for (const seg of segments) {
			throwIfAborted(signal);
			const src = sourceById.get(seg.sourceId)!;
			const snap = getSnapForSegment(preflight, seg.id);
			const start = snap ?? seg.start;
			const duration = seg.end - start;
			if (duration <= 0) continue;
			let segInput: Input | null = null;
			let segVideoTrack = videoTrack;
			let segAudioTrack = audioTrack;
			if (src.id !== firstSource.id) {
				const f = await resolveSourceFile(src, signal);
				segInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(f) });
				inputsToDispose.push(segInput);
				const selVideo = getSelectedVideoStream(src);
				if (!selVideo)
					throw new UnsupportedStreamCopyError(`No video track selected for ${src.name}`);
				const vTracks = await segInput.getVideoTracks().catch(() => []);
				segVideoTrack =
					vTracks[selVideo.index] ?? (await segInput.getPrimaryVideoTrack().catch(() => null));
				if (!segVideoTrack)
					throw new UnsupportedStreamCopyError(`No video track for source ${src.name}`);
				const selAudios = getSelectedAudioStreams(src);
				if (selAudios.length > 0) {
					const aTracks = await segInput.getAudioTracks().catch(() => []);
					segAudioTrack =
						aTracks[selAudios[0]!.index] ??
						(await segInput.getPrimaryAudioTrack().catch(() => null));
				} else segAudioTrack = null;
				// SAFETY: validated shape before cast
				const vc = (await segVideoTrack.getCodec()) as VideoCodec | null;
				if (vc !== maybeVideoCodec)
					throw new UnsupportedStreamCopyError('Codec mismatch during merge.');
				if (!segAudioTrack && audioSource)
					throw new UnsupportedStreamCopyError('Audio missing in source, requires transcode.');
				if (segAudioTrack && !audioSource)
					throw new UnsupportedStreamCopyError(
						'Audio present in source but not in first, requires transcode.'
					);
			}
			const sink = new EncodedPacketSink(segVideoTrack!);
			const tolerance = KEYFRAME_TOLERANCE_SECONDS;
			const firstPacket = await sink.getKeyPacket(start + tolerance, { verifyKeyPackets: true });
			if (!firstPacket || Math.abs(firstPacket.timestamp - start) > tolerance) {
				throw new UnsupportedStreamCopyError(
					`Start ${start.toFixed(3)}s not on keyframe for ${src.name}`
				);
			}
			const actualEnd = firstPacket.timestamp + duration;
			const last = await sink.getPacket(
				Math.max(firstPacket.timestamp, actualEnd - Number.EPSILON)
			);
			const endPacket = last ? await sink.getNextPacket(last) : undefined;
			const decoderConfig = await segVideoTrack!.getDecoderConfig();
			let firstPkt = true;
			let lastDuration = fps && fps > 0 ? 1 / fps : 0;
			for await (const packet of sink.packets(firstPacket, endPacket ?? undefined)) {
				throwIfAborted(signal);
				const ts = packet.timestamp - firstPacket.timestamp;
				if (ts < -tolerance || ts >= duration) continue;
				const pd = Math.min(
					packet.duration > 0 ? packet.duration : lastDuration,
					Math.max(0, duration - ts)
				);
				if (pd <= 0) continue;
				const maybeConfig = firstPkt ? decoderConfig : undefined;
				// Only attach decoder config if it changed; mediabunny handles same config
				await videoSource.add(
					packet.clone({
						timestamp: muxedTime + Math.max(0, ts),
						duration: pd,
						sequenceNumber: videoSeq++
					}),
					{ decoderConfig: maybeConfig ?? undefined }
				);
				onProgress?.(
					totalDuration > 0 ? Math.min(1, (muxedTime + Math.max(0, ts) + pd) / totalDuration) : 1,
					streaming.bytesWritten
				);
				firstPkt = false;
				lastDuration = pd;
			}
			if (segAudioTrack && audioSource && audioCodec) {
				const audioSink = new EncodedPacketSink(segAudioTrack);
				const aFirst = await audioSink.getPacket(start);
				if (aFirst) {
					const aLast = await audioSink.getPacket(
						Math.max(aFirst.timestamp, start + duration - Number.EPSILON)
					);
					const aAfterLast = aLast ? await audioSink.getNextPacket(aLast) : undefined;
					const aDecoder = await segAudioTrack.getDecoderConfig();
					let aFirstPkt = true;
					let pending: typeof aFirst | null = null;
					const endTs = start + duration;
					const addAudio = async (pkt: typeof aFirst, nextTs: number) => {
						const ts = pkt.timestamp - start;
						if (ts >= duration || pkt.timestamp >= endTs) return;
						const outputTimestamp = Math.max(0, ts);
						const dur = pkt.duration > 0 ? pkt.duration : Math.max(0, nextTs - pkt.timestamp);
						const pd = Math.min(dur, Math.max(0, duration - outputTimestamp));
						if (pd <= 0) return;
						await audioSource!.add(
							pkt.clone({
								timestamp: muxedTime + outputTimestamp,
								duration: pd,
								sequenceNumber: audioSeq++
							}),
							{ decoderConfig: aFirstPkt ? (aDecoder ?? undefined) : undefined }
						);
						aFirstPkt = false;
					};
					for await (const pkt of audioSink.packets(aFirst, aAfterLast ?? undefined)) {
						throwIfAborted(signal);
						if (pending) await addAudio(pending, pkt.timestamp);
						if (pkt.timestamp >= endTs) {
							pending = null;
							break;
						}
						pending = pkt;
					}
					if (pending) await addAudio(pending, endTs);
					if (aFirstPkt) {
						throw new UnsupportedStreamCopyError(
							`No audio packets copied from ${src.name}; requires re-encoding.`
						);
					}
				} else {
					throw new UnsupportedStreamCopyError(
						`No audio packet at ${start.toFixed(3)}s for ${src.name}; requires re-encoding.`
					);
				}
			} else if (audioSource) {
				// Audio expected but missing in this segment; insert silence by advancing muxedTime without audio packets (explicit silence)
				// For stream-copy, missing audio is an error, but we already checked
			}
			muxedTime += duration;
		}
		videoSource.close();
		audioSource?.close();
		await output.finalize();
		const scratchFile = await streaming.file(mergedFileName(sources, ext), mimeForFormat(format));
		onProgress?.(1, scratchFile.size);
		return {
			scratchPath: streaming.storageKey ?? scratchFile.name,
			fileName: scratchFile.name,
			scratchFile,
			wasLossless: true,
			reason: 'Merged stream copy (packet concat).',
			estimatedBytes: scratchFile.size
		};
	} catch (e) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// ignore
		}
		await streaming.discard().catch(() => undefined);
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		throw e;
	} finally {
		signal?.removeEventListener('abort', onAbort);
		for (const inp of inputsToDispose) {
			try {
				inp.dispose?.();
			} catch {
				// ignore
			}
		}
	}
}

async function exportMergedAudioTranscode(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	preflight: PreflightResult,
	signal?: AbortSignal,
	onProgress?: (progress: QuickCutExportProgress) => void
): Promise<QuickCutScratchArtifact> {
	const sourceById = new Map(sources.map((source) => [source.id, source]));
	const temporary: Array<{
		source: QuickCutSource;
		segment: QuickCutSegment;
		discard(): Promise<void>;
	}> = [];
	const startedAt = Date.now();
	try {
		for (let index = 0; index < segments.length; index++) {
			throwIfAborted(signal);
			const segment = segments[index]!;
			const source = sourceById.get(segment.sourceId);
			if (!source) throw new Error(`Source missing for segment ${segment.id}.`);
			const sourceFile = await resolveSourceFile(source, signal);
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(sourceFile) });
			const stream = await createStreamingOutputTarget(signal);
			try {
				await ensureAc3DecoderForCodec(source.audioCodec);
				const conversion = await Conversion.init({
					input,
					output: new Output({ format: preflight.outputFormat, target: stream.target }),
					trim: { start: segment.start, end: segment.end },
					video: { discard: true },
					audio: { forceTranscode: true }
				});
				if (!conversion.isValid)
					throw new Error(`Audio conversion is not valid for ${source.name}.`);
				conversion.onProgress = (fraction) => {
					const elapsed = Date.now() - startedAt;
					const overallFraction = (index + Math.min(1, Math.max(0, fraction))) / segments.length;
					onProgress?.({
						phase: 'transcoding',
						segmentIndex: index + 1,
						totalSegments: segments.length,
						bytesWritten:
							temporary.reduce((total, item) => total + item.source.size, 0) + stream.bytesWritten,
						elapsedMs: elapsed,
						etaMs:
							overallFraction > 0
								? Math.round((elapsed / overallFraction) * (1 - overallFraction))
								: null,
						fraction: overallFraction
					});
				};
				const onAbort = (): void => void conversion.cancel().catch(() => undefined);
				signal?.addEventListener('abort', onAbort, { once: true });
				try {
					await conversion.execute();
				} finally {
					signal?.removeEventListener('abort', onAbort);
				}
				const extension = extensionForFormat(preflight.outputFormat);
				const file = await stream.file(
					`quick-cut-audio-${index}.${extension}`,
					mimeForFormat(preflight.outputFormat)
				);
				const converted = await probeSourceFile(file, undefined, undefined, signal);
				const duration = Math.min(segment.end - segment.start, converted.duration);
				if (duration <= 0)
					throw new Error(`Audio conversion produced no duration for ${source.name}.`);
				temporary.push({
					source: converted,
					segment: { ...segment, sourceId: converted.id, start: 0, end: duration },
					discard: stream.discard
				});
			} catch (error) {
				await stream.discard().catch(() => undefined);
				throw error;
			} finally {
				input.dispose?.();
			}
			const elapsed = Date.now() - startedAt;
			onProgress?.({
				phase: 'transcoding',
				segmentIndex: index + 1,
				totalSegments: segments.length,
				bytesWritten: temporary.reduce((total, item) => total + item.source.size, 0),
				elapsedMs: elapsed,
				etaMs: Math.round((elapsed / (index + 1)) * (segments.length - index - 1)),
				fraction: (index + 1) / segments.length
			});
		}
		const artifact = await exportMergedAudioStreamCopy(
			temporary.map((item) => item.source),
			temporary.map((item) => item.segment),
			preflight,
			signal
		);
		artifact.wasLossless = false;
		artifact.reason = 'Merged with sample-accurate audio re-encoding.';
		return artifact;
	} finally {
		for (const item of temporary) await item.discard().catch(() => undefined);
	}
}

async function exportMergedTranscode(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	preflight: PreflightResult,
	signal?: AbortSignal,
	onProgress?: (p: QuickCutExportProgress) => void
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const enabledSourceIds = new Set(segments.map((segment) => segment.sourceId));
	const hasVideo = sources.some(
		(source) => enabledSourceIds.has(source.id) && getSelectedVideoStream(source) !== null
	);
	if (!hasVideo) {
		return exportMergedAudioTranscode(sources, segments, preflight, signal, onProgress);
	}
	const sourceById = new Map(sources.map((s) => [s.id, s]));
	const format = preflight.outputFormat;
	const ext = extensionForFormat(format);
	const finalStreaming = await createStreamingOutputTarget(signal);
	const finalOutput = new Output({ format, target: finalStreaming.target });
	const enabledIds = new Set(segments.map((s) => s.sourceId));
	const hasAudio = sources
		.filter((s) => enabledIds.has(s.id))
		.some((s) => getSelectedAudioStreams(s).length > 0);
	const videoCodec: VideoCodec = 'avc';
	const audioCodec: AudioCodec = 'aac';
	const firstFps = sources.find((s) => enabledIds.has(s.id) && s.fps && s.fps > 0)?.fps ?? null;
	const videoSource = new EncodedVideoPacketSource(videoCodec);
	finalOutput.addVideoTrack(videoSource, { frameRate: firstFps > 0 ? firstFps : undefined });
	let audioSource: EncodedAudioPacketSource | null = null;
	if (hasAudio) {
		audioSource = new EncodedAudioPacketSource(audioCodec);
		finalOutput.addAudioTrack(audioSource);
	}
	const startTime = Date.now();
	let muxedTime = 0;
	let videoSeq = 0;
	let audioSeq = 0;
	const onAbort = () => {
		if (finalOutput.state === 'started') void finalOutput.cancel();
	};
	signal?.addEventListener('abort', onAbort, { once: true });
	const tempScratches: Array<{ file: File; path: string; discard: () => Promise<void> }> = [];
	try {
		await finalOutput.start();
		for (let idx = 0; idx < segments.length; idx++) {
			throwIfAborted(signal);
			const seg = segments[idx]!;
			const src = sourceById.get(seg.sourceId)!;
			const file = await resolveSourceFile(src, signal);
			const selVideo = getSelectedVideoStream(src);
			const selAudios = getSelectedAudioStreams(src);
			for (const a of selAudios) await ensureAc3DecoderForCodec(a.codec);
			if (selVideo) await ensureAc3DecoderForCodec(selVideo.codec);
			const tempStreaming = await createStreamingOutputTarget(signal);
			const tempInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
			const tempConversion = await Conversion.init({
				input: tempInput,
				output: new Output({ format: new Mp4OutputFormat(), target: tempStreaming.target }),
				trim: { start: seg.start, end: seg.end },
				video: selVideo ? { forceTranscode: true } : { discard: true },
				audio: selAudios.length > 0 ? { forceTranscode: false } : { discard: true }
			});
			if (!tempConversion.isValid) {
				await tempStreaming.discard();
				try {
					tempInput.dispose?.();
				} catch {
					// ignore
				}
				throw new Error(`Transcode not valid for segment ${seg.id.slice(0, 6)}`);
			}
			tempConversion.onProgress = (fraction) => {
				const elapsed = Date.now() - startTime;
				const overallFraction = (idx + Math.min(1, Math.max(0, fraction))) / segments.length;
				onProgress?.({
					phase: 'transcoding',
					segmentIndex: idx + 1,
					totalSegments: segments.length,
					bytesWritten:
						tempScratches.reduce((total, item) => total + item.file.size, 0) +
						tempStreaming.bytesWritten,
					elapsedMs: elapsed,
					etaMs:
						overallFraction > 0
							? Math.round((elapsed / overallFraction) * (1 - overallFraction))
							: null,
					fraction: overallFraction
				});
			};
			const abortConversion = (): void => void tempConversion.cancel().catch(() => undefined);
			signal?.addEventListener('abort', abortConversion, { once: true });
			try {
				await tempConversion.execute();
			} finally {
				signal?.removeEventListener('abort', abortConversion);
			}
			try {
				tempInput.dispose?.();
			} catch {
				// ignore
			}
			const tempFile = await tempStreaming.file(`temp-${idx}.mp4`, 'video/mp4');
			tempScratches.push({
				file: tempFile,
				path: tempFile.name,
				discard: () => tempStreaming.discard()
			});
			const segInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(tempFile) });
			const vTrack = await segInput.getPrimaryVideoTrack();
			const aTrack = await segInput.getPrimaryAudioTrack();
			if (!vTrack) {
				segInput.dispose?.();
				throw new Error(`No video track in transcoded segment ${src.name}`);
			}
			// Verify the temp file's codec is the forced one
			// SAFETY: validated shape before cast
			const tempCodec = (await vTrack.getCodec()) as VideoCodec | null;
			if (tempCodec !== videoCodec) {
				segInput.dispose?.();
				throw new Error(`Temp codec mismatch: expected ${videoCodec}, got ${tempCodec}`);
			}
			const vSink = new EncodedPacketSink(vTrack);
			const vDec = await vTrack.getDecoderConfig();
			let first = true;
			for await (const pkt of vSink.packets()) {
				throwIfAborted(signal);
				await videoSource.add(
					pkt.clone({ timestamp: muxedTime + pkt.timestamp, sequenceNumber: videoSeq++ }),
					{
						decoderConfig: first ? (vDec ?? undefined) : undefined
					}
				);
				first = false;
			}
			if (aTrack && audioSource) {
				const aSink = new EncodedPacketSink(aTrack);
				const aDec = await aTrack.getDecoderConfig();
				let aFirst = true;
				for await (const pkt of aSink.packets()) {
					throwIfAborted(signal);
					await audioSource.add(
						pkt.clone({ timestamp: muxedTime + pkt.timestamp, sequenceNumber: audioSeq++ }),
						{
							decoderConfig: aFirst ? (aDec ?? undefined) : undefined
						}
					);
					aFirst = false;
				}
			} else if (hasAudio && !aTrack) {
				// Missing audio in this segment: insert silence by just advancing time (no audio packets for this duration)
				// The audio track will have a gap, which is explicit silence
			}
			segInput.dispose?.();
			muxedTime += seg.end - seg.start;
			if (onProgress) {
				const elapsed = Date.now() - startTime;
				const fraction = (idx + 1) / segments.length;
				onProgress({
					phase: 'transcoding',
					segmentIndex: idx + 1,
					totalSegments: segments.length,
					bytesWritten: 0,
					elapsedMs: elapsed,
					etaMs: Math.round((elapsed / (idx + 1)) * (segments.length - (idx + 1))),
					fraction
				});
			}
		}
		videoSource.close();
		audioSource?.close();
		await finalOutput.finalize();
		const scratchFile = await finalStreaming.file(
			mergedFileName(sources, ext),
			mimeForFormat(format)
		);
		for (const t of tempScratches) await t.discard().catch(() => undefined);
		return {
			scratchPath: finalStreaming.storageKey ?? scratchFile.name,
			fileName: scratchFile.name,
			scratchFile,
			wasLossless: false,
			reason: 'Merged with re-encoding (incompatible streams or exact cuts).',
			estimatedBytes: scratchFile.size
		};
	} catch (e) {
		try {
			if (finalOutput.state === 'started') await finalOutput.cancel();
		} catch {
			// ignore
		}
		await finalStreaming.discard().catch(() => undefined);
		for (const t of tempScratches) await t.discard().catch(() => undefined);
		if (e instanceof DOMException && e.name === 'AbortError') throw e;
		throw e;
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
}

export async function exportSegments(
	options: QuickCutExportOptions
): Promise<QuickCutScratchArtifact[]> {
	const { sources, segments, cutMode, merge, signal, onProgress } = options;
	const enabled = segments.filter((s) => s.enabled !== false);
	if (enabled.length === 0) throw new Error('No segments to export.');
	const preflight = await preflightExport(sources, enabled, cutMode, merge);
	if (!preflight.eligible) throw new Error(preflight.reason);
	const startTime = Date.now();
	const artifacts: QuickCutScratchArtifact[] = [];
	let lastReportedFraction = 0;
	let lastReportedBytes = 0;
	const reportProgress = (
		phase: QuickCutExportProgress['phase'],
		segmentIndex: number,
		totalSegments: number,
		fraction: number,
		bytesWritten: number
	): void => {
		const boundedFraction = Math.min(1, Math.max(lastReportedFraction, fraction));
		lastReportedFraction = boundedFraction;
		lastReportedBytes = Math.max(lastReportedBytes, bytesWritten);
		const elapsedMs = Date.now() - startTime;
		onProgress?.({
			phase,
			segmentIndex,
			totalSegments,
			bytesWritten: lastReportedBytes,
			elapsedMs,
			etaMs:
				boundedFraction > 0
					? Math.max(0, Math.round((elapsedMs / boundedFraction) * (1 - boundedFraction)))
					: null,
			fraction: boundedFraction
		});
	};
	try {
		if (merge) {
			const mergedProgress =
				(phase: QuickCutExportProgress['phase']): LocalExportProgress =>
				(fraction, bytesWritten) =>
					reportProgress(
						phase,
						Math.min(enabled.length, Math.max(1, Math.ceil(fraction * enabled.length))),
						enabled.length,
						fraction,
						bytesWritten
					);
			const detailedMergedProgress = (progress: QuickCutExportProgress): void =>
				reportProgress(
					progress.phase,
					progress.segmentIndex,
					progress.totalSegments,
					progress.fraction,
					progress.bytesWritten
				);
			if (preflight.requiresTranscode) {
				const art = await exportMergedTranscode(
					sources,
					enabled,
					preflight,
					signal,
					detailedMergedProgress
				);
				artifacts.push(art);
			} else if (
				sources.find((source) => source.id === enabled[0]!.sourceId)?.keyframeState === 'audio-only'
			) {
				try {
					const art = await exportMergedAudioStreamCopy(
						sources,
						enabled,
						preflight,
						signal,
						mergedProgress('copying')
					);
					artifacts.push(art);
				} catch (error) {
					if (!(error instanceof UnsupportedStreamCopyError)) throw error;
					const art = await exportMergedTranscode(
						sources,
						enabled,
						preflight,
						signal,
						detailedMergedProgress
					);
					art.reason = `Re-encoded after lossless copy was unavailable: ${error.message}`;
					artifacts.push(art);
				}
			} else {
				try {
					const art = await exportMergedStreamCopy(
						sources,
						enabled,
						preflight,
						signal,
						mergedProgress('copying')
					);
					artifacts.push(art);
				} catch (error) {
					if (!(error instanceof UnsupportedStreamCopyError)) throw error;
					const art = await exportMergedTranscode(
						sources,
						enabled,
						preflight,
						signal,
						detailedMergedProgress
					);
					art.reason = `Re-encoded after lossless copy was unavailable: ${error.message}`;
					artifacts.push(art);
				}
			}
			reportProgress(
				artifacts.some((artifact) => !artifact.wasLossless) ? 'transcoding' : 'copying',
				enabled.length,
				enabled.length,
				1,
				artifacts[0]?.estimatedBytes ?? 0
			);
			return artifacts;
		}
		for (let i = 0; i < enabled.length; i++) {
			throwIfAborted(signal);
			const seg = enabled[i]!;
			const per = preflight.perSegment.find((p) => p.segmentId === seg.id);
			const needsTranscode = per?.requiresTranscode ?? preflight.requiresTranscode;
			const snap = preflight.snapInfo.find((s) => s.segmentId === seg.id)?.snappedStart ?? null;
			const src = sources.find((s) => s.id === seg.sourceId)!;
			const completedBytes = artifacts.reduce((sum, artifact) => sum + artifact.estimatedBytes, 0);
			const localProgress =
				(phase: QuickCutExportProgress['phase']): LocalExportProgress =>
				(fraction, bytesWritten) =>
					reportProgress(
						phase,
						i + 1,
						enabled.length,
						(i + fraction) / enabled.length,
						completedBytes + bytesWritten
					);
			let art: QuickCutScratchArtifact;
			if (needsTranscode) {
				art = await exportSingleTranscode(src, seg, signal, localProgress('transcoding'));
			} else {
				try {
					art = await exportSingleStreamCopy(src, seg, snap, signal, localProgress('copying'));
				} catch (error) {
					if (!(error instanceof UnsupportedStreamCopyError)) throw error;
					art = await exportSingleTranscode(src, seg, signal, localProgress('transcoding'));
					art.reason = `Re-encoded after lossless copy was unavailable: ${error.message}`;
				}
			}
			artifacts.push(art);
			reportProgress(
				art.wasLossless ? 'copying' : 'transcoding',
				i + 1,
				enabled.length,
				(i + 1) / enabled.length,
				artifacts.reduce((sum, artifact) => sum + artifact.estimatedBytes, 0)
			);
		}
		return artifacts;
	} catch (e) {
		for (const a of artifacts) await discardScratchFile(a.scratchPath).catch(() => undefined);
		throw e;
	}
}

export async function copyScratchToWorkspace(
	scratchFile: File,
	workspaceProjectId: string | undefined,
	fileName: string,
	signal?: AbortSignal
): Promise<{ fileName: string; relPath: string }> {
	const root = requireWorkspaceRoot();
	// Correct unique name handling
	let uniqueName = sanitizeWorkspaceFileName(fileName);
	for (let n = 2; n < 1000; n++) {
		const existsNow = await exists(
			root,
			workspaceProjectId
				? projectExportFilePath(workspaceProjectId, uniqueName)
				: exportFilePath(uniqueName)
		);
		if (!existsNow) break;
		const dot = fileName.lastIndexOf('.');
		const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
		const ext = dot > 0 ? fileName.slice(dot) : '';
		uniqueName = sanitizeWorkspaceFileName(`${stem} (${n})${ext}`);
	}
	const finalName = uniqueName;
	const writer = await openBlobWriter(
		root,
		workspaceProjectId
			? projectExportFilePath(workspaceProjectId, finalName)
			: exportFilePath(finalName)
	);
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		const stream = scratchFile.stream();
		reader = stream.getReader();
		while (true) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			if (done) break;
			if (value) await writer.write(value);
		}
		await writer.close();
	} catch (e) {
		try {
			await reader?.cancel();
		} catch {
			// ignore
		}
		// SAFETY: validated shape before cast
		await writer.abort(e as Error).catch(() => undefined);
		await removeEntry(
			root,
			workspaceProjectId
				? projectExportFilePath(workspaceProjectId, finalName)
				: exportFilePath(finalName)
		).catch(() => undefined);
		throw e;
	} finally {
		try {
			reader?.releaseLock();
		} catch {
			// ignore
		}
	}
	const relBase = workspaceProjectId
		? `${PROJECTS_DIR}/${workspaceProjectId}/${EXPORTS_DIR}`
		: EXPORTS_DIR;
	return { fileName: finalName, relPath: `${relBase}/${finalName}` };
}
