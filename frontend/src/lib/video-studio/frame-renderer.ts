import {
	captionDisplayText,
	type VideoEffect,
	type VideoPresentation,
	type VideoSource,
	type VisualTrackItem
} from '@openpost/video-project';
import type { AudioBufferSink, Input, VideoSample, VideoSampleSink } from 'mediabunny';
import { evaluateFrame, type EvaluatedPrimaryLayer } from './render-graph';
import type { SequentialVideoSampler } from './sequential-video-sampler';

export interface SourceRuntime {
	source: VideoSource;
	input?: Input;
	video?: VideoSampleSink;
	videoSampler?: SequentialVideoSampler<VideoSample>;
	audio?: AudioBufferSink;
	image?: ImageBitmap;
}

export async function drawEvaluatedFrame(
	context: OffscreenCanvasRenderingContext2D,
	frame: ReturnType<typeof evaluateFrame>,
	resources: Map<string, SourceRuntime>
): Promise<void> {
	context.save();
	context.fillStyle = frame.background_color;
	context.fillRect(0, 0, frame.width, frame.height);
	for (const layer of frame.primary_layers) {
		const runtime = resources.get(layer.source_id);
		if (!runtime) continue;
		const sample = runtime.videoSampler
			? await runtime.videoSampler.sample(layer.source_time_us / 1_000_000)
			: runtime.video
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
		const timestamp = (item.source_in_us + Math.round(localTimeUS * item.speed)) / 1_000_000;
		const sample = runtime.videoSampler
			? await runtime.videoSampler.sample(timestamp)
			: runtime.video
				? await runtime.video.getSample(timestamp)
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
			context.textAlign = 'left';
			context.fillStyle = caption.style.emphasis_color;
			context.fillText(active, width / 2 - metrics.width / 2 + beforeWidth, y);
			context.textAlign = 'center';
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
