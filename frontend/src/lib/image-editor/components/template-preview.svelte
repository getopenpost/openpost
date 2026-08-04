<script lang="ts">
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import type { ImageEditorDocument, ImageEditorLayer, ImageEditorPage } from '../types';
	import { imageEditorPageBackground } from '../document';
	import { normalizedGradientStops } from '../gradient';

	let {
		document,
		class: className = '',
		label,
		page: explicitPage,
		compact = false
	}: {
		document: ImageEditorDocument;
		class?: string;
		label?: string;
		page?: ImageEditorPage;
		compact?: boolean;
	} = $props();

	let page = $derived(explicitPage ?? document.pages[0]);
	let background = $derived(page ? imageEditorPageBackground(page) : null);
	let backgroundGradientStops = $derived(
		background?.type === 'gradient' && background.gradient
			? normalizedGradientStops(background.gradient.stops, background.gradient.reverse)
			: []
	);
	let isWide = $derived(document.width_px / document.height_px >= 4 / 3);

	function layerTransform(layer: ImageEditorLayer): string {
		const { x, y, width, height, rotation, flip_x, flip_y } = layer.transform;
		const centerX = x + width / 2;
		const centerY = y + height / 2;
		return [
			`translate(${centerX} ${centerY})`,
			`rotate(${rotation})`,
			`scale(${flip_x ? -1 : 1} ${flip_y ? -1 : 1})`,
			`translate(${-centerX} ${-centerY})`
		].join(' ');
	}

	function imageFit(layer: ImageEditorLayer): string {
		if (layer.image?.fit === 'stretch') return 'none';
		return layer.image?.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
	}

	function backgroundImageFit(): string {
		if (background?.type !== 'image' || background.image?.fit === 'stretch') return 'none';
		return background.image?.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
	}

	function paintX(layer: ImageEditorLayer, value: number): number {
		return (
			layer.transform.x +
			(value / Math.max(1, layer.paint?.source_width ?? layer.transform.width)) *
				layer.transform.width
		);
	}

	function paintY(layer: ImageEditorLayer, value: number): number {
		return (
			layer.transform.y +
			(value / Math.max(1, layer.paint?.source_height ?? layer.transform.height)) *
				layer.transform.height
		);
	}
</script>

<div
	class="flex size-full items-center justify-center overflow-hidden bg-neutral-800 {compact
		? 'p-0.5'
		: 'p-3'} {className}"
>
	{#if page}
		<svg
			viewBox={`0 0 ${document.width_px} ${document.height_px}`}
			role="img"
			aria-label={label || document.title}
			class="template-preview-frame block max-h-full max-w-full shadow-sm"
			style:width={isWide ? '100%' : 'auto'}
			style:height={isWide ? 'auto' : '100%'}
		>
			{#if background?.type === 'gradient' && background.gradient}
				<defs>
					{#if background.gradient.type === 'radial'}
						<radialGradient
							id={`page-background-${page.id}`}
							cx={background.gradient.start.x / document.width_px}
							cy={background.gradient.start.y / document.height_px}
							r={Math.hypot(
								background.gradient.end.x - background.gradient.start.x,
								background.gradient.end.y - background.gradient.start.y
							) / Math.max(document.width_px, document.height_px)}
						>
							{#each backgroundGradientStops as stop (`${stop.offset}:${stop.color}`)}
								<stop offset={stop.offset} stop-color={stop.color} />
							{/each}
						</radialGradient>
					{:else}
						<linearGradient
							id={`page-background-${page.id}`}
							gradientUnits="userSpaceOnUse"
							x1={background.gradient.start.x}
							y1={background.gradient.start.y}
							x2={background.gradient.end.x}
							y2={background.gradient.end.y}
						>
							{#each backgroundGradientStops as stop (`${stop.offset}:${stop.color}`)}
								<stop offset={stop.offset} stop-color={stop.color} />
							{/each}
						</linearGradient>
					{/if}
				</defs>
			{/if}
			{#if background?.type === 'solid'}
				<rect
					width={document.width_px}
					height={document.height_px}
					fill={background.color || page.background_color}
					opacity={background.opacity}
				/>
			{:else if background?.type === 'gradient' && background.gradient}
				<rect
					width={document.width_px}
					height={document.height_px}
					fill={`url(#page-background-${page.id})`}
					opacity={background.opacity}
				/>
			{:else if background?.type === 'image' && background.image}
				<image
					href={getAuthenticatedMediaURL(`/media/${background.image.media_id}`)}
					width={document.width_px}
					height={document.height_px}
					opacity={background.opacity}
					preserveAspectRatio={backgroundImageFit()}
				/>
			{/if}
			{#each page.layers as layer (layer.id)}
				{#if layer.visible && layer.type !== 'group'}
					<g transform={layerTransform(layer)} opacity={layer.opacity}>
						{#if layer.shape?.kind === 'ellipse'}
							<ellipse
								cx={layer.transform.x + layer.transform.width / 2}
								cy={layer.transform.y + layer.transform.height / 2}
								rx={layer.transform.width / 2}
								ry={layer.transform.height / 2}
								fill={layer.shape.fill}
								stroke={layer.shape.stroke}
								stroke-width={layer.shape.stroke_width}
							/>
						{:else if layer.shape?.kind === 'line'}
							<line
								x1={layer.transform.x}
								y1={layer.transform.y + layer.transform.height / 2}
								x2={layer.transform.x + layer.transform.width}
								y2={layer.transform.y + layer.transform.height / 2}
								stroke={layer.shape.stroke || layer.shape.fill}
								stroke-width={Math.max(1, layer.shape.stroke_width)}
								stroke-linecap="round"
							/>
						{:else if layer.shape}
							<rect
								x={layer.transform.x}
								y={layer.transform.y}
								width={layer.transform.width}
								height={layer.transform.height}
								rx={layer.shape.kind === 'rounded_rectangle' ? layer.shape.radius : 0}
								fill={layer.shape.fill}
								stroke={layer.shape.stroke}
								stroke-width={layer.shape.stroke_width}
							/>
						{:else if layer.image}
							<image
								href={getAuthenticatedMediaURL(`/media/${layer.image.media_id}`)}
								x={layer.transform.x}
								y={layer.transform.y}
								width={layer.transform.width}
								height={layer.transform.height}
								preserveAspectRatio={imageFit(layer)}
							/>
						{:else if layer.paint?.kind === 'stroke'}
							<polyline
								points={layer.paint.points
									.map((point) => `${paintX(layer, point.x)},${paintY(layer, point.y)}`)
									.join(' ')}
								fill="none"
								stroke={layer.paint.color}
								stroke-width={layer.paint.size *
									Math.min(
										layer.transform.width / Math.max(1, layer.paint.source_width),
										layer.transform.height / Math.max(1, layer.paint.source_height)
									)}
								stroke-opacity={layer.paint.opacity}
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						{:else if layer.paint?.kind === 'fill'}
							<g fill={layer.paint.color} fill-opacity={layer.paint.opacity}>
								{#each layer.paint.spans as span, index (`${span.y}:${span.x}:${index}`)}
									<rect
										x={paintX(layer, span.x)}
										y={paintY(layer, span.y)}
										width={(span.width / Math.max(1, layer.paint.source_width)) *
											layer.transform.width}
										height={layer.transform.height / Math.max(1, layer.paint.source_height)}
									/>
								{/each}
							</g>
						{:else if layer.text}
							<foreignObject
								x={layer.transform.x}
								y={layer.transform.y}
								width={layer.transform.width}
								height={layer.transform.height}
							>
								<div
									xmlns="http://www.w3.org/1999/xhtml"
									class="flex size-full items-center overflow-hidden whitespace-pre-wrap"
									style:font-family={layer.text.font_family}
									style:font-size={`${layer.text.font_size}px`}
									style:font-style={layer.text.font_style}
									style:font-weight={layer.text.font_weight}
									style:line-height={layer.text.line_height}
									style:letter-spacing={`${layer.text.letter_spacing}px`}
									style:color={layer.text.color}
									style:text-align={layer.text.align}
									style:justify-content={layer.text.align === 'left'
										? 'flex-start'
										: layer.text.align === 'right'
											? 'flex-end'
											: 'center'}
									style:background={layer.text.highlight_color || 'transparent'}
								>
									{layer.text.text}
								</div>
							</foreignObject>
						{/if}
					</g>
				{/if}
			{/each}
		</svg>
	{/if}
</div>

<style>
	.template-preview-frame {
		--image-editor-checker-light: color-mix(in oklch, var(--background) 72%, var(--foreground));
		--image-editor-checker-dark: color-mix(in oklch, var(--background) 58%, var(--foreground));
		background-color: var(--image-editor-checker-light);
		background-image:
			linear-gradient(45deg, var(--image-editor-checker-dark) 25%, transparent 25%),
			linear-gradient(-45deg, var(--image-editor-checker-dark) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--image-editor-checker-dark) 75%),
			linear-gradient(-45deg, transparent 75%, var(--image-editor-checker-dark) 75%);
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
		background-size: 16px 16px;
	}
</style>
