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
	type StreamTarget,
	type VideoSample
} from 'mediabunny';
import {
	captionDisplayText,
	derivePrimarySequence,
	projectDurationUS,
	type PrimarySequenceClip,
	type VariantID,
	type VideoEffect,
	type VideoPresentation,
	type VideoProjectDocumentV1,
	type VideoSource,
	type VisualTrackItem
} from '@openpost/video-project';
import { getAuthenticatedMediaByID } from '$lib/media-url';
import { createStreamingOutputTarget } from '$lib/video/stream-target';
import { evaluateFrame, type EvaluatedPrimaryLayer } from './render-graph';
import { readProjectFile } from './storage';

const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_BLOCK_SECONDS = 1;

export interface VideoStudioExportOptions {
	variantID: VariantID;
	format: 'mp4' | 'webm';
	onProgress?: (fraction: number) => void;
	signal?: AbortSignal;
}

interface SourceRuntime {
	source: VideoSource;
	input?: Input;
	video?: VideoSampleSink;
	audio?: AudioBufferSink;
	image?: ImageBitmap;
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
	options: VideoStudioExportOptions
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
	const resources = await openSourceRuntimes(project, options.signal);
	const audioSegments = collectAudioSegments(project).filter(
		(segment) => resources.get(segment.source_id)?.audio
	);
	const stream = await createStreamingOutputTarget(options.signal);
	const canvas = new OffscreenCanvas(variant.width, variant.height);
	const context = canvas.getContext('2d', {
		alpha: false,
		desynchronized: true,
		colorSpace: 'srgb'
	});
	if (!context) throw new Error('The browser could not create the video compositor.');
	const videoCodec = await selectExportVideoCodec(
		options.format,
		variant.width,
		variant.height,
		frameRate,
		project.export_defaults.video_bitrate
	);
	const audioCodec = options.format === 'mp4' ? 'aac' : 'opus';
	const output = new Output({
		format:
			options.format === 'mp4'
				? new Mp4OutputFormat({ fastStart: 'reserve' })
				: new WebMOutputFormat(),
		target: stream.target
	});
	const videoSource = new CanvasSource(canvas, {
		codec: videoCodec,
		bitrate:
			options.format === 'webm'
				? Math.min(project.export_defaults.video_bitrate, 8_000_000)
				: project.export_defaults.video_bitrate,
		keyFrameInterval: 2,
		hardwareAcceleration: options.format === 'mp4' ? 'prefer-hardware' : 'no-preference',
		latencyMode: 'quality'
	});
	output.addVideoTrack(videoSource, { maximumPacketCount: frameCount + 8 });
	const audioSource =
		audioSegments.length > 0
			? new AudioBufferSource({
					codec: audioCodec,
					bitrate: project.export_defaults.audio_bitrate,
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
				resources,
				frameCount,
				frameDuration,
				options.onProgress,
				options.signal
			),
			audioSource
				? renderAudioBlocks(durationUS, audioSegments, resources, audioSource, options.signal)
				: Promise.resolve()
		]);
		await output.finalize();
		const extension = options.format === 'mp4' ? 'mp4' : 'webm';
		const rendered = await stream.file(
			`${safeFileName(project.title)}-${options.variantID}.${extension}`,
			options.format === 'mp4' ? 'video/mp4' : 'video/webm'
		);
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
		for (const runtime of resources.values()) {
			runtime.image?.close();
			if (runtime.input && !runtime.input.disposed) runtime.input.dispose();
		}
		if (!completed) await stream.discard();
	}
}

async function selectExportVideoCodec(
	format: 'mp4' | 'webm',
	width: number,
	height: number,
	frameRate: number,
	bitrate: number
): Promise<'avc' | 'vp9' | 'vp8'> {
	if (format === 'mp4') return 'avc';
	if (typeof VideoEncoder === 'undefined') return 'vp9';
	const candidates = [
		{ codec: 'vp9' as const, config: 'vp09.00.40.08' },
		{ codec: 'vp8' as const, config: 'vp8' }
	];
	for (const candidate of candidates) {
		try {
			const result = await VideoEncoder.isConfigSupported({
				codec: candidate.config,
				width,
				height,
				framerate: frameRate,
				bitrate: Math.min(bitrate, 8_000_000),
				hardwareAcceleration: 'no-preference'
			});
			if (result.supported) return candidate.codec;
		} catch {
			// Try the next browser-native WebM encoder.
		}
	}
	throw new Error(
		'This browser cannot encode WebM at the selected dimensions. Choose a smaller format or use a supported desktop Chromium browser.'
	);
}

async function openSourceRuntimes(
	project: VideoProjectDocumentV1,
	signal?: AbortSignal
): Promise<Map<string, SourceRuntime>> {
	const runtimes = new Map<string, SourceRuntime>();
	for (const source of Object.values(project.sources)) {
		assertNotAborted(signal);
		const blob = await sourceBlob(source, signal);
		const runtime: SourceRuntime = { source };
		if (source.kind === 'image') {
			runtime.image = await createImageBitmap(blob);
		} else {
			const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
			runtime.input = input;
			const [videoTrack, audioTrack] = await Promise.all([
				input.getPrimaryVideoTrack(),
				input.getPrimaryAudioTrack()
			]);
			if (videoTrack) {
				if (!(await videoTrack.canDecode())) {
					throw new Error(`${source.original_name} uses a video codec this browser cannot decode.`);
				}
				runtime.video = new VideoSampleSink(videoTrack, { optimizeForLatency: true });
			}
			if (audioTrack && (await audioTrack.canDecode())) runtime.audio = audioSink(audioTrack);
		}
		runtimes.set(source.id, runtime);
	}
	return runtimes;
}

async function sourceBlob(source: VideoSource, signal?: AbortSignal): Promise<Blob> {
	if (source.locator.type === 'local-opfs') {
		const file = await readProjectFile(source.locator.path);
		if (!file) throw new Error(`${source.original_name} is missing from local project storage.`);
		return file;
	}
	const response = await fetch(getAuthenticatedMediaByID(source.locator.media_id), { signal });
	if (!response.ok)
		throw new Error(`${source.original_name} could not be read from OpenPost Media.`);
	return await response.blob();
}

function audioSink(track: InputAudioTrack): AudioBufferSink {
	return new AudioBufferSink(track);
}

async function renderVideoFrames(
	project: VideoProjectDocumentV1,
	variantID: VariantID,
	context: OffscreenCanvasRenderingContext2D,
	source: CanvasSource,
	resources: Map<string, SourceRuntime>,
	frameCount: number,
	frameDuration: number,
	onProgress?: (fraction: number) => void,
	signal?: AbortSignal
): Promise<void> {
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		assertNotAborted(signal);
		const timestamp = frameIndex * frameDuration;
		const frame = evaluateFrame(project, variantID, Math.round(timestamp * 1_000_000));
		context.save();
		context.fillStyle = frame.background_color;
		context.fillRect(0, 0, frame.width, frame.height);
		for (const layer of frame.primary_layers) {
			const runtime = resources.get(layer.source_id);
			if (!runtime) continue;
			const sample = runtime.video
				? await runtime.video.getSample(layer.source_time_us / 1_000_000)
				: null;
			try {
				drawMediaLayer(context, sample ?? runtime.image, layer.presentation, layer.opacity, layer);
			} finally {
				sample?.close();
			}
		}
		for (const layer of frame.visual_layers) {
			await drawVisualLayer(
				context,
				layer.item,
				layer.presentation,
				layer.opacity,
				resources,
				layer.local_time_us
			);
		}
		drawCaptions(context, frame.captions, frame.width, frame.height);
		drawTransitionWash(context, frame.primary_layers, frame.width, frame.height);
		context.restore();
		await source.add(timestamp, frameDuration, {
			keyFrame: frameIndex % Math.max(1, Math.round(2 / frameDuration)) === 0
		});
		if (frameIndex % 6 === 0) onProgress?.((frameIndex + 1) / frameCount);
	}
}

function drawMediaLayer(
	context: OffscreenCanvasRenderingContext2D,
	media: VideoSample | ImageBitmap | null | undefined,
	presentation: VideoPresentation,
	opacity: number,
	layer?: EvaluatedPrimaryLayer
): void {
	if (!media) return;
	const sourceWidth = 'displayWidth' in media ? media.displayWidth : media.width;
	const sourceHeight = 'displayHeight' in media ? media.displayHeight : media.height;
	const crop = presentation.crop;
	const cropX = Math.max(0, Math.min(sourceWidth - 1, crop.x * sourceWidth));
	const cropY = Math.max(0, Math.min(sourceHeight - 1, crop.y * sourceHeight));
	const cropWidth = Math.max(1, Math.min(sourceWidth - cropX, crop.width * sourceWidth));
	const cropHeight = Math.max(1, Math.min(sourceHeight - cropY, crop.height * sourceHeight));
	const baseScale = Math.max(context.canvas.width / cropWidth, context.canvas.height / cropHeight);
	let drawWidth = cropWidth * baseScale * presentation.scale;
	let drawHeight = cropHeight * baseScale * presentation.scale;
	let translateX = 0;
	if (layer?.transition?.type === 'slide' || layer?.transition?.type === 'push') {
		const direction =
			layer.transition.role === 'incoming'
				? 1 - layer.transition.progress
				: -layer.transition.progress;
		translateX = direction * context.canvas.width;
	}
	if (layer?.transition?.type === 'zoom-blur') {
		const amount =
			layer.transition.role === 'incoming'
				? 1 - layer.transition.progress
				: layer.transition.progress;
		drawWidth *= 1 + amount * 0.12;
		drawHeight *= 1 + amount * 0.12;
		context.filter = `blur(${amount * 14}px)`;
	} else {
		context.filter = effectFilter(layer?.effects ?? []);
	}
	context.save();
	context.globalAlpha = Math.max(0, Math.min(1, opacity * presentation.opacity));
	context.translate(
		presentation.position_x * context.canvas.width + translateX,
		presentation.position_y * context.canvas.height
	);
	context.rotate((presentation.rotation * Math.PI) / 180);
	context.scale(presentation.flip_x ? -1 : 1, presentation.flip_y ? -1 : 1);
	const left = -drawWidth / 2;
	const top = -drawHeight / 2;
	const radius =
		presentation.corner_radius <= 1
			? presentation.corner_radius * Math.min(drawWidth, drawHeight)
			: presentation.corner_radius;
	if (presentation.shadow_opacity > 0 && presentation.shadow_blur > 0) {
		context.save();
		context.shadowColor = `rgb(0 0 0 / ${presentation.shadow_opacity})`;
		context.shadowBlur = presentation.shadow_blur;
		context.fillStyle = '#000000';
		context.beginPath();
		context.roundRect(left, top, drawWidth, drawHeight, radius);
		context.fill();
		context.restore();
	}
	if (radius > 0) {
		context.beginPath();
		context.roundRect(left, top, drawWidth, drawHeight, radius);
		context.clip();
	}
	if ('draw' in media) {
		media.draw(context, cropX, cropY, cropWidth, cropHeight, left, top, drawWidth, drawHeight);
	} else {
		context.drawImage(media, cropX, cropY, cropWidth, cropHeight, left, top, drawWidth, drawHeight);
	}
	const vignette = layer?.effects.find((effect) => effect.type === 'vignette')?.value ?? 0;
	if (vignette > 0) {
		context.filter = 'none';
		const gradient = context.createRadialGradient(
			0,
			0,
			Math.min(drawWidth, drawHeight) * 0.18,
			0,
			0,
			Math.max(drawWidth, drawHeight) * 0.65
		);
		gradient.addColorStop(0, 'rgb(0 0 0 / 0)');
		gradient.addColorStop(1, `rgb(0 0 0 / ${Math.min(0.9, vignette * 0.8)})`);
		context.fillStyle = gradient;
		context.fillRect(left, top, drawWidth, drawHeight);
	}
	if (presentation.border_width > 0) {
		context.filter = 'none';
		context.lineWidth = presentation.border_width;
		context.strokeStyle = presentation.border_color;
		context.beginPath();
		context.roundRect(left, top, drawWidth, drawHeight, radius);
		context.stroke();
	}
	context.restore();
	context.filter = 'none';
}

async function drawVisualLayer(
	context: OffscreenCanvasRenderingContext2D,
	item: VisualTrackItem,
	presentation: VideoPresentation,
	opacity: number,
	resources: Map<string, SourceRuntime>,
	localTimeUS: number
): Promise<void> {
	if (item.type === 'media' || item.type === 'camera') {
		const runtime = resources.get(item.source_id);
		if (!runtime) return;
		const sample = runtime.video
			? await runtime.video.getSample(
					(item.source_in_us + Math.round(localTimeUS * item.speed)) / 1_000_000
				)
			: null;
		try {
			drawMediaLayer(context, sample ?? runtime.image, presentation, opacity);
		} finally {
			sample?.close();
		}
		return;
	}
	context.save();
	context.globalAlpha = opacity;
	context.translate(
		presentation.position_x * context.canvas.width,
		presentation.position_y * context.canvas.height
	);
	context.rotate((presentation.rotation * Math.PI) / 180);
	context.scale(presentation.scale, presentation.scale);
	if (item.type === 'text') {
		const entrance = Math.min(1, localTimeUS / 350_000);
		const exit = Math.min(1, (item.duration_us - localTimeUS) / 250_000);
		const visibility = Math.max(0, Math.min(entrance, exit));
		if (item.style.animation === 'fade' || item.style.animation === 'rise') {
			context.globalAlpha *= visibility;
		}
		if (item.style.animation === 'rise') {
			context.translate(0, (1 - entrance) * 36);
		} else if (item.style.animation === 'pop') {
			context.globalAlpha *= exit;
			const amount = 0.8 + easeOutBack(entrance) * 0.2;
			context.scale(amount, amount);
		}
		const text =
			item.style.animation === 'typewriter'
				? item.text.slice(0, Math.max(1, Math.ceil(item.text.length * entrance)))
				: item.text;
		const scale = Math.min(context.canvas.width, context.canvas.height) / 1080;
		context.font = `${item.style.font_weight} ${Math.round(item.style.font_size * scale)}px "${item.style.font_family}"`;
		context.textAlign = item.style.align;
		context.textBaseline = 'middle';
		if (item.style.shadow_blur > 0) {
			context.shadowColor = '#000000aa';
			context.shadowBlur = item.style.shadow_blur * scale;
		}
		if (item.style.background_color !== '#00000000') {
			const metrics = context.measureText(text);
			const padding = 18 * scale;
			context.fillStyle = item.style.background_color;
			context.fillRect(
				-metrics.width / 2 - padding,
				-item.style.font_size * scale * 0.65,
				metrics.width + padding * 2,
				item.style.font_size * scale * 1.3
			);
		}
		if (item.style.outline_width > 0) {
			context.lineWidth = item.style.outline_width * scale;
			context.strokeStyle = item.style.outline_color;
			context.strokeText(text, 0, 0);
		}
		context.fillStyle = item.style.color;
		context.fillText(text, 0, 0);
	} else if (item.type === 'shape' || item.type === 'annotation') {
		drawShape(context, item, localTimeUS);
	}
	context.restore();
}

function easeOutBack(value: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function drawShape(
	context: OffscreenCanvasRenderingContext2D,
	item: Extract<VisualTrackItem, { type: 'shape' | 'annotation' }>,
	localTimeUS: number
): void {
	const width = context.canvas.width * (item.shape.kind === 'progress' ? 0.8 : 0.24);
	const height = item.shape.kind === 'progress' ? 18 : context.canvas.height * 0.16;
	context.fillStyle = item.shape.fill;
	context.strokeStyle = item.shape.stroke;
	context.lineWidth = item.shape.stroke_width;
	if (item.shape.kind === 'ellipse' || item.shape.kind === 'click-pulse') {
		const progress = Math.min(1, localTimeUS / Math.max(1, item.duration_us));
		const radius =
			Math.min(width, height) * (item.shape.kind === 'click-pulse' ? 0.2 + progress * 0.8 : 0.5);
		context.globalAlpha *= item.shape.kind === 'click-pulse' ? 1 - progress : 1;
		context.beginPath();
		context.arc(0, 0, radius, 0, Math.PI * 2);
		context.fill();
		context.stroke();
	} else if (item.shape.kind === 'progress') {
		const progress = Math.min(1, localTimeUS / Math.max(1, item.duration_us));
		context.fillRect(-width / 2, -height / 2, width * progress, height);
	} else if (item.shape.kind === 'arrow') {
		context.beginPath();
		context.moveTo(-width / 2, height / 3);
		context.lineTo(width / 3, -height / 3);
		context.lineTo(width / 4, -height / 3);
		context.moveTo(width / 3, -height / 3);
		context.lineTo(width / 5, -height / 8);
		context.stroke();
	} else {
		context.fillRect(-width / 2, -height / 2, width, height);
		context.strokeRect(-width / 2, -height / 2, width, height);
	}
}

function drawCaptions(
	context: OffscreenCanvasRenderingContext2D,
	captions: ReturnType<typeof evaluateFrame>['captions'],
	width: number,
	height: number
): void {
	for (const caption of captions) {
		const scale = Math.min(width, height) / 1080;
		const size = caption.style.font_size * scale;
		context.save();
		context.font = `${caption.style.font_weight} ${Math.round(size)}px "${caption.style.font_family}"`;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		const text = captionDisplayText(caption.cue);
		const timedText = caption.cue.words
			.map((word) => word.text)
			.join(' ')
			.trim();
		const y =
			caption.style.position === 'top'
				? height * 0.12
				: caption.style.position === 'middle'
					? height * 0.5
					: height * 0.84;
		const paddingX = 22 * scale;
		const metrics = context.measureText(text);
		context.fillStyle = caption.style.background_color;
		context.fillRect(
			width / 2 - metrics.width / 2 - paddingX,
			y - size * 0.68,
			metrics.width + paddingX * 2,
			size * 1.36
		);
		context.fillStyle = caption.style.color;
		context.fillText(text, width / 2, y);
		if (text === timedText && caption.active_word_index >= 0) {
			const before = caption.cue.words
				.slice(0, caption.active_word_index)
				.map((word) => word.text)
				.join(' ');
			const active = caption.cue.words[caption.active_word_index]?.text ?? '';
			const beforeWidth = context.measureText(before ? `${before} ` : '').width;
			const activeWidth = context.measureText(active).width;
			context.textAlign = 'left';
			context.fillStyle = caption.style.emphasis_color;
			context.fillText(active, width / 2 - metrics.width / 2 + beforeWidth, y);
			context.textAlign = 'center';
			void activeWidth;
		}
		context.restore();
	}
}

function drawTransitionWash(
	context: OffscreenCanvasRenderingContext2D,
	layers: EvaluatedPrimaryLayer[],
	width: number,
	height: number
): void {
	const dip = layers.find(
		(layer) => layer.transition?.type === 'dip-black' || layer.transition?.type === 'dip-white'
	);
	if (!dip?.transition) return;
	const midpoint =
		dip.transition.role === 'outgoing' ? dip.transition.progress : 1 - dip.transition.progress;
	context.save();
	context.globalAlpha = Math.max(0, Math.min(1, midpoint));
	context.fillStyle = dip.transition.type === 'dip-white' ? '#ffffff' : '#000000';
	context.fillRect(0, 0, width, height);
	context.restore();
}

function effectFilter(effects: VideoEffect[]): string {
	const filters: string[] = [];
	for (const effect of effects) {
		if (effect.type === 'exposure') filters.push(`brightness(${Math.max(0, 1 + effect.value)})`);
		else if (effect.type === 'contrast') filters.push(`contrast(${Math.max(0, 1 + effect.value)})`);
		else if (effect.type === 'saturation')
			filters.push(`saturate(${Math.max(0, 1 + effect.value)})`);
		else if (effect.type === 'temperature') {
			filters.push(`sepia(${Math.abs(effect.value) * 0.18})`);
			filters.push(`hue-rotate(${effect.value * -18}deg)`);
		} else if (effect.type === 'tint') {
			filters.push(`hue-rotate(${effect.value * 22}deg)`);
		} else if (effect.type === 'blur') filters.push(`blur(${Math.max(0, effect.value)}px)`);
	}
	return filters.join(' ') || 'none';
}

function collectAudioSegments(project: VideoProjectDocumentV1): AudioSegment[] {
	const primary = derivePrimarySequence(project).map((item) => {
		const clip = project.primary_sequence[item.index]!;
		return segmentFromPrimary(clip, item.timeline_start_us, item.duration_us);
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
	durationUS: number,
	segments: AudioSegment[],
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
