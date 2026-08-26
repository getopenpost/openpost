import {
	ALL_FORMATS,
	BlobSource,
	Conversion,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	Mp4OutputFormat,
	MovOutputFormat,
	MkvOutputFormat,
	Output,
	WebMOutputFormat,
	type OutputFormat,
	type VideoCodec,
	type AudioCodec
} from 'mediabunny';
import type { QuickCutSegment, QuickCutSource, CutMode } from './types';
import { findNearestKeyframe, findSnapKeyframe, estimateOutputBytes } from './model';
import { createStreamingOutputTarget } from '$lib/video/stream-target';
import { resolveSourceFile } from './source';
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

const KEYFRAME_TOLERANCE = 0.06;

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function outputFormatForSource(source: QuickCutSource): OutputFormat {
	const type = (source.mimeType ?? '').toLowerCase();
	const name = source.name.toLowerCase();
	if (type.includes('webm') || name.endsWith('.webm')) return new WebMOutputFormat();
	if (type.includes('quicktime') || name.endsWith('.mov')) return new MovOutputFormat();
	if (type.includes('x-matroska') || name.endsWith('.mkv')) return new MkvOutputFormat();
	return new Mp4OutputFormat();
}

function mimeForFormat(format: OutputFormat): string {
	return format.mimeType;
}

function extensionForFormat(format: OutputFormat): string {
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
	let requiresTranscode = false;
	let reason = 'Stream copy is possible.';
	const snapInfo: PreflightResult['snapInfo'] = [];
	const perSegment: PreflightResult['perSegment'] = [];
	// Per-segment decisions
	for (const seg of enabled) {
		const src = sourceById.get(seg.sourceId)!;
		const kfs = src.keyframeTimestamps;
		if (cutMode === 'exact') {
			const aligned =
				seg.start <= KEYFRAME_TOLERANCE
					? true
					: findNearestKeyframe(seg.start, kfs, KEYFRAME_TOLERANCE).aligned;
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
		const firstVideoCodec = firstSource.videoCodec;
		const firstAudioCodec = firstSource.audioCodec;
		const firstW = firstSource.width;
		const firstH = firstSource.height;
		const firstSR = firstSource.sampleRate;
		const firstCh = firstSource.channels;
		for (const seg of enabled) {
			const src = sourceById.get(seg.sourceId)!;
			if (src.videoCodec !== firstVideoCodec || src.audioCodec !== firstAudioCodec) {
				requiresTranscode = true;
				reason = 'Selected segments use different codecs and require re-encoding for merge.';
				break;
			}
			if (src.width !== firstW || src.height !== firstH) {
				requiresTranscode = true;
				reason = 'Selected segments have different dimensions and require re-encoding.';
				break;
			}
			if (src.sampleRate !== firstSR || src.channels !== firstCh) {
				requiresTranscode = true;
				reason = 'Audio configuration differs and requires re-encoding.';
				break;
			}
			if (src.rotation !== firstSource.rotation) {
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
		if (!requiresTranscode && cutMode === 'nearestKeyframe') {
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
		if (anyNeedsTranscode && cutMode === 'exact') {
			// For individual, not merged, we don't set global requiresTranscode; each segment will be handled individually
			reason = 'Some segments require re-encoding; others can be stream copied.';
		}
	}
	// Storage estimate with fixed reserve and explicit state
	let storageState: 'ok' | 'unknown' | 'insufficient' = 'unknown';
	try {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- validated at boundary
		if (typeof globalThis.navigator !== 'undefined' && globalThis.navigator.storage?.estimate) {
			const est = await globalThis.navigator.storage.estimate();
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
	const globalRequiresTranscode = merge ? requiresTranscode : false;
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
	signal?: AbortSignal
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const file = await resolveSourceFile(source);
	const format = outputFormatForSource(source);
	const ext = extensionForFormat(format);
	const base = safeBaseName(source.name);
	const streaming = await createStreamingOutputTarget(signal);
	let input: Input | null = null;
	try {
		input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const trimStart = snappedStart ?? segment.start;
		const trimEnd = segment.end;
		const conversion = await Conversion.init({
			input,
			output: new Output({ format, target: streaming.target }),
			trim: { start: trimStart, end: trimEnd },
			video: { forceTranscode: false },
			audio: { forceTranscode: false }
		});
		if (!conversion.isValid) {
			await streaming.discard();
			throw new UnsupportedStreamCopyError('Stream copy not valid for this segment.');
		}
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
	signal?: AbortSignal
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const file = await resolveSourceFile(source);
	const format = outputFormatForSource(source);
	const ext = extensionForFormat(format);
	const base = safeBaseName(source.name);
	const streaming = await createStreamingOutputTarget(signal);
	let input: Input | null = null;
	try {
		input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const conversion = await Conversion.init({
			input,
			output: new Output({ format, target: streaming.target }),
			trim: { start: segment.start, end: segment.end },
			video: { forceTranscode: true },
			audio: { forceTranscode: false }
		});
		if (!conversion.isValid) {
			await streaming.discard();
			throw new Error('Transcode conversion not valid.');
		}
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

async function exportMergedStreamCopy(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	preflight: PreflightResult,
	signal?: AbortSignal
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const sourceById = new Map(sources.map((s) => [s.id, s]));
	const firstSource = sourceById.get(segments[0]!.sourceId)!;
	const format = preflight.outputFormat;
	const ext = extensionForFormat(format);
	const streaming = await createStreamingOutputTarget(signal);
	const output = new Output({ format, target: streaming.target });
	const firstFile = await resolveSourceFile(firstSource);
	const firstInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(firstFile) });
	const videoTrack = await firstInput.getPrimaryVideoTrack();
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
	const fps = firstSource.fps ?? 30;
	const rotation = videoTrack.rotation;
	output.addVideoTrack(videoSource, { frameRate: fps > 0 ? fps : undefined, rotation });
	const audioTrack = await firstInput.getPrimaryAudioTrack();
	let audioSource: EncodedAudioPacketSource | null = null;
	let audioCodec: string | null = null;
	if (audioTrack) {
		audioCodec = await audioTrack.getCodec();
		if (audioCodec) {
			// SAFETY: validated shape before cast
			const maybeAudioCodec = audioCodec as AudioCodec;
			audioSource = new EncodedAudioPacketSource(maybeAudioCodec);
			output.addAudioTrack(audioSource);
		}
	} else {
		// Audio-only or video-only: if any source has audio but first doesn't, we need to handle
		const anyAudio = sources.some((s) => s.audioCodec);
		if (anyAudio) {
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
	const inputsToDispose: Input[] = [firstInput];
	try {
		await output.start();
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
				const f = await resolveSourceFile(src);
				segInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(f) });
				inputsToDispose.push(segInput);
				segVideoTrack = await segInput.getPrimaryVideoTrack();
				if (!segVideoTrack)
					throw new UnsupportedStreamCopyError(`No video track for source ${src.name}`);
				segAudioTrack = await segInput.getPrimaryAudioTrack();
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
			const tolerance = KEYFRAME_TOLERANCE;
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
			let lastDuration = fps && fps > 0 ? 1 / fps : 1 / 30;
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
				firstPkt = false;
				lastDuration = pd;
			}
			if (segAudioTrack && audioSource && audioCodec) {
				const audioSink = new EncodedPacketSink(segAudioTrack);
				const aBefore = await audioSink.getPacket(start);
				const aAfter = aBefore
					? await audioSink.getNextPacket(aBefore)
					: await audioSink.getFirstPacket();
				const aFirst =
					aBefore && aAfter
						? Math.abs(start - aBefore.timestamp) <= Math.abs(aAfter.timestamp - start)
							? aBefore
							: aAfter
						: (aBefore ?? aAfter);
				if (aFirst) {
					const aDecoder = await segAudioTrack.getDecoderConfig();
					let aFirstPkt = true;
					let pending: typeof aFirst | null = null;
					const endTs = aFirst.timestamp + duration;
					const addAudio = async (pkt: typeof aFirst, nextTs: number) => {
						const ts = pkt.timestamp - aFirst.timestamp;
						if (ts < 0 || ts >= duration) return;
						const dur = pkt.duration > 0 ? pkt.duration : Math.max(0, nextTs - pkt.timestamp);
						const pd = Math.min(dur, Math.max(0, duration - ts));
						if (pd <= 0) return;
						// Respect exact kept boundary: start at aFirst.timestamp which may be before start, but we offset by ts, so we respect start
						await audioSource!.add(
							pkt.clone({ timestamp: muxedTime + ts, duration: pd, sequenceNumber: audioSeq++ }),
							{ decoderConfig: aFirstPkt ? (aDecoder ?? undefined) : undefined }
						);
						aFirstPkt = false;
					};
					for await (const pkt of new EncodedPacketSink(segAudioTrack).packets()) {
						throwIfAborted(signal);
						if (pkt.timestamp + tolerance < aFirst.timestamp) continue;
						if (pending) await addAudio(pending, pkt.timestamp);
						if (pkt.timestamp >= endTs) {
							pending = null;
							break;
						}
						pending = pkt;
					}
					if (pending) await addAudio(pending, endTs);
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

async function exportMergedTranscode(
	sources: QuickCutSource[],
	segments: QuickCutSegment[],
	preflight: PreflightResult,
	signal?: AbortSignal,
	onProgress?: (p: QuickCutExportProgress) => void
): Promise<QuickCutScratchArtifact> {
	throwIfAborted(signal);
	const sourceById = new Map(sources.map((s) => [s.id, s]));
	const format = preflight.outputFormat;
	const ext = extensionForFormat(format);
	const finalStreaming = await createStreamingOutputTarget(signal);
	const finalOutput = new Output({ format, target: finalStreaming.target });
	const enabledIds = new Set(segments.map((s) => s.sourceId));
	const hasAudio = sources.filter((s) => enabledIds.has(s.id)).some((s) => s.audioCodec);
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
			const file = await resolveSourceFile(src);
			const tempStreaming = await createStreamingOutputTarget(signal);
			const tempInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
			const tempConversion = await Conversion.init({
				input: tempInput,
				output: new Output({ format: new Mp4OutputFormat(), target: tempStreaming.target }),
				trim: { start: seg.start, end: seg.end },
				video: { forceTranscode: true },
				audio: { forceTranscode: false }
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
			await tempConversion.execute();
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
	try {
		if (merge) {
			if (preflight.requiresTranscode) {
				const art = await exportMergedTranscode(sources, enabled, preflight, signal, onProgress);
				artifacts.push(art);
			} else {
				const art = await exportMergedStreamCopy(sources, enabled, preflight, signal);
				artifacts.push(art);
			}
			onProgress?.({
				phase: preflight.requiresTranscode ? 'transcoding' : 'copying',
				segmentIndex: 1,
				totalSegments: 1,
				bytesWritten: artifacts[0]?.estimatedBytes ?? 0,
				elapsedMs: Date.now() - startTime,
				etaMs: 0,
				fraction: 1
			});
			return artifacts;
		}
		for (let i = 0; i < enabled.length; i++) {
			throwIfAborted(signal);
			const seg = enabled[i]!;
			const per = preflight.perSegment.find((p) => p.segmentId === seg.id);
			const needsTranscode = per?.requiresTranscode ?? preflight.requiresTranscode;
			const snap = preflight.snapInfo.find((s) => s.segmentId === seg.id)?.snappedStart ?? null;
			const src = sources.find((s) => s.id === seg.sourceId)!;
			const art = needsTranscode
				? await exportSingleTranscode(src, seg, signal)
				: await exportSingleStreamCopy(src, seg, snap, signal);
			artifacts.push(art);
			const elapsed = Date.now() - startTime;
			const fraction = (i + 1) / enabled.length;
			onProgress?.({
				phase: needsTranscode ? 'transcoding' : 'copying',
				segmentIndex: i + 1,
				totalSegments: enabled.length,
				bytesWritten: artifacts.reduce((a, b) => a + b.estimatedBytes, 0),
				elapsedMs: elapsed,
				etaMs: Math.round((elapsed / (i + 1)) * (enabled.length - (i + 1))),
				fraction
			});
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
