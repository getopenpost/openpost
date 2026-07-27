<script lang="ts">
	import { getAuthenticatedMediaURL } from '$lib/media-url';
	import type { StudioDocument, StudioLayer, StudioPage } from '../types';

	let {
		document,
		class: className = '',
		label,
		page: explicitPage,
		compact = false
	}: {
		document: StudioDocument;
		class?: string;
		label?: string;
		page?: StudioPage;
		compact?: boolean;
	} = $props();

	let page = $derived(explicitPage ?? document.pages[0]);
	let isWide = $derived(document.width_px / document.height_px >= 4 / 3);

	function layerTransform(layer: StudioLayer): string {
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

	function imageFit(layer: StudioLayer): string {
		if (layer.image?.fit === 'stretch') return 'none';
		return layer.image?.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
	}

	function paintX(layer: StudioLayer, value: number): number {
		return (
			layer.transform.x +
			(value / Math.max(1, layer.paint?.source_width ?? layer.transform.width)) *
				layer.transform.width
		);
	}

	function paintY(layer: StudioLayer, value: number): number {
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
			class="block max-h-full max-w-full shadow-sm"
			style:width={isWide ? '100%' : 'auto'}
			style:height={isWide ? 'auto' : '100%'}
		>
			<rect width={document.width_px} height={document.height_px} fill={page.background_color} />
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
