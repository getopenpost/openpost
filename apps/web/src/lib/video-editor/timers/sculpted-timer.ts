import type { TextRasterContext } from '../media/text-raster';
import type { TimerSettings, timerValue } from './timer';

type TimerValue = ReturnType<typeof timerValue>;
const TAU = Math.PI * 2;

function ellipse(
	ctx: TextRasterContext,
	x: number,
	y: number,
	rx: number,
	ry: number,
	fill: string | CanvasGradient,
	rotation = 0
): void {
	ctx.fillStyle = fill;
	ctx.beginPath();
	ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
	ctx.fill();
}

function radial(
	ctx: TextRasterContext,
	x: number,
	y: number,
	radius: number,
	stops: Array<[number, string]>
): CanvasGradient {
	const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
	for (const [offset, color] of stops) gradient.addColorStop(offset, color);
	return gradient;
}

function bomb(
	ctx: TextRasterContext,
	color: string,
	accent: string,
	fraction: number,
	seconds: number
): void {
	// Work in a fixed illustration space, scaled once by the caller for preview and export.
	ctx.save();
	ctx.rotate(-0.18);
	const collar = ctx.createLinearGradient(-18, 0, 18, 0);
	collar.addColorStop(0, '#453323');
	collar.addColorStop(0.3, '#e2c58b');
	collar.addColorStop(0.5, '#9d7943');
	collar.addColorStop(0.75, '#f4d69a');
	collar.addColorStop(1, '#392d24');
	ctx.fillStyle = collar;
	ctx.beginPath();
	ctx.roundRect(-19, -100, 38, 29, 6);
	ctx.fill();
	for (let y = -95; y < -73; y += 5) {
		ctx.strokeStyle = '#322b2399';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(-17, y);
		ctx.lineTo(17, y);
		ctx.stroke();
	}
	// A curved, braided fuse burns toward the collar as the timer expires.
	const fuseLength = 0.1 + fraction * 0.9;
	let tipX = 0,
		tipY = -98;
	ctx.lineCap = 'round';
	for (let i = 0; i < 2; i++) {
		ctx.strokeStyle = i ? '#d8b983' : '#493726';
		ctx.lineWidth = i ? 5 : 9;
		ctx.beginPath();
		ctx.moveTo(0, -98);
		for (let n = 1; n <= 50; n++) {
			const t = (n / 50) * fuseLength;
			tipX = 52 * t;
			tipY = -98 - 32 * Math.sin(t * 1.8);
			ctx.lineTo(tipX, tipY);
		}
		ctx.stroke();
	}
	ctx.lineWidth = 1.3;
	ctx.strokeStyle = '#7d5637';
	for (let t = 0.05; t < fuseLength; t += 0.055) {
		const x = 52 * t,
			y = -98 - 32 * Math.sin(t * 1.8);
		ctx.beginPath();
		ctx.moveTo(x - 2, y - 3);
		ctx.lineTo(x + 2, y + 3);
		ctx.stroke();
	}
	ellipse(
		ctx,
		tipX,
		tipY,
		17,
		17,
		radial(ctx, tipX, tipY, 17, [
			[0, '#fff8cc'],
			[0.12, accent],
			[1, '#ff870000']
		])
	);
	for (let n = 0; n < 8; n++) {
		const angle = n * 2.4 + seconds * 3;
		const length = 6 + 7 * (0.5 + 0.5 * Math.sin(seconds * 15 + n));
		ctx.strokeStyle = n % 2 ? '#fff1b0' : accent;
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.moveTo(tipX + Math.cos(angle) * 4, tipY + Math.sin(angle) * 4);
		ctx.lineTo(tipX + Math.cos(angle) * length, tipY + Math.sin(angle) * length);
		ctx.stroke();
	}
	ctx.restore();

	ellipse(ctx, 0, 4, 88, 90, color);
	ctx.save();
	ctx.beginPath();
	ctx.ellipse(0, 4, 88, 90, 0, 0, TAU);
	ctx.clip();
	ellipse(
		ctx,
		0,
		4,
		88,
		90,
		radial(ctx, -36, -43, 145, [
			[0, '#ffffffa0'],
			[0.24, '#ffffff20'],
			[0.62, '#00000010'],
			[1, '#000000ed']
		])
	);
	// Reflected rim light, equatorial seam, and flush fasteners give the shell a metal finish.
	ctx.strokeStyle = '#d5e9ff44';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.ellipse(0, 3, 84, 87, 0, -2.9, -0.65);
	ctx.stroke();
	ctx.strokeStyle = '#00000088';
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.ellipse(0, 0, 90, 30, -0.2, 0, TAU);
	ctx.stroke();
	ctx.strokeStyle = '#ffffff25';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.ellipse(0, -2, 90, 30, -0.2, 0, TAU);
	ctx.stroke();
	for (const x of [-74, 74]) {
		for (const y of [-18, 17]) {
			ellipse(ctx, x, y, 3.6, 4.1, '#121923');
			ellipse(ctx, x - 0.8, y - 1, 2, 2.4, '#82909d');
		}
	}
	ellipse(
		ctx,
		-35,
		-46,
		30,
		10,
		radial(ctx, -35, -46, 32, [
			[0, '#ffffff70'],
			[1, '#ffffff00']
		]),
		-0.55
	);
	ctx.restore();
	const bezel = ctx.createLinearGradient(0, -40, 0, 46);
	bezel.addColorStop(0, '#101822');
	bezel.addColorStop(0.5, '#465364');
	bezel.addColorStop(1, '#88919c');
	ellipse(ctx, 0, 5, 58, 43, bezel);
	ellipse(ctx, 0, 3, 55, 40, '#101722');
	ellipse(
		ctx,
		0,
		-5,
		53,
		30,
		radial(ctx, -20, -26, 85, [
			[0, '#8194af38'],
			[1, '#0a101900']
		])
	);
}

function tomato(ctx: TextRasterContext, color: string, accent: string): void {
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(0, -70);
	ctx.bezierCurveTo(33, -91, 83, -65, 89, -25);
	ctx.bezierCurveTo(111, 17, 72, 87, 27, 87);
	ctx.bezierCurveTo(10, 99, -17, 95, -32, 85);
	ctx.bezierCurveTo(-82, 83, -104, 29, -91, -11);
	ctx.bezierCurveTo(-93, -60, -42, -94, 0, -70);
	ctx.fillStyle = color;
	ctx.fill();
	ctx.clip();
	ellipse(
		ctx,
		0,
		0,
		115,
		115,
		radial(ctx, -37, -38, 149, [
			[0, '#ffffff60'],
			[0.28, '#ffffff08'],
			[0.62, '#00000000'],
			[1, '#3b050be8']
		])
	);
	// Soft lobe shading follows the skin rather than drawing flat stripes on it.
	for (const x of [-63, -27, 28, 64]) {
		ctx.save();
		ctx.translate(x, 8);
		ctx.rotate(-x / 360);
		const shade = ctx.createLinearGradient(-22, 0, 22, 0);
		shade.addColorStop(0, '#3b050b00');
		shade.addColorStop(0.35, '#3b050b08');
		shade.addColorStop(0.52, '#3b050b18');
		shade.addColorStop(0.75, '#ffffff08');
		shade.addColorStop(1, '#ffffff00');
		ellipse(ctx, 0, 0, 22, 87, shade);
		ctx.restore();
	}
	ellipse(
		ctx,
		-35,
		-40,
		29,
		19,
		radial(ctx, -35, -40, 31, [
			[0, '#fff2d0a0'],
			[0.4, '#ffffff40'],
			[1, '#ffffff00']
		]),
		-0.5
	);
	// A few fixed droplets remain stable when scrubbing, including their refracted highlights.
	for (const [x, y, r] of [
		[-59, 3, 5],
		[56, 29, 4],
		[-34, 61, 3],
		[53, -22, 3],
		[-65, -23, 2]
	]) {
		ellipse(ctx, x!, y!, r!, r! * 1.2, '#46071066');
		ellipse(ctx, x! - 0.7, y! - 1, r! * 0.65, r! * 0.8, '#ffdacb65');
		ellipse(ctx, x! - 1, y! - 2, r! * 0.24, r! * 0.24, '#ffffffc0');
	}
	ctx.restore();
	ellipse(ctx, 0, -66, 25, 9, '#481a1590');
	for (let n = 0; n < 7; n++) {
		ctx.save();
		ctx.translate(0, -70);
		ctx.rotate((n * TAU) / 7 + 0.2);
		ctx.scale(1, 0.58);
		ctx.beginPath();
		ctx.moveTo(0, 4);
		ctx.bezierCurveTo(-12, -13, -18, -29, -5, -52);
		ctx.bezierCurveTo(3, -38, 18, -27, 0, 4);
		ctx.fillStyle = accent;
		ctx.fill();
		const leafShade = ctx.createLinearGradient(-12, 0, 10, -38);
		leafShade.addColorStop(0, '#001d09a0');
		leafShade.addColorStop(0.5, '#ffffff28');
		leafShade.addColorStop(1, '#ffffff00');
		ctx.fillStyle = leafShade;
		ctx.fill();
		ctx.strokeStyle = '#c2df7470';
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.quadraticCurveTo(-6, -22, -5, -43);
		ctx.stroke();
		ctx.restore();
	}
	ctx.strokeStyle = accent;
	ctx.lineWidth = 8;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(0, -73);
	ctx.bezierCurveTo(-6, -85, 2, -99, 13, -100);
	ctx.stroke();
	ctx.strokeStyle = '#ffffff55';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(-2, -76);
	ctx.quadraticCurveTo(-5, -92, 10, -98);
	ctx.stroke();
}

function completion(
	ctx: TextRasterContext,
	style: TimerSettings['style'],
	color: string,
	progress: number
): void {
	const expansion = 1 - Math.pow(1 - progress, 3);
	if (style === 'bomb') {
		ellipse(
			ctx,
			0,
			0,
			75 + expansion * 40,
			75 + expansion * 40,
			radial(ctx, 0, 0, 75 + expansion * 40, [
				[0, '#fffbe9'],
				[0.22, '#fff1a6'],
				[0.5, color],
				[1, '#ff5b0000']
			])
		);
	}
	for (let n = 0; n < 24; n++) {
		const angle = n * 2.39996;
		const distance = (35 + (n % 5) * 14) * (0.35 + expansion);
		const x = Math.cos(angle) * distance,
			y = Math.sin(angle) * distance + progress * progress * 26;
		const radius = (style === 'tomato' ? 8 : 5) + (n % 4) * 2;
		ctx.globalAlpha = Math.max(0, 1 - progress * 0.85);
		ellipse(
			ctx,
			x,
			y,
			radius,
			radius * (style === 'tomato' ? 0.65 : 1),
			radial(ctx, x - radius * 0.25, y - radius * 0.25, radius * 1.3, [
				[0, style === 'tomato' ? '#ffac73' : '#fff9dc'],
				[0.3, color],
				[1, style === 'tomato' ? '#88120f' : '#d5420000']
			]),
			angle
		);
	}
}

export function paintSculptedTimer(
	ctx: TextRasterContext,
	settings: TimerSettings,
	value: TimerValue,
	width: number,
	height: number,
	seconds: number
): void {
	const isTomato = settings.style === 'tomato';
	const color = settings.bodyColor ?? (isTomato ? '#e94025' : '#35404e');
	const accent = settings.accentColor ?? (isTomato ? '#498632' : '#ffc454');
	ctx.save();
	ctx.translate(width / 2, height / 2);
	const scale = Math.min(width, height) / (isTomato ? 285 : 320);
	ctx.scale(scale, scale);
	ellipse(
		ctx,
		7,
		101,
		80,
		12,
		radial(ctx, 7, 101, 80, [
			[0, '#00000066'],
			[1, '#00000000']
		])
	);
	if (value.finished && settings.finishEffect !== false)
		completion(ctx, settings.style, isTomato ? color : accent, value.finishProgress);
	else if (isTomato) tomato(ctx, color, accent);
	else bomb(ctx, color, accent, 1 - value.progress, seconds);
	ctx.restore();
}
