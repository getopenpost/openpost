import {
	ALL_FORMATS,
	AudioBufferSink,
	AudioBufferSource,
	BlobSource,
	CanvasSource,
	Input,
	Mp4OutputFormat,
	Output,
	VideoSampleSink,
	WebMOutputFormat,
	type InputAudioTrack,
	type StreamTarget
} from 'mediabunny';
import {
	derivePrimarySequence,
	isPrimarySequenceClip,
	projectDurationUS,
	referencedSourceIDs,
	type PrimarySequenceClip,
	type VariantID,
	type VideoProjectDocumentV1,
	type VideoSource
} from '@openpost/video-project';
import {
	createFileSystemAccessOutputTarget,
	createStreamingOutputTarget
} from '$lib/video/stream-target';
import { probeExportEncoderPlan } from './export-capabilities';
import { evaluateFrame } from './render-graph';
import { openVideoProjectSource } from './source-access';
import { WebGLFrameCompositor } from './webgl-compositor';
import { drawEvaluatedFrame, type SourceRuntime } from './frame-renderer';
import { SequentialVideoSampler } from './sequential-video-sampler';

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_BLOCK_SECONDS = 1;

export interface VideoEditorExportOptions {
	variantID: VariantID;
	format: 'mp4' | 'webm';
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
	outputFileHandle?: FileSystemFileHandle;
	projectID?: string;
}

export async function preflightVideoProjectExport(
	project: VideoProjectDocumentV1,
	variantID: VariantID,
	format: 'mp4' | 'webm'
) {
	const variant = project.variants.find((candidate) => candidate.id === variantID);
	if (!variant) throw new Error(`Unknown export format: ${variantID}`);
	const frameRate = project.timebase.fps_numerator / Math.max(1, project.timebase.fps_denominator);
	const segments = collectAudioSegments(project);
	const hasAudio = segments.some((segment) =>
		sourceMayContainAudio(project.sources[segment.source_id])
	);
	return await probeExportEncoderPlan({
		format,
		width: variant.width,
		height: variant.height,
		frameRate,
		videoBitrate: project.export_defaults.video_bitrate,
		audioBitrate: project.export_defaults.audio_bitrate,
		hasAudio
	});
}

function sourceMayContainAudio(source: VideoSource | undefined): boolean {
	return (
		Boolean(source?.audio_codec) ||
		source?.kind === 'audio' ||
		source?.kind === 'recording-microphone' ||
		source?.kind === 'recording-system-audio'
	);
}

interface AudioSegment {
	source_id: string;
	timeline_start_us: number;
	duration_us: number;
	source_in_us: number;
	speed: number;
	gain_db: number;
	fade_in_us: number;
	fade_out_us: number;
	muted: boolean;
	duck_others: boolean;
	role: 'primary' | 'voice' | 'music' | 'system' | 'effects' | 'other';
}

interface DecodedAudioBuffer {
	buffer: AudioBuffer;
	timestamp: number;
	duration: number;
}

export async function exportVideoProject(
	project: VideoProjectDocumentV1,
	options: VideoEditorExportOptions
): Promise<File> {
	if (project.primary_sequence.length === 0) {
		throw new Error('Add at least one video clip before exporting.');
	}
	const variant = project.variants.find((candidate) => candidate.id === options.variantID);
	if (!variant) throw new Error(`Unknown export format: ${options.variantID}`);
	const durationUS = projectDurationUS(project);
	if (durationUS <= 0) throw new Error('The project timeline is empty.');
	const frameRate = project.timebase.fps_numerator / Math.max(1, project.timebase.fps_denominator);
	const frameDuration = 1 / frameRate;
	const frameCount = Math.ceil((durationUS / 1_000_000) * frameRate);
	const requestedAudioSegments = collectAudioSegments(project);
	const audioSegments = requestedAudioSegments.filter((segment) =>
		sourceMayContainAudio(project.sources[segment.source_id])
	);
	const encoderPlan = await preflightVideoProjectExport(project, options.variantID, options.format);
	const sourceFiles = await openSourceFiles(project, options.projectID, options.signal);
	const videoResources = new Map<string, SourceRuntime>();
	const audioResources = new Map<string, SourceRuntime>();
	const stream = options.outputFileHandle
		? await createFileSystemAccessOutputTarget(options.outputFileHandle, options.signal)
		: await createStreamingOutputTarget(options.signal);
	const canvas = new OffscreenCanvas(variant.width, variant.height);
	const compositor = new WebGLFrameCompositor(canvas, variant.width, variant.height);
	const context = compositor.context;
	const output = new Output({
		format:
			options.format === 'mp4'
				? new Mp4OutputFormat({ fastStart: 'reserve' })
				: new WebMOutputFormat(),
		target: stream.target
	});
	const videoSource = new CanvasSource(canvas, {
		codec: encoderPlan.codec,
		fullCodecString: encoderPlan.fullCodecString,
		bitrate: encoderPlan.bitrate,
		keyFrameInterval: 2,
		hardwareAcceleration: encoderPlan.hardwareAcceleration,
		latencyMode: 'quality',
		alpha: 'discard',
		bitrateMode: 'variable'
	});
	output.addVideoTrack(videoSource, { maximumPacketCount: frameCount + 8 });
	const audioSource =
		audioSegments.length > 0
			? new AudioBufferSource({
					codec: encoderPlan.audioCodec,
					bitrate: encoderPlan.audioBitrate,
					transform: { numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE }
				})
			: null;
	if (audioSource) {
		output.addAudioTrack(audioSource, {
			maximumPacketCount: Math.ceil((durationUS / 1_000_000) * 52) + 64
		});
	}
	let completed = false;
	const abort = () => void output.cancel();
	options.signal?.addEventListener('abort', abort, { once: true });
	try {
		await output.start();
		await Promise.all([
			renderVideoFrames(
				project,
				options.variantID,
				context,
				videoSource,
				sourceFiles,
				videoResources,
				frameCount,
				frameDuration,
				() => compositor.present(),
				options.onProgress,
				options.signal
			),
			audioSource
				? renderAudioBlocks(
						project,
						durationUS,
						audioSegments,
						sourceFiles,
						audioResources,
						audioSource,
						options.signal
					)
				: Promise.resolve()
		]);
		await output.finalize();
		const extension = options.format === 'mp4' ? 'mp4' : 'webm';
		const rendered = await stream.file(
			`${safeFileName(project.title)}-${options.variantID}.${extension}`,
			options.format === 'mp4' ? 'video/mp4' : 'video/webm'
		);
		await validateCompletedExport(rendered, {
			format: options.format,
			videoCodec: encoderPlan.codec,
			audioCodec: audioSource ? encoderPlan.audioCodec : null,
			width: variant.width,
			height: variant.height,
			durationSeconds: durationUS / 1_000_000,
			frameDuration
		});
		completed = true;
		options.onProgress?.(1);
		return rendered;
	} catch (cause) {
		if (output.state === 'started' || output.state === 'finalizing') {
			await output.cancel().catch(() => undefined);
		}
		throw cause;
	} finally {
		options.signal?.removeEventListener('abort', abort);
		disposeSourceRuntimes(videoResources);
		disposeSourceRuntimes(audioResources);
		compositor.dispose();
		if (!completed) await stream.discard();
	}
}

async function openSourceFiles(
	project: VideoProjectDocumentV1,
	projectID?: string,
	signal?: AbortSignal
): Promise<Map<string, File>> {
	const files = new Map<string, File>();
	const referenced = new Set(referencedSourceIDs(project));
	for (const source of Object.values(project.sources).filter((candidate) =>
		referenced.has(candidate.id)
	)) {
		assertNotAborted(signal);
		files.set(source.id, await openVideoProjectSource(projectID, source, signal));
	}
	return files;
}

function audioSink(track: InputAudioTrack): AudioBufferSink {
	return new AudioBufferSink(track);
}

async function renderVideoFrames(
	project: VideoProjectDocumentV1,
	variantID: VariantID,
	context: OffscreenCanvasRenderingContext2D,
	source: CanvasSource,
	sourceFiles: Map<string, File>,
	resources: Map<string, SourceRuntime>,
	frameCount: number,
	frameDuration: number,
	present: () => void,
	onProgress?: (fraction: number) => void,
	signal?: AbortSignal
): Promise<void> {
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		assertNotAborted(signal);
		const timestamp = frameIndex * frameDuration;
		const frame = evaluateFrame(project, variantID, Math.round(timestamp * 1_000_000));
		await prepareVideoRuntimes(project, frame, sourceFiles, resources);
		await drawEvaluatedFrame(context, frame, resources);
		present();
		await source.add(timestamp, frameDuration, {
			keyFrame: frameIndex % Math.max(1, Math.round(2 / frameDuration)) === 0
		});
		if (frameIndex % 6 === 0) onProgress?.((frameIndex + 1) / frameCount);
	}
}

async function prepareVideoRuntimes(
	project: VideoProjectDocumentV1,
	frame: ReturnType<typeof evaluateFrame>,
	sourceFiles: Map<string, File>,
	resources: Map<string, SourceRuntime>
): Promise<void> {
	const activeSourceIDs = new Set([
		...frame.primary_layers.map((layer) => layer.source_id),
		...frame.visual_layers.flatMap((layer) =>
			layer.item.type === 'media' || layer.item.type === 'camera' ? [layer.item.source_id] : []
		)
	]);
	for (const [sourceID, runtime] of resources) {
		if (activeSourceIDs.has(sourceID)) continue;
		disposeSourceRuntime(runtime);
		resources.delete(sourceID);
	}
	for (const sourceID of activeSourceIDs) {
		if (resources.has(sourceID)) continue;
		const source = project.sources[sourceID];
		const file = sourceFiles.get(sourceID);
		if (!source || !file) continue;
		const runtime: SourceRuntime = { source };
		if (source.kind === 'image') {
			runtime.image = await createImageBitmap(file);
		} else {
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack || !(await videoTrack.canDecode())) {
				input.dispose();
				throw new Error(`${source.original_name} uses a video codec this browser cannot decode.`);
			}
			runtime.input = input;
			runtime.video = new VideoSampleSink(videoTrack, { optimizeForLatency: true });
			runtime.videoSampler = new SequentialVideoSampler(runtime.video);
		}
		resources.set(sourceID, runtime);
	}
}

interface CompletedExportExpectation {
	format: 'mp4' | 'webm';
	videoCodec: 'avc' | 'vp9' | 'vp8';
	audioCodec: 'aac' | 'opus' | null;
	width: number;
	height: number;
	durationSeconds: number;
	frameDuration: number;
}

async function validateCompletedExport(
	file: File,
	expected: CompletedExportExpectation
): Promise<void> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		if (!(await input.canRead())) {
			throw new Error('The completed file is not a readable video container.');
		}
		const mimeType = await input.getMimeType();
		const expectedMime = expected.format === 'mp4' ? 'video/mp4' : 'video/webm';
		if (!mimeType.toLowerCase().startsWith(expectedMime)) {
			throw new Error(`Expected ${expectedMime}, but the completed file reports ${mimeType}.`);
		}
		const [videoTrack, audioTrack] = await Promise.all([
			input.getPrimaryVideoTrack(),
			input.getPrimaryAudioTrack()
		]);
		if (!videoTrack) throw new Error('The completed file has no video track.');
		const [codec, width, height, duration] = await Promise.all([
			videoTrack.getCodec(),
			videoTrack.getDisplayWidth(),
			videoTrack.getDisplayHeight(),
			input.computeDuration()
		]);
		if (codec !== expected.videoCodec) {
			throw new Error(
				`Expected ${expected.videoCodec} video, but the completed file uses ${codec}.`
			);
		}
		if (width !== expected.width || height !== expected.height) {
			throw new Error(
				`Expected ${expected.width}×${expected.height}, but the completed file is ${width}×${height}.`
			);
		}
		const durationTolerance = Math.max(0.15, expected.frameDuration * 2);
		if (
			!Number.isFinite(duration) ||
			Math.abs(duration - expected.durationSeconds) > durationTolerance
		) {
			throw new Error(
				`The completed file duration differs from the project by more than ${durationTolerance.toFixed(2)} seconds.`
			);
		}
		if (expected.audioCodec) {
			if (!audioTrack) throw new Error('The completed file has no audio track.');
			const audioCodec = await audioTrack.getCodec();
			if (audioCodec !== expected.audioCodec) {
				throw new Error(
					`Expected ${expected.audioCodec} audio, but the completed file uses ${audioCodec}.`
				);
			}
		}
		const sample = await new VideoSampleSink(videoTrack, { optimizeForLatency: true }).getSample(0);
		if (!sample) throw new Error('The completed file has no decodable video samples.');
		sample.close();
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : 'Unknown validation error.';
		throw new Error(`The video finished rendering but failed validation. ${detail}`, {
			cause
		});
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function collectAudioSegments(project: VideoProjectDocumentV1): AudioSegment[] {
	const primary = derivePrimarySequence(project).flatMap((item) => {
		const clip = project.primary_sequence[item.index]!;
		return isPrimarySequenceClip(clip)
			? [segmentFromPrimary(clip, item.timeline_start_us, item.duration_us)]
			: [];
	});
	const extra = project.audio_tracks.flatMap((track) =>
		track.items.map((item) => ({
			source_id: item.source_id,
			timeline_start_us: item.timeline_start_us,
			duration_us: item.duration_us,
			source_in_us: item.source_in_us,
			speed: item.speed,
			gain_db: item.gain_db,
			fade_in_us: item.fade_in_us,
			fade_out_us: item.fade_out_us,
			muted: track.muted || item.muted,
			duck_others: item.duck_others,
			role: track.role
		}))
	);
	return [...primary, ...extra];
}

function segmentFromPrimary(
	clip: PrimarySequenceClip,
	timelineStartUS: number,
	durationUS: number
): AudioSegment {
	return {
		source_id: clip.source_id,
		timeline_start_us: timelineStartUS,
		duration_us: durationUS,
		source_in_us: clip.source_in_us,
		speed: clip.speed,
		gain_db: clip.audio.gain_db,
		fade_in_us: clip.audio.fade_in_us,
		fade_out_us: clip.audio.fade_out_us,
		muted: clip.audio.muted || clip.mode === 'freeze',
		duck_others: clip.audio.duck_others,
		role: 'primary'
	};
}

async function renderAudioBlocks(
	project: VideoProjectDocumentV1,
	durationUS: number,
	segments: AudioSegment[],
	sourceFiles: Map<string, File>,
	resources: Map<string, SourceRuntime>,
	source: AudioBufferSource,
	signal?: AbortSignal
): Promise<void> {
	const durationSeconds = durationUS / 1_000_000;
	for (let blockStart = 0; blockStart < durationSeconds; blockStart += AUDIO_BLOCK_SECONDS) {
		assertNotAborted(signal);
		const blockDuration = Math.min(AUDIO_BLOCK_SECONDS, durationSeconds - blockStart);
		const frames = Math.max(1, Math.round(blockDuration * AUDIO_SAMPLE_RATE));
		const output = new AudioBuffer({
			length: frames,
			numberOfChannels: 2,
			sampleRate: AUDIO_SAMPLE_RATE
		});
		const active = segments.filter(
			(segment) =>
				!segment.muted &&
				segment.timeline_start_us / 1_000_000 < blockStart + blockDuration &&
				(segment.timeline_start_us + segment.duration_us) / 1_000_000 > blockStart
		);
		await prepareAudioRuntimes(project, active, sourceFiles, resources);
		const ducking = active.some((segment) => segment.duck_others);
		for (const segment of active) {
			const sink = resources.get(segment.source_id)?.audio;
			if (!sink) continue;
			await mixSegmentIntoBlock(
				output,
				blockStart,
				blockDuration,
				segment,
				sink,
				ducking && (segment.role === 'music' || segment.role === 'system') ? 0.25 : 1,
				signal
			);
		}
		limitAudioBlock(output);
		await source.add(output);
	}
}

async function prepareAudioRuntimes(
	project: VideoProjectDocumentV1,
	activeSegments: AudioSegment[],
	sourceFiles: Map<string, File>,
	resources: Map<string, SourceRuntime>
): Promise<void> {
	const activeSourceIDs = new Set(activeSegments.map((segment) => segment.source_id));
	for (const [sourceID, runtime] of resources) {
		if (activeSourceIDs.has(sourceID)) continue;
		disposeSourceRuntime(runtime);
		resources.delete(sourceID);
	}
	for (const sourceID of activeSourceIDs) {
		if (resources.has(sourceID)) continue;
		const projectSource = project.sources[sourceID];
		const file = sourceFiles.get(sourceID);
		if (!projectSource || !file || projectSource.kind === 'image') continue;
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const audioTrack = await input.getPrimaryAudioTrack();
		if (!audioTrack || !(await audioTrack.canDecode())) {
			input.dispose();
			continue;
		}
		resources.set(sourceID, {
			source: projectSource,
			input,
			audio: audioSink(audioTrack)
		});
	}
}

function disposeSourceRuntime(runtime: SourceRuntime): void {
	void runtime.videoSampler?.dispose();
	runtime.image?.close();
	if (runtime.input && !runtime.input.disposed) runtime.input.dispose();
}

function disposeSourceRuntimes(resources: Map<string, SourceRuntime>): void {
	for (const runtime of resources.values()) disposeSourceRuntime(runtime);
	resources.clear();
}

async function mixSegmentIntoBlock(
	output: AudioBuffer,
	blockStart: number,
	blockDuration: number,
	segment: AudioSegment,
	sink: AudioBufferSink,
	duckingGain: number,
	signal?: AbortSignal
): Promise<void> {
	const segmentStart = segment.timeline_start_us / 1_000_000;
	const segmentEnd = segmentStart + segment.duration_us / 1_000_000;
	const intersectionStart = Math.max(blockStart, segmentStart);
	const intersectionEnd = Math.min(blockStart + blockDuration, segmentEnd);
	const sourceStart =
		segment.source_in_us / 1_000_000 + (intersectionStart - segmentStart) * segment.speed;
	const sourceEnd =
		segment.source_in_us / 1_000_000 + (intersectionEnd - segmentStart) * segment.speed;
	const decoded: DecodedAudioBuffer[] = [];
	for await (const wrapped of sink.buffers(Math.max(0, sourceStart - 0.05), sourceEnd + 0.05)) {
		assertNotAborted(signal);
		decoded.push(wrapped);
	}
	if (!decoded.length) return;
	const left = output.getChannelData(0);
	const right = output.getChannelData(1);
	let decodedIndex = 0;
	const firstFrame = Math.max(0, Math.floor((intersectionStart - blockStart) * AUDIO_SAMPLE_RATE));
	const lastFrame = Math.min(
		output.length,
		Math.ceil((intersectionEnd - blockStart) * AUDIO_SAMPLE_RATE)
	);
	for (let frame = firstFrame; frame < lastFrame; frame++) {
		const timelineTime = blockStart + frame / AUDIO_SAMPLE_RATE;
		const localTime = timelineTime - segmentStart;
		const sourceTime = segment.source_in_us / 1_000_000 + localTime * segment.speed;
		while (
			decodedIndex < decoded.length - 1 &&
			sourceTime >= decoded[decodedIndex]!.timestamp + decoded[decodedIndex]!.duration
		) {
			decodedIndex += 1;
		}
		const wrapped = decoded[decodedIndex]!;
		if (sourceTime < wrapped.timestamp || sourceTime >= wrapped.timestamp + wrapped.duration)
			continue;
		const sourceFrame = Math.min(
			wrapped.buffer.length - 1,
			Math.max(0, Math.round((sourceTime - wrapped.timestamp) * wrapped.buffer.sampleRate))
		);
		const gain = segmentGain(segment, localTime) * duckingGain;
		left[frame] += wrapped.buffer.getChannelData(0)[sourceFrame]! * gain;
		const rightChannel = Math.min(1, wrapped.buffer.numberOfChannels - 1);
		right[frame] += wrapped.buffer.getChannelData(rightChannel)[sourceFrame]! * gain;
	}
}

function segmentGain(segment: AudioSegment, localSeconds: number): number {
	const localUS = localSeconds * 1_000_000;
	const base = 10 ** (segment.gain_db / 20);
	const fadeIn = segment.fade_in_us > 0 ? Math.min(1, localUS / segment.fade_in_us) : 1;
	const fadeOut =
		segment.fade_out_us > 0
			? Math.min(1, (segment.duration_us - localUS) / segment.fade_out_us)
			: 1;
	return base * Math.max(0, Math.min(fadeIn, fadeOut));
}

function limitAudioBlock(buffer: AudioBuffer): void {
	let peak = 0;
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const samples = buffer.getChannelData(channel);
		for (let index = 0; index < samples.length; index++) {
			peak = Math.max(peak, Math.abs(samples[index]!));
		}
	}
	const ceiling = 10 ** (-1 / 20);
	if (peak <= ceiling) return;
	const scale = ceiling / peak;
	for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
		const samples = buffer.getChannelData(channel);
		for (let index = 0; index < samples.length; index++) samples[index] = samples[index]! * scale;
	}
}

function safeFileName(title: string): string {
	return (
		title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/gu, '-')
			.replace(/^-+|-+$/gu, '')
			.slice(0, 80) || 'openpost-video'
	);
}

function assertNotAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
