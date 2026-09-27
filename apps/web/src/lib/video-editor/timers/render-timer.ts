import type { TimelineItem } from '../project/types';
import type { TextRasterContext } from '../media/text-raster';
import { timerValue } from './timer';

/** Authored timer artwork is shared by the preview and export text raster. */
export function paintTimer(
	context: TextRasterContext,
	item: TimelineItem,
	width: number,
	height: number,
	frame: number,
	fps: number
): TimelineItem {
	const timer = item.timer!;
	const value = timerValue(timer, frame - item.from, item.durationInFrames, fps);
	const size = Math.min(width, height);
	const x = width / 2;
	const y = height / 2;
	const radius = size * 0.4;
	const color = item.color ?? '#ffffff';
	context.save();
	context.lineWidth = Math.max(2, size * 0.035);
	context.lineCap = 'round';
	if (timer.style === 'ring') {
		context.strokeStyle = color;
		context.globalAlpha = 0.2;
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.stroke();
		context.globalAlpha = 1;
		context.beginPath();
		context.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * value.fraction);
		context.stroke();
	} else if (timer.style === 'bar') {
		context.fillStyle = color;
		context.globalAlpha = 0.2;
		context.fillRect(width * 0.05, height * 0.82, width * 0.9, height * 0.08);
		context.globalAlpha = 1;
		context.fillRect(width * 0.05, height * 0.82, width * 0.9 * value.fraction, height * 0.08);
	} else if (timer.style === 'bomb' || timer.style === 'tomato') {
		const tomato = timer.style === 'tomato';
		if (!value.finished) {
			const gradient = context.createRadialGradient(
				x - radius * 0.4,
				y - radius * 0.4,
				0,
				x,
				y,
				radius * 1.2
			);
			gradient.addColorStop(0, tomato ? '#ff8060' : '#686c7a');
			gradient.addColorStop(1, tomato ? '#a51d18' : '#141620');
			context.fillStyle = gradient;
			context.beginPath();
			context.arc(x, y, radius * 0.85, 0, Math.PI * 2);
			context.fill();
			if (tomato) {
				context.fillStyle = '#408542';
				context.beginPath();
				for (let i = 0; i < 10; i++) {
					const angle = (i * Math.PI) / 5 - Math.PI / 2;
					const r = radius * (i % 2 ? 0.12 : 0.4);
					context.lineTo(x + Math.cos(angle) * r, y - radius * 0.7 + Math.sin(angle) * r * 0.5);
				}
				context.closePath();
				context.fill();
			} else {
				context.strokeStyle = '#d9b475';
				context.beginPath();
				context.moveTo(x + radius * 0.4, y - radius * 0.72);
				const fuseX = x + radius * (0.4 + 0.4 * value.fraction);
				const fuseY = y - radius * (0.72 + 0.3 * value.fraction);
				context.lineTo(fuseX, fuseY);
				context.stroke();
				context.fillStyle = '#ffbe42';
				context.beginPath();
				context.arc(fuseX, fuseY, size * 0.025, 0, Math.PI * 2);
				context.fill();
			}
		} else {
			const expansion = 0.55 + Math.sin((value.finishProgress * Math.PI) / 2) * 0.55;
			context.globalAlpha = 1 - value.finishProgress * 0.65;
			context.fillStyle = tomato ? '#e84632' : '#ff8a32';
			context.beginPath();
			for (let i = 0; i < 24; i++) {
				const angle = (i * Math.PI) / 12;
				const distance = radius * expansion * (i % 2 ? 0.65 : 1);
				context.lineTo(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
			}
			context.closePath();
			context.fill();
			context.fillStyle = tomato ? '#ff6551' : '#ffd15c';
			for (let i = 0; i < 12; i++) {
				const angle = (i * Math.PI) / 6;
				const distance = radius * expansion * (0.8 + (i % 3) * 0.08);
				context.beginPath();
				context.arc(
					x + Math.cos(angle) * distance,
					y + Math.sin(angle) * distance,
					radius * (0.04 + (i % 3) * 0.02),
					0,
					Math.PI * 2
				);
				context.fill();
			}
		}
	}
	context.restore();
	return {
		...item,
		text: value.text,
		textSpans: undefined,
		textStylePresetId: undefined
	};
}
