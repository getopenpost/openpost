<!--
	Bespoke power-window pane: shape selector, Window / Matte / Correction
	groups, and a UV-space gizmo preview with center + size drag handles.
	Ported from FreeCut (MIT) `GpuPowerWindowPanel` (shape + window/matte/
	correction grouping, edit-on-canvas toggle); the gizmo outline reuses
	`powerWindowBoundaryPoints` so the preview draws exactly what the
	`powerWindowFragment` shader masks. Drags preview live through `ondraft`
	and commit center/size atomically through `oncommitmany` (one undo step).
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type {
		GpuParamSchema,
		GpuParamValue,
		GpuParamValues,
		GpuShaderDefinition
	} from '$lib/video-editor/effects/gpu/types';
	import { gpuParamLabel } from '$lib/video-editor/effects/gpu/i18n';
	import { readNumber } from '$lib/video-editor/effects/gpu/types';
	import { powerWindowBoundaryPoints } from '$lib/video-editor/preview/power-window-outline';
	import GpuParamControl from './gpu-param-control.svelte';
	import AppSelect from '$lib/components/app-select.svelte';

	const WINDOW_KEYS = ['centerX', 'centerY', 'sizeX', 'sizeY', 'rotation', 'feather'] as const;
	const MATTE_KEYS = ['showMask', 'invertMask'] as const;
	const CORRECTION_KEYS = ['exposure', 'saturation', 'temperature', 'tint', 'strength'] as const;

	let {
		effectLabel,
		definition,
		values,
		disabled = false,
		oncommit,
		oncommitmany,
		ondraft,
		keyframe
	}: {
		effectLabel: string;
		definition: GpuShaderDefinition;
		values: GpuParamValues;
		disabled?: boolean;
		oncommit: (paramName: string, value: GpuParamValue) => void;
		oncommitmany: (updates: Record<string, GpuParamValue>) => void;
		ondraft: (params: GpuParamValues | null) => void;
		keyframe: (paramName: string) =>
			| {
					autoEnabled: boolean;
					hasTrack: boolean;
					atCurrentFrame: boolean;
					canKeyframe: boolean;
					onToggleAuto: () => void;
					onToggleKeyframe: () => void;
			  }
			| undefined;
	} = $props();

	const schemaByName = $derived(new Map(definition.schema.map((param) => [param.name, param])));
	const shapeParam = $derived(schemaByName.get('shape'));
	const shapeValue = $derived(values.shape === 'rectangle' ? 'rectangle' : 'ellipse');

	// Gizmo renders UV space (0..1) into a 16:9 preview box. The outline
	// helper already accounts for the shader's X aspect scaling, so mapping
	// u -> x * 100, v -> y * 56.25 draws exactly what the shader masks.
	const PREVIEW_ASPECT = 16 / 9;
	const outline = $derived(powerWindowBoundaryPoints(values, PREVIEW_ASPECT));
	const center = $derived({
		x: readNumber(values, 'centerX', 0.5) * 100,
		y: readNumber(values, 'centerY', 0.5) * 56.25
	});

	function schemaFor(name: string): GpuParamSchema | undefined {
		return schemaByName.get(name);
	}

	function toggleBoolean(name: string): void {
		if (disabled) return;
		oncommit(name, values[name] !== true);
	}

	function pointsAttribute(points: { x: number; y: number }[]): string {
		return points
			.map((point) => `${(point.x * 100).toFixed(2)},${(point.y * 56.25).toFixed(2)}`)
			.join(' ');
	}

	/** Convert preview-box coords back to shader UV. */
	function toUv(point: { x: number; y: number }) {
		return { x: point.x / 100, y: point.y / 56.25 };
	}

	function sizeFromCorner(uv: { x: number; y: number }) {
		const centerX = readNumber(values, 'centerX', 0.5);
		const centerY = readNumber(values, 'centerY', 0.5);
		return {
			sizeX: Math.min(1.5, Math.max(0.02, Math.abs(uv.x - centerX) * 2)),
			sizeY: Math.min(1.5, Math.max(0.02, Math.abs(uv.y - centerY) * 2))
		} satisfies Record<string, GpuParamValue>;
	}

	type DragKind = 'center' | 'size';
	let drag = $state<{ kind: DragKind; pointerId: number } | null>(null);

	function svgPoint(event: PointerEvent): { x: number; y: number } | null {
		// SAFETY: pointer handlers are attached to elements inside this SVG overlay, so
		// currentTarget is either the root SVG or a graphics element owning one.
		const svg =
			event.currentTarget instanceof SVGSVGElement
				? event.currentTarget
				: (event.currentTarget as SVGGraphicsElement | null)?.ownerSVGElement;
		if (!svg) return null;
		const matrix = svg.getScreenCTM();
		if (!matrix) return null;
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		return {
			x: Math.min(100, Math.max(0, point.x)),
			y: Math.min(100, Math.max(0, point.y))
		};
	}

	function startDrag(event: PointerEvent, kind: DragKind): void {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		drag = { kind, pointerId: event.pointerId };
		// SAFETY: Svelte attaches this handler to an Element, so currentTarget is an Element.
		(event.currentTarget as Element)?.setPointerCapture?.(event.pointerId);
	}

	function moveDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const point = svgPoint(event);
		if (!point) return;
		if (drag.kind === 'center') {
			const uv = toUv(point);
			ondraft({ centerX: uv.x, centerY: uv.y });
		} else {
			const { sizeX, sizeY } = sizeFromCorner(toUv(point));
			ondraft({ sizeX, sizeY });
		}
	}

	function endDrag(event: PointerEvent): void {
		const active = drag;
		if (!active || event.pointerId !== active.pointerId) return;
		const point = svgPoint(event);
		drag = null;
		ondraft(null);
		if (!point) return;
		const uv = toUv(point);
		// Commit the dragged values atomically (one undo step).
		if (active.kind === 'center') {
			oncommitmany({ centerX: uv.x, centerY: uv.y });
		} else {
			oncommitmany(sizeFromCorner(uv));
		}
	}

	function beginDrag(event: PointerEvent, kind: DragKind): void {
		startDrag(event, kind);
	}
</script>

<div
	class="pt-1 pb-1 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
>
	{m.video_editor_power_window()}
</div>
<div class="pb-1" class:opacity-50={disabled}>
	<svg
		class="aspect-video w-full touch-none rounded border border-[var(--video-editor-border)] bg-black"
		viewBox="0 0 100 56.25"
		role="application"
		aria-label={`${effectLabel}: ${m.video_editor_power_window_gizmo()}`}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={() => {
			drag = null;
			ondraft(null);
		}}
	>
		<polygon
			points={pointsAttribute(outline.outer)}
			fill="rgba(255,255,255,0.06)"
			stroke="white"
			stroke-width="0.6"
			vector-effect="non-scaling-stroke"
			pointer-events="none"
		></polygon>
		{#if outline.inner}
			<polygon
				points={pointsAttribute(outline.inner)}
				fill="none"
				stroke="white"
				stroke-width="0.4"
				stroke-dasharray="1.5 1"
				vector-effect="non-scaling-stroke"
				opacity="0.6"
				pointer-events="none"
			></polygon>
		{/if}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<g
			role="button"
			tabindex="0"
			aria-label={m.video_editor_power_window_center()}
			class="cursor-move focus:outline-none"
			onpointerdown={(event) => beginDrag(event, 'center')}
			onkeydown={(event) => {
				const step = event.shiftKey ? 0.05 : 0.01;
				const centerX = readNumber(values, 'centerX', 0.5);
				const centerY = readNumber(values, 'centerY', 0.5);
				let next: Record<string, GpuParamValue> | null = null;
				if (event.key === 'ArrowLeft') next = { centerX: centerX - step };
				else if (event.key === 'ArrowRight') next = { centerX: centerX + step };
				else if (event.key === 'ArrowUp') next = { centerY: centerY - step };
				else if (event.key === 'ArrowDown') next = { centerY: centerY + step };
				if (!next) return;
				event.preventDefault();
				oncommitmany(next);
			}}
		>
			<circle cx={center.x} cy={center.y} r="2.2" fill="white" pointer-events="none"></circle>
			<circle cx={center.x} cy={center.y} r="5" fill="transparent" pointer-events="all"></circle>
		</g>
	</svg>
	<p class="pt-0.5 text-[10px] text-[var(--video-editor-muted)]">
		{m.video_editor_power_window_gizmo_hint()}
	</p>
</div>
{#if shapeParam}
	{@const label = gpuParamLabel(shapeParam)}
	<label class="mt-1 flex items-center justify-between gap-2 text-xs">
		<span class="text-[var(--video-editor-muted)]">{label}</span>
		<AppSelect
			value={shapeValue}
			options={[
				{ value: 'ellipse', label: m.video_editor_power_window_ellipse() },
				{ value: 'rectangle', label: m.video_editor_power_window_rectangle() }
			]}
			ariaLabel={label}
			{disabled}
			class="h-7 text-xs"
			onValueChange={(value) => oncommit('shape', value)}
		/>
	</label>
{/if}
{#each WINDOW_KEYS as name (name)}
	{@const param = schemaFor(name)}
	{#if param}
		<GpuParamControl
			{param}
			value={values[name]}
			{effectLabel}
			oncommit={(value) => oncommit(name, value)}
			keyframe={keyframe(name)}
		/>
	{/if}
{/each}

<div
	class="pt-2 pb-1 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
>
	{m.video_editor_power_window_matte()}
</div>
<div class="flex gap-1 pb-1">
	{#each MATTE_KEYS as name (name)}
		{@const param = schemaFor(name)}
		{@const active = values[name] === true}
		{@const label = param ? gpuParamLabel(param) : name}
		<button
			type="button"
			class="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded border border-[var(--video-editor-border)] px-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-40 {active
				? 'bg-[var(--video-editor-primary)] text-[var(--video-editor-primary-text)]'
				: 'hover:bg-[var(--video-editor-control-hover)]'}"
			aria-pressed={active}
			{disabled}
			onclick={() => toggleBoolean(name)}
		>
			{label}
		</button>
	{/each}
</div>

<div
	class="pt-2 pb-1 text-[10px] font-medium tracking-wide text-[var(--video-editor-muted)] uppercase"
>
	{m.video_editor_power_window_correction()}
</div>
{#each CORRECTION_KEYS as name (name)}
	{@const param = schemaFor(name)}
	{#if param}
		<GpuParamControl
			{param}
			value={values[name]}
			{effectLabel}
			oncommit={(value) => oncommit(name, value)}
			keyframe={keyframe(name)}
		/>
	{/if}
{/each}
