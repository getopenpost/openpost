import { buildScopeBins, type ScopeBins } from './scopes';

export type ColorScope = 'histogram' | 'waveform' | 'parade' | 'vectorscope';

function clear(ctx: CanvasRenderingContext2D, width: number, height: number): void {
	ctx.fillStyle = '#0a0a0a';
	ctx.fillRect(0, 0, width, height);
}

function drawIreGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
	ctx.save();
	ctx.strokeStyle = 'rgba(170, 160, 150, 0.18)';
	ctx.fillStyle = 'rgba(205, 195, 185, 0.68)';
	ctx.lineWidth = 1;
	ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
	for (const level of [0, 25, 50, 75, 100]) {
		const y = Math.round(height - 1 - (level / 100) * (height - 1));
		ctx.beginPath();
		ctx.moveTo(0, y + 0.5);
		ctx.lineTo(width, y + 0.5);
		ctx.stroke();
		ctx.fillText(String(level), 3, Math.max(9, y - 2));
	}
	ctx.restore();
}

function peak(values: readonly Uint32Array[]): number {
	let result = 1;
	for (const value of values) {
		for (const density of value) result = Math.max(result, density);
	}
	return result;
}

function drawDensity(
	ctx: CanvasRenderingContext2D,
	values: Uint32Array,
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
	color: readonly [number, number, number],
	maximum: number
): void {
	const normalizer = Math.log1p(maximum);
	for (let y = 0; y < sourceHeight; y++) {
		for (let x = 0; x < sourceWidth; x++) {
			const count = values[y * sourceWidth + x] ?? 0;
			if (count === 0) continue;
			const strength = Math.log1p(count) / normalizer;
			ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.18 + strength * 0.72})`;
			ctx.fillRect(
				(x / sourceWidth) * width,
				(y / sourceHeight) * height,
				Math.max(1, width / sourceWidth),
				Math.max(1, height / sourceHeight)
			);
		}
	}
}

function drawWaveform(
	ctx: CanvasRenderingContext2D,
	bins: ScopeBins,
	width: number,
	height: number
): void {
	drawIreGrid(ctx, width, height);
	drawDensity(ctx, bins.waveform, 256, 128, width, height, [105, 239, 176], peak([bins.waveform]));
}

function drawParade(
	ctx: CanvasRenderingContext2D,
	bins: ScopeBins,
	width: number,
	height: number
): void {
	drawIreGrid(ctx, width, height);
	const channels = [
		{ values: bins.parade.red, color: [255, 90, 95] as const, label: 'R' },
		{ values: bins.parade.green, color: [90, 235, 135] as const, label: 'G' },
		{ values: bins.parade.blue, color: [95, 140, 255] as const, label: 'B' }
	];
	const laneWidth = width / 3;
	const maximum = peak(channels.map((channel) => channel.values));
	channels.forEach((channel, index) => {
		ctx.save();
		ctx.translate(index * laneWidth, 0);
		drawDensity(ctx, channel.values, 256, 128, laneWidth, height, channel.color, maximum);
		ctx.fillStyle = 'rgba(220, 210, 200, 0.82)';
		ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
		ctx.fillText(channel.label, 4, 10);
		ctx.restore();
	});
	ctx.save();
	ctx.strokeStyle = 'rgba(170, 160, 150, 0.26)';
	for (let lane = 1; lane < 3; lane++) {
		const x = Math.round(lane * laneWidth) + 0.5;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
	}
	ctx.restore();
}

function drawHistogram(
	ctx: CanvasRenderingContext2D,
	bins: ScopeBins,
	width: number,
	height: number
): void {
	drawIreGrid(ctx, width, height);
	const channels = [
		{ values: bins.histogram.red, color: '#ff5a5f' },
		{ values: bins.histogram.green, color: '#5aeb87' },
		{ values: bins.histogram.blue, color: '#5f8cff' }
	];
	const maximum = peak(channels.map((channel) => channel.values));
	for (const channel of channels) {
		ctx.strokeStyle = channel.color;
		ctx.lineWidth = 1.25;
		ctx.globalAlpha = 0.72;
		ctx.beginPath();
		for (let index = 0; index < 256; index++) {
			const strength = Math.sqrt((channel.values[index] ?? 0) / maximum);
			const x = (index / 255) * width;
			const y = height - strength * (height - 1);
			if (index === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}

function drawVectorscopeGraticule(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number
): void {
	const centerX = width / 2;
	const centerY = height / 2;
	const radius = Math.min(width, height) * 0.46;
	ctx.save();
	ctx.strokeStyle = 'rgba(170, 160, 150, 0.28)';
	ctx.fillStyle = 'rgba(205, 195, 185, 0.62)';
	ctx.lineWidth = 1;
	for (const scale of [1, 0.75, 0.25]) {
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius * scale, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.beginPath();
	ctx.moveTo(centerX, centerY - radius);
	ctx.lineTo(centerX, centerY + radius);
	ctx.moveTo(centerX - radius, centerY);
	ctx.lineTo(centerX + radius, centerY);
	ctx.stroke();
	const skinAngle = (-123 * Math.PI) / 180;
	ctx.strokeStyle = 'rgba(235, 165, 115, 0.42)';
	ctx.beginPath();
	ctx.moveTo(centerX, centerY);
	ctx.lineTo(centerX + Math.cos(skinAngle) * radius, centerY + Math.sin(skinAngle) * radius);
	ctx.stroke();
	const targets = [
		{ label: 'R', angle: -103 },
		{ label: 'Y', angle: -61 },
		{ label: 'G', angle: 13 },
		{ label: 'C', angle: 77 },
		{ label: 'B', angle: 119 },
		{ label: 'M', angle: 193 }
	];
	ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
	for (const target of targets) {
		const angle = (target.angle * Math.PI) / 180;
		ctx.fillText(
			target.label,
			centerX + Math.cos(angle) * radius * 0.78 - 3,
			centerY + Math.sin(angle) * radius * 0.78 + 3
		);
	}
	ctx.restore();
}

function drawVectorscope(
	ctx: CanvasRenderingContext2D,
	bins: ScopeBins,
	width: number,
	height: number
): void {
	drawVectorscopeGraticule(ctx, width, height);
	drawDensity(
		ctx,
		bins.vectorscope,
		128,
		128,
		width,
		height,
		[85, 238, 185],
		peak([bins.vectorscope])
	);
}

export function drawCpuScope(
	ctx: CanvasRenderingContext2D,
	image: ImageData,
	scope: ColorScope,
	width: number,
	height: number
): void {
	clear(ctx, width, height);
	const bins = buildScopeBins(image.data, image.width, image.height);
	if (scope === 'histogram') drawHistogram(ctx, bins, width, height);
	else if (scope === 'waveform') drawWaveform(ctx, bins, width, height);
	else if (scope === 'parade') drawParade(ctx, bins, width, height);
	else drawVectorscope(ctx, bins, width, height);
}
