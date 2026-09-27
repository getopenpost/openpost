import type { TimelineItem } from '../project/types';
import type { TextRasterContext } from '../media/text-raster';
import { timerValue } from './timer';
import { paintSculptedTimer } from './sculpted-timer';

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
	const x = width / 2,
		y = height / 2;
	const color = timer.progressColor ?? item.color ?? '#ffffff';
	const track = timer.trackColor ?? color;
	const thickness =
		Math.max(1, Math.min(25, timer.thickness ?? (timer.style === 'bar' ? 8 : 3.5))) / 100;
	const radius = size * Math.min(0.4, 0.48 - thickness / 2);
	const segments = Math.max(1, Math.min(60, Math.round(timer.segments ?? 1)));
	context.save();
	context.lineWidth = size * thickness;
	context.lineCap = timer.rounded === false ? 'butt' : 'round';
	if (timer.style === 'ring' || timer.style === 'bar') {
		const start = ((timer.startAngle ?? -90) * Math.PI) / 180;
		const gap = segments > 1 ? 0.12 : 0;
		function progressShape(fraction: number): void {
			for (let n = 0; n < segments; n++) {
				const amount = Math.max(0, Math.min(1 - gap, fraction * segments - n));
				if (amount <= 0) continue;
				context.beginPath();
				if (timer.style === 'ring') {
					const from = start + ((n + gap / 2) / segments) * Math.PI * 2;
					const to = from + (amount / segments) * Math.PI * 2;
					const outer = radius + context.lineWidth / 2;
					const inner = radius - context.lineWidth / 2;
					// Round within the segment, so even thick, closely spaced segments keep their gaps.
					const corner =
						timer.rounded === false || amount === 1
							? 0
							: Math.min(context.lineWidth / 2, ((to - from) * inner) / 2);
					const point = (r: number, angle: number): [number, number] => [
						x + r * Math.cos(angle),
						y + r * Math.sin(angle)
					];
					context.arc(x, y, outer, from + corner / outer, to - corner / outer);
					context.quadraticCurveTo(...point(outer, to), ...point(outer - corner, to));
					context.lineTo(...point(inner + corner, to));
					context.quadraticCurveTo(...point(inner, to), ...point(inner, to - corner / inner));
					context.arc(x, y, inner, to - corner / inner, from + corner / inner, true);
					context.quadraticCurveTo(...point(inner, from), ...point(inner + corner, from));
					context.lineTo(...point(outer - corner, from));
					context.quadraticCurveTo(...point(outer, from), ...point(outer, from + corner / outer));
					context.closePath();
					context.fill();
				} else {
					const barWidth = (width * 0.9) / segments;
					const barHeight = height * thickness;
					context.roundRect(
						width * 0.05 + (n + gap / 2) * barWidth,
						height * 0.86 - barHeight / 2,
						amount * barWidth,
						barHeight,
						timer.rounded === false ? 0 : Math.min(barHeight / 2, (amount * barWidth) / 2)
					);
					context.fill();
				}
			}
		}
		context.strokeStyle = context.fillStyle = track;
		context.globalAlpha = Math.max(0, Math.min(1, timer.trackOpacity ?? 0.2));
		progressShape(1);
		context.strokeStyle = context.fillStyle = color;
		context.globalAlpha = 1;
		progressShape(value.fraction);
	} else if (timer.style === 'bomb' || timer.style === 'tomato') {
		paintSculptedTimer(context, timer, value, width, height, (frame - item.from) / fps);
	}
	context.restore();
	return {
		...item,
		text: timer.showValue === false ? '' : value.text,
		textSpans: undefined,
		textStylePresetId: undefined
	};
}
