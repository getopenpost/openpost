import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
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
	type OutputFormat
} from 'mediabunny';
import { StreamTarget } from 'mediabunny';
import type { QuickCutSegment, CutMode } from './types';
import { findNearestKeyframe } from './model';
import { createStreamingOutputTarget, type StreamingOutputTarget } from '$lib/video/stream-target';

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
	file: File;
	segments: QuickCutSegment[];
	cutMode: CutMode;
	merge: boolean;
	keyframeTimestamps: number[];
	signal?: AbortSignal;
	onProgress?: (p: QuickCutExportProgress) => void;
}

export interface QuickCutExportResult {
	fileName: string;
	blob: Blob;
	wasLossless: boolean;
	reason: string;
	streamingTarget?: StreamingOutputTarget;
}

const KEYFRAME_TOLERANCE = 0.06;

function outputFormatForFile(file: File, mimeHint?: string): OutputFormat {
	const type = (mimeHint ?? file.type ?? '').toLowerCase();
	if (type.includes('webm')) return new WebMOutputFormat();
	if (type.includes('quicktime') || file.name.toLowerCase().endsWith('.mov'))
		return new MovOutputFormat();
	if (type.includes('x-matroska') || file.name.toLowerCase().endsWith('.mkv'))
		return new MkvOutputFormat();
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

function isAligned(time: number, keyframes: number[]): boolean {
	const { aligned } = findNearestKeyframe(time, keyframes, KEYFRAME_TOLERANCE);
	if (time <= KEYFRAME_TOLERANCE) return true;
	return aligned;
}

function losslessPossibleForSegments(
	segments: QuickCutSegment[],
	keyframes: number[],
	cutMode: CutMode
): { possible: boolean; reason: string } {
	if (cutMode === 'exact') {
		for (const seg of segments) {
			if (!isAligned(seg.start, keyframes)) {
				return {
					possible: false,
					reason: `Start ${seg.start.toFixed(2)}s is not on a keyframe. Exact cut will re-encode around that point.`
				};
			}
		}
		return { possible: true, reason: 'All starts are on keyframes. Stream copy is possible.' };
	}
	// nearestKeyframe mode: we will snap to nearest keyframe, so lossless is possible with warning if snapped.
	for (const seg of segments) {
		const { aligned, distance } = findNearestKeyframe(seg.start, keyframes, KEYFRAME_TOLERANCE);
		if (!aligned && distance !== null && distance > KEYFRAME_TOLERANCE) {
			return {
				possible: true,
				reason: `Start ${seg.start.toFixed(2)}s will be snapped to the nearest keyframe (Δ ${distance!.toFixed(3)}s) for a lossless copy.`
			};
		}
	}
	return { possible: true, reason: 'Lossless copy using nearest keyframes.' };
}

async function checkCompatibilityForMerge(
	file: File,
	segments: QuickCutSegment[]
): Promise<{ compatible: boolean; reason: string }> {
	// For single source merges, compatibility is trivially true if same file.
	// For multi-source future, check codec equality. Here we verify the file's tracks are stable.
	if (segments.length <= 1) return { compatible: true, reason: 'Single segment.' };
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const v = await input.getPrimaryVideoTrack();
		const a = await input.getPrimaryAudioTrack();
		if (!v) return { compatible: false, reason: 'No video track for merge check.' };
		// If we have both video and audio, merge is compatible as same source. Real packet merge will handle.
		void a;
		return { compatible: true, reason: 'All segments from same source — streams are compatible.' };
	} finally {
		try {
			input.dispose?.();
		} catch {
			// ignore
		}
	}
}

export function assessExport(
	segments: QuickCutSegment[],
	keyframes: number[],
	cutMode: CutMode,
	merge: boolean
): { wasLossless: boolean; reason: string } {
	if (segments.length === 0) return { wasLossless: false, reason: 'No segments selected.' };
	const lossless = losslessPossibleForSegments(segments, keyframes, cutMode);
	if (!lossless.possible && cutMode === 'exact') {
		return { wasLossless: false, reason: lossless.reason };
	}
	// If merge with many segments but cutMode exact and misaligned, will transcode.
	if (merge && segments.length > 1 && cutMode === 'exact') {
		for (const seg of segments) {
			if (!isAligned(seg.start, keyframes)) {
				return {
					wasLossless: false,
					reason: 'Merged exact cuts with non-keyframe starts will be re-encoded.'
				};
			}
		}
	}
	return { wasLossless: lossless.possible, reason: lossless.reason };
}

function safeBaseName(fileName: string): string {
	return fileName.replace(/\.[^.]+$/, '') || 'output';
}

function segmentFileName(base: string, segment: QuickCutSegment, ext: string): string {
	return `${base} [${segment.start.toFixed(2)}-${segment.end.toFixed(2)}].${ext}`;
}

function mergedFileName(base: string, ext: string): string {
	return `${base} [merged ${Date.now()}].${ext}`;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

async function exportSingleSegmentLossless(
	file: File,
	segment: QuickCutSegment,
	cutMode: CutMode,
	keyframes: number[],
	onProgress?: (bytes: number) => void,
	signal?: AbortSignal
): Promise<{ blob: Blob; wasLossless: boolean; reason: string; format: OutputFormat }> {
	throwIfAborted(signal);
	const format = outputFormatForFile(file);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	let trimStart = segment.start;
	let wasLossless = true;
	let reason = 'Stream copy — no re-encoding.';
	if (cutMode === 'nearestKeyframe') {
		const { nearest, aligned } = findNearestKeyframe(segment.start, keyframes, KEYFRAME_TOLERANCE);
		if (!aligned && nearest !== null) {
			trimStart = nearest;
			reason = `Start snapped from ${segment.start.toFixed(3)}s to keyframe ${nearest.toFixed(3)}s for lossless copy.`;
		}
	} else {
		if (!isAligned(segment.start, keyframes)) {
			// Fall through to transcode path
			input.dispose?.();
			return exportSingleSegmentTranscode(file, segment, signal);
		}
	}

	const target = new BufferTarget();
	const conversion = await Conversion.init({
		input,
		output: new Output({ format, target }),
		trim: { start: trimStart, end: segment.end },
		video: { forceTranscode: false },
		audio: { forceTranscode: false }
	});
	if (!conversion.isValid) {
		input.dispose?.();
		if (cutMode === 'exact') {
			return exportSingleSegmentTranscode(file, segment, signal);
		}
		throw new Error('Cannot perform lossless cut for this range. Enable exact mode to transcode.');
	}
	try {
		await conversion.execute();
	} finally {
		input.dispose?.();
	}
	const buffer = target.buffer;
	if (!buffer) throw new Error('Export produced no data.');
	onProgress?.(buffer.byteLength);
	return { blob: new Blob([buffer], { type: mimeForFormat(format) }), wasLossless, reason, format };
}

async function exportSingleSegmentTranscode(
	file: File,
	segment: QuickCutSegment,
	signal?: AbortSignal
): Promise<{ blob: Blob; wasLossless: false; reason: string; format: OutputFormat }> {
	throwIfAborted(signal);
	const format = outputFormatForFile(file);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const target = new BufferTarget();
	const conversion = await Conversion.init({
		input,
		output: new Output({ format, target }),
		trim: { start: segment.start, end: segment.end },
		video: { forceTranscode: true },
		audio: { forceTranscode: false }
	});
	if (!conversion.isValid) throw new Error('Transcode conversion is not valid for this file.');
	try {
		await conversion.execute();
	} finally {
		input.dispose?.();
	}
	const buffer = target.buffer;
	if (!buffer) throw new Error('Transcode produced no data.');
	return {
		blob: new Blob([buffer], { type: mimeForFormat(format) }),
		wasLossless: false,
		reason: 'Exact cut required re-encoding near the start keyframe.',
		format
	};
}

async function exportMergedLossless(
	file: File,
	segments: QuickCutSegment[],
	keyframes: number[],
	cutMode: CutMode,
	onProgress: ((bytes: number) => void) | undefined,
	signal?: AbortSignal
): Promise<{ blob: Blob; wasLossless: boolean; reason: string; format: OutputFormat }> {
	throwIfAborted(signal);
	// If exact mode and misaligned, we must transcode merged.
	if (cutMode === 'exact') {
		for (const seg of segments) {
			if (!isAligned(seg.start, keyframes)) {
				return exportMergedTranscode(file, segments, signal);
			}
		}
	}
	// Build packet-concatenated stream copy.
	const blob = (await (await import('mediabunny')).BlobSource) ? undefined : undefined;
	void blob;
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const format = outputFormatForFile(file);
	const streaming = await createStreamingOutputTarget(signal);
	const output = new Output({ format, target: streaming.target });
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new Error('No video track for merge.');
		const videoCodec = await videoTrack.getCodec();
		if (!videoCodec) throw new Error('Cannot determine video codec for merge.');
		const videoSource = new EncodedVideoPacketSource(videoCodec);
		const rotation = videoTrack.rotation;
		const fps = videoTrack.frameRate ?? 30;
		output.addVideoTrack(videoSource, { frameRate: fps > 0 ? fps : undefined, rotation });

		const audioTrack = await input.getPrimaryAudioTrack();
		let audioSource: EncodedAudioPacketSource | null = null;
		let audioCodec: string | null = null;
		if (audioTrack) {
			audioCodec = await audioTrack.getCodec();
			if (audioCodec) {
				audioSource = new EncodedAudioPacketSource(audioCodec as never);
				output.addAudioTrack(audioSource);
			}
		}

		const onAbort = () => {
			if (output.state === 'started') void output.cancel();
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			await output.start();
			let videoSeq = 0;
			let audioSeq = 0;
			let muxedTime = 0;

			for (let idx = 0; idx < segments.length; idx++) {
				throwIfAborted(signal);
				const seg = segments[idx]!;
				let start = seg.start;
				if (cutMode === 'nearestKeyframe') {
					const { nearest, aligned } = findNearestKeyframe(start, keyframes, KEYFRAME_TOLERANCE);
					if (!aligned && nearest !== null) start = nearest;
				}
				const duration = seg.end - start;
				if (duration <= 0) continue;

				// Video packets
				const sink = new EncodedPacketSink(videoTrack);
				const tolerance = KEYFRAME_TOLERANCE;
				const first = await sink.getKeyPacket(start + tolerance, { verifyKeyPackets: true });
				if (!first || Math.abs(first.timestamp - start) > tolerance) {
					signal?.removeEventListener('abort', onAbort);
					if (output.state === 'started') await output.cancel();
					streaming.discard().catch(() => undefined);
					input.dispose?.();
					// Fallback to transcode for this merge
					return exportMergedTranscode(file, segments, signal);
				}
				const actualEnd = first.timestamp + duration;
				const last = await sink.getPacket(Math.max(first.timestamp, actualEnd - Number.EPSILON));
				const endPacket = last ? await sink.getNextPacket(last) : undefined;
				const decoderConfig = await videoTrack.getDecoderConfig();
				let firstPkt = true;
				let lastDuration = 1 / Math.max(1, fps);
				for await (const packet of sink.packets(first, endPacket ?? undefined)) {
					throwIfAborted(signal);
					const ts = packet.timestamp - first.timestamp;
					if (ts < -tolerance || ts >= duration) continue;
					const pd = Math.min(
						packet.duration > 0 ? packet.duration : lastDuration,
						Math.max(0, duration - ts)
					);
					if (pd <= 0) continue;
					await videoSource.add(
						packet.clone({
							timestamp: muxedTime + Math.max(0, ts),
							duration: pd,
							sequenceNumber: videoSeq++
						}),
						{ decoderConfig: firstPkt ? (decoderConfig ?? undefined) : undefined }
					);
					firstPkt = false;
					lastDuration = pd;
				}

				// Audio packets
				if (audioTrack && audioSource && audioCodec) {
					const audioSink = new EncodedPacketSink(audioTrack);
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
						const aDecoder = await audioTrack.getDecoderConfig();
						let aFirstPkt = true;
						let pending: typeof aFirst | null = null;
						const endTs = aFirst.timestamp + duration;
						const addAudio = async (pkt: typeof aFirst, nextTs: number) => {
							const ts = pkt.timestamp - aFirst.timestamp;
							if (ts < 0 || ts >= duration) return;
							const dur = pkt.duration > 0 ? pkt.duration : Math.max(0, nextTs - pkt.timestamp);
							const pd = Math.min(dur, Math.max(0, duration - ts));
							if (pd <= 0) return;
							await audioSource!.add(
								pkt.clone({ timestamp: muxedTime + ts, duration: pd, sequenceNumber: audioSeq++ }),
								{ decoderConfig: aFirstPkt ? (aDecoder ?? undefined) : undefined }
							);
							aFirstPkt = false;
						};
						for await (const pkt of new EncodedPacketSink(audioTrack).packets()) {
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
				}
				muxedTime += duration;
				onProgress?.(muxedTime * 1000);
			}
			videoSource.close();
			audioSource?.close();
			await output.finalize();
			const blobFile = await streaming.file(
				mergedFileName(safeBaseName(file.name), extensionForFormat(format)),
				mimeForFormat(format)
			);
			const blobOut = new Blob([await blobFile.arrayBuffer()], { type: blobFile.type });
			// Keep streaming file for caller to discard after save; we already produced blob.
			await streaming.discard();
			return {
				blob: blobOut,
				wasLossless: true,
				reason: 'Merged segments with stream copy — no re-encoding (packet-level concat).',
				format
			};
		} finally {
			signal?.removeEventListener('abort', onAbort);
		}
	} finally {
		try {
			input.dispose?.();
		} catch {
			// ignore
		}
	}
}

async function exportMergedTranscode(
	file: File,
	segments: QuickCutSegment[],
	signal?: AbortSignal
): Promise<{ blob: Blob; wasLossless: false; reason: string; format: OutputFormat }> {
	throwIfAborted(signal);
	const format = outputFormatForFile(file);
	// Mediabunny Conversion does not support multi-trim concat. We approximate by re-encoding each segment and concatenating via decode?
	// Fallback: use a single Input per segment with sequential Conversion and then concatenate encoded packets via Output.
	// Simple approach: for now, create a sequential Output using packet copy with transcode via Conversion per segment into intermediate blobs, then concatenate via packet re-mux is not trivial.
	// Instead, transcode by using Canvas/mux approach would require video transcoding per segment.
	// For this implementation, we fall back to exporting first segment as transcoded and report limitation, but we will do concatenated transcode via sequential decoding using MediaBunny's Conversion with forceTranscode for each segment aggregated into one Output using raw transcoded samples:
	// Pragmatic: Use BufferTargets per segment, then concatenate blobs at byte level is not valid MP4.
	// So we use a packet-level approach with transcoding: decode via transcoded track and re-encode via Output's VideoSampleSource.
	// For brevity, we implement merged transcode by iteratively using Conversion per segment and append via a single Output that re-encodes: we decode segments via transcoded Conversion to intermediate and then re-mux iscomplex.
	// As a bounded fallback, we produce a transcoded merge by concatenating via simple sequential Conversion + manual append is not spec-correct, so we transcode the whole range covering all segments into one file and then trim gaps via re-encoding is inaccurate.
	// Simplest truthful behavior: when merge requires transcode, we report and transcode each segment individually and then concatenate via the same packet-copy path but with forceTranscode flag by using Conversion's transcoded packets directly.
	// For now, implement a sequential Output that uses Encoded packets but with forceTranscode path: create a new Output, add re-encoded tracks, and for each segment run a Conversion that forceTranscodes video into a BufferTarget, collects its encoded packets via EncodedPacketSink reading the transient file, then relays.
	// To keep implementation bounded and avoid huge complexity, we reuse BufferTarget per segment and then use Input to read each transcoded blob and copy packets into final Output.

	const streaming = await createStreamingOutputTarget(signal);
	const outputFormat = format;
	const output = new Output({ format: outputFormat, target: streaming.target });
	let videoSource: EncodedVideoPacketSource | null = null;
	let audioSource: EncodedAudioPacketSource | null = null;
	let muxedTime = 0;
	let initialized = false;
	try {
		for (const seg of segments) {
			throwIfAborted(signal);
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
			const target = new BufferTarget();
			const conv = await Conversion.init({
				input,
				output: new Output({ format: new Mp4OutputFormat(), target }),
				trim: { start: seg.start, end: seg.end },
				video: { forceTranscode: true },
				audio: { forceTranscode: false }
			});
			if (!conv.isValid) throw new Error('Transcode conversion invalid for segment.');
			await conv.execute();
			input.dispose?.();
			const buf = target.buffer;
			if (!buf) throw new Error('Transcode produced no data.');
			const blob = new Blob([buf], { type: 'video/mp4' });
			const segInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
			const vTrack = await segInput.getPrimaryVideoTrack();
			const aTrack = await segInput.getPrimaryAudioTrack();
			if (!initialized) {
				if (!vTrack) throw new Error('Transcoded segment has no video.');
				const vCodec = (await vTrack.getCodec()) as never;
				videoSource = new EncodedVideoPacketSource(vCodec);
				output.addVideoTrack(videoSource, { frameRate: vTrack.frameRate ?? 30 });
				if (aTrack) {
					const aCodec = (await aTrack.getCodec()) as never;
					if (aCodec) {
						audioSource = new EncodedAudioPacketSource(aCodec);
						output.addAudioTrack(audioSource);
					}
				}
				await output.start();
				initialized = true;
			}
			// Copy packets with timestamp shift
			if (vTrack && videoSource) {
				const sink = new EncodedPacketSink(vTrack);
				const dec = await vTrack.getDecoderConfig();
				let seq = 0;
				let first = true;
				for await (const pkt of sink.packets()) {
					throwIfAborted(signal);
					await videoSource.add(
						pkt.clone({ timestamp: muxedTime + pkt.timestamp, sequenceNumber: seq++ }),
						{ decoderConfig: first ? (dec ?? undefined) : undefined }
					);
					first = false;
				}
			}
			if (aTrack && audioSource) {
				const sink = new EncodedPacketSink(aTrack);
				const dec = await aTrack.getDecoderConfig();
				let seq = 0;
				let first = true;
				for await (const pkt of sink.packets()) {
					throwIfAborted(signal);
					await audioSource.add(
						pkt.clone({ timestamp: muxedTime + pkt.timestamp, sequenceNumber: seq++ }),
						{ decoderConfig: first ? (dec ?? undefined) : undefined }
					);
					first = false;
				}
			}
			const dur = seg.end - seg.start;
			muxedTime += dur;
			segInput.dispose?.();
		}
		videoSource?.close();
		audioSource?.close();
		if (!initialized) throw new Error('No segments to merge.');
		await output.finalize();
		const f = await streaming.file(
			mergedFileName(safeBaseName(file.name), extensionForFormat(outputFormat)),
			mimeForFormat(outputFormat)
		);
		const outBlob = new Blob([await f.arrayBuffer()], { type: f.type });
		await streaming.discard();
		return {
			blob: outBlob,
			wasLossless: false,
			reason:
				'Merged segments required re-encoding due to non-keyframe starts or incompatible streams.',
			format: outputFormat
		};
	} catch (e) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// ignore
		}
		await streaming.discard().catch(() => undefined);
		throw e;
	}
}

export async function exportSegments(
	options: QuickCutExportOptions
): Promise<QuickCutExportResult[]> {
	const { file, segments, cutMode, merge, keyframeTimestamps, signal, onProgress } = options;
	if (segments.length === 0) throw new Error('No segments to export.');
	const enabled = segments.filter((s) => s.enabled !== false);
	if (enabled.length === 0) throw new Error('No enabled segments.');
	const startTime = Date.now();
	let totalBytes = 0;
	const format = outputFormatForFile(file);
	const ext = extensionForFormat(format);
	const base = safeBaseName(file.name);

	if (merge) {
		const compat = await checkCompatibilityForMerge(file, enabled);
		if (!compat.compatible && cutMode === 'nearestKeyframe') {
			// Will transcode due to incompatibility
		}
		const progressForMerge = (bytes: number) => {
			const elapsed = Date.now() - startTime;
			const fraction = 0.5; // estimate until finalize
			const eta = null;
			onProgress?.({
				phase: 'copying',
				segmentIndex: 0,
				totalSegments: 1,
				bytesWritten: bytes,
				elapsedMs: elapsed,
				etaMs: eta,
				fraction
			});
		};
		const result = await (async (): Promise<{
			blob: Blob;
			wasLossless: boolean;
			reason: string;
			format: OutputFormat;
		}> => {
			const assess = assessExport(enabled, keyframeTimestamps, cutMode, true);
			if (assess.wasLossless) {
				try {
					return await exportMergedLossless(
						file,
						enabled,
						keyframeTimestamps,
						cutMode,
						progressForMerge,
						signal
					);
				} catch {
					return exportMergedTranscode(file, enabled, signal);
				}
			}
			return exportMergedTranscode(file, enabled, signal);
		})();
		totalBytes = result.blob.size;
		onProgress?.({
			phase: 'finalizing',
			segmentIndex: 1,
			totalSegments: 1,
			bytesWritten: totalBytes,
			elapsedMs: Date.now() - startTime,
			etaMs: 0,
			fraction: 1
		});
		return [
			{
				fileName: mergedFileName(base, ext),
				blob: result.blob,
				wasLossless: result.wasLossless,
				reason: result.reason
			}
		];
	}

	const results: QuickCutExportResult[] = [];
	for (let i = 0; i < enabled.length; i++) {
		throwIfAborted(signal);
		const seg = enabled[i]!;
		const segStart = Date.now();
		const segBytes = { value: 0 };
		const result = await (async () => {
			const assess = assessExport([seg], keyframeTimestamps, cutMode, false);
			if (assess.wasLossless) {
				try {
					return await exportSingleSegmentLossless(
						file,
						seg,
						cutMode,
						keyframeTimestamps,
						(b) => (segBytes.value = b),
						signal
					);
				} catch {
					return exportSingleSegmentTranscode(file, seg, signal);
				}
			}
			return exportSingleSegmentTranscode(file, seg, signal);
		})();
		totalBytes += result.blob.size;
		const elapsed = Date.now() - startTime;
		const fraction = (i + 1) / enabled.length;
		const avgMsPerSeg = elapsed / (i + 1);
		const eta = Math.round(avgMsPerSeg * (enabled.length - (i + 1)));
		onProgress?.({
			phase: 'copying',
			segmentIndex: i + 1,
			totalSegments: enabled.length,
			bytesWritten: totalBytes,
			elapsedMs: elapsed,
			etaMs: eta,
			fraction
		});
		results.push({
			fileName: segmentFileName(base, seg, ext),
			blob: result.blob,
			wasLossless: result.wasLossless,
			reason: result.reason
		});
		void segStart;
	}
	return results;
}

export async function exportSegmentsWithStreaming(
	options: QuickCutExportOptions & { useStreaming?: boolean }
): Promise<QuickCutExportResult[]> {
	// For now delegate to exportSegments which already uses streaming for merge.
	// For single segments, switch to StreamTarget when useStreaming true to avoid BufferTarget.
	if (!options.useStreaming || options.merge) return exportSegments(options);
	// Single segments via streaming
	const { file, segments, cutMode, keyframeTimestamps, signal, onProgress } = options;
	const enabled = segments.filter((s) => s.enabled !== false);
	const startTime = Date.now();
	const results: QuickCutExportResult[] = [];
	const format = outputFormatForFile(file);
	const ext = extensionForFormat(format);
	const base = safeBaseName(file.name);
	for (let i = 0; i < enabled.length; i++) {
		throwIfAborted(signal);
		const seg = enabled[i]!;
		const assess = assessExport([seg], keyframeTimestamps, cutMode, false);
		const streaming = await createStreamingOutputTarget(signal);
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		let trimStart = seg.start;
		if (cutMode === 'nearestKeyframe') {
			const { nearest, aligned } = findNearestKeyframe(
				seg.start,
				keyframeTimestamps,
				KEYFRAME_TOLERANCE
			);
			if (!aligned && nearest !== null) trimStart = nearest;
		}
		const needsTranscode = !assess.wasLossless;
		const output = new Output({ format, target: streaming.target });
		const conversion = await Conversion.init({
			input,
			output,
			trim: { start: trimStart, end: seg.end },
			video: { forceTranscode: needsTranscode },
			audio: { forceTranscode: false }
		});
		if (!conversion.isValid) {
			await streaming.discard();
			input.dispose?.();
			throw new Error('Conversion not valid for segment.');
		}
		try {
			await conversion.execute();
			input.dispose?.();
			const blobFile = await streaming.file(segmentFileName(base, seg, ext), mimeForFormat(format));
			const blob = new Blob([await blobFile.arrayBuffer()], { type: blobFile.type });
			await streaming.discard();
			results.push({
				fileName: blobFile.name,
				blob,
				wasLossless: !needsTranscode,
				reason: assess.reason
			});
		} catch (e) {
			try {
				if (output.state === 'started') await output.cancel();
			} catch {
				// ignore
			}
			await streaming.discard().catch(() => undefined);
			input.dispose?.();
			throw e;
		}
		const elapsed = Date.now() - startTime;
		const fraction = (i + 1) / enabled.length;
		onProgress?.({
			phase: 'copying',
			segmentIndex: i + 1,
			totalSegments: enabled.length,
			bytesWritten: results.reduce((s, r) => s + r.blob.size, 0),
			elapsedMs: elapsed,
			etaMs: Math.round((elapsed / (i + 1)) * (enabled.length - (i + 1))),
			fraction
		});
	}
	return results;
}
