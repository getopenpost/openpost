<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		defaultLayerEffects,
		defaultLayerMask,
		DEFAULT_SHADOW_EFFECT,
		DEFAULT_STROKE_EFFECT
	} from '../effects';
	import { useImageEditor } from '../editor.svelte';
	import type {
		ImageEditorBlendMode,
		ImageEditorLayer,
		ImageEditorLayerEffects,
		ImageEditorLayerMask,
		ImageEditorLayerStrokeEffect,
		ImageEditorShadowEffect
	} from '../types';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import XIcon from 'lucide-svelte/icons/x';

	let { layer }: { layer: ImageEditorLayer } = $props();
	const editor = useImageEditor();
	let brandColors = $derived(editor.brandKit?.colors ?? []);
	let canMask = $derived(
		(layer.type === 'image' || layer.type === 'shape') && layer.shape?.kind !== 'line'
	);
	let canUseInnerShadow = $derived(canMask);
	let canUseStroke = $derived(layer.type !== 'group' && layer.shape?.kind !== 'line');

	type ShadowKind = 'drop_shadow' | 'inner_shadow';

	function currentEffects(): ImageEditorLayerEffects {
		return layer.effects ?? defaultLayerEffects();
	}

	function updateEffects(effects: ImageEditorLayerEffects, coalesceKey?: string): void {
		editor.updateLayer(layer.id, { effects }, coalesceKey);
	}

	function setBlendMode(blend_mode: ImageEditorBlendMode): void {
		updateEffects({ ...currentEffects(), blend_mode });
	}

	function shadowFor(kind: ShadowKind): ImageEditorShadowEffect | undefined {
		return currentEffects()[kind];
	}

	function toggleShadow(kind: ShadowKind): void {
		const effects = currentEffects();
		if (effects[kind]) {
			const next = { ...effects };
			delete next[kind];
			updateEffects(next);
			return;
		}
		updateEffects({ ...effects, [kind]: { ...DEFAULT_SHADOW_EFFECT } });
	}

	function updateShadow(
		kind: ShadowKind,
		updates: Partial<ImageEditorShadowEffect>,
		coalesceKey?: string
	): void {
		updateEffects(
			{
				...currentEffects(),
				[kind]: { ...(shadowFor(kind) ?? DEFAULT_SHADOW_EFFECT), ...updates }
			},
			coalesceKey
		);
	}

	function toggleStroke(): void {
		const effects = currentEffects();
		if (effects.stroke) {
			const next = { ...effects };
			delete next.stroke;
			updateEffects(next);
			return;
		}
		updateEffects({
			...effects,
			stroke: {
				...DEFAULT_STROKE_EFFECT,
				position: layer.type === 'image' ? 'outside' : DEFAULT_STROKE_EFFECT.position
			}
		});
	}

	function updateStroke(
		updates: Partial<ImageEditorLayerStrokeEffect>,
		coalesceKey?: string
	): void {
		updateEffects(
			{
				...currentEffects(),
				stroke: { ...(currentEffects().stroke ?? DEFAULT_STROKE_EFFECT), ...updates }
			},
			coalesceKey
		);
	}

	function applyDropShadowPreset(preset: 'soft' | 'lift' | 'glow'): void {
		const accent = editor.brandKit?.colors[0]?.value ?? '#f97316';
		const effect: ImageEditorShadowEffect =
			preset === 'soft'
				? { color: '#000000', opacity: 0.24, blur: 32, angle: 45, distance: 10 }
				: preset === 'lift'
					? { color: '#000000', opacity: 0.34, blur: 18, angle: 90, distance: 14 }
					: { color: accent, opacity: 0.48, blur: 30, angle: 0, distance: 0 };
		updateShadow('drop_shadow', effect);
	}

	function setMask(value: string): void {
		if (value === 'none') {
			editor.updateLayer(layer.id, { mask: undefined });
			return;
		}
		const current = layer.mask ?? defaultLayerMask();
		editor.updateLayer(layer.id, {
			mask: { ...current, shape: value as ImageEditorLayerMask['shape'] }
		});
	}

	function updateMask(updates: Partial<ImageEditorLayerMask>, coalesceKey?: string): void {
		editor.updateLayer(
			layer.id,
			{ mask: { ...(layer.mask ?? defaultLayerMask()), ...updates } },
			coalesceKey
		);
	}

	function blendLabel(mode: ImageEditorBlendMode): string {
		if (mode === 'multiply') return m.image_editor_blend_multiply();
		if (mode === 'screen') return m.image_editor_blend_screen();
		if (mode === 'overlay') return m.image_editor_blend_overlay();
		if (mode === 'darken') return m.image_editor_blend_darken();
		if (mode === 'lighten') return m.image_editor_blend_lighten();
		if (mode === 'soft_light') return m.image_editor_blend_soft_light();
		return m.image_editor_blend_normal();
	}

	const blendModes: ImageEditorBlendMode[] = [
		'normal',
		'multiply',
		'screen',
		'overlay',
		'darken',
		'lighten',
		'soft_light'
	];
</script>

{#snippet shadowEditor(kind: ShadowKind, label: string)}
	{@const shadow = shadowFor(kind)}
	<div class="rounded-md border">
		<div class="flex min-h-10 items-center gap-2 px-2">
			<span class="min-w-0 flex-1 text-xs font-medium">{label}</span>
			<Button
				variant={shadow ? 'secondary' : 'ghost'}
				size="icon-xs"
				disabled={!editor.canEdit}
				onclick={() => toggleShadow(kind)}
				aria-label={shadow
					? kind === 'drop_shadow'
						? m.image_editor_remove_drop_shadow()
						: m.image_editor_remove_inner_shadow()
					: kind === 'drop_shadow'
						? m.image_editor_add_drop_shadow()
						: m.image_editor_add_inner_shadow()}
				title={shadow
					? kind === 'drop_shadow'
						? m.image_editor_remove_drop_shadow()
						: m.image_editor_remove_inner_shadow()
					: kind === 'drop_shadow'
						? m.image_editor_add_drop_shadow()
						: m.image_editor_add_inner_shadow()}
			>
				{#if shadow}<XIcon />{:else}<PlusIcon />{/if}
			</Button>
		</div>
		{#if shadow}
			<div class="space-y-3 border-t p-2">
				{#if kind === 'drop_shadow'}
					<div class="grid grid-cols-3 gap-1">
						<Button variant="outline" size="xs" onclick={() => applyDropShadowPreset('soft')}>
							{m.image_editor_shadow_soft()}
						</Button>
						<Button variant="outline" size="xs" onclick={() => applyDropShadowPreset('lift')}>
							{m.image_editor_shadow_lift()}
						</Button>
						<Button variant="outline" size="xs" onclick={() => applyDropShadowPreset('glow')}>
							{m.image_editor_shadow_glow()}
						</Button>
					</div>
				{/if}
				<label class="grid gap-1 text-xs">
					<span>{m.image_editor_shadow_color()}</span>
					<ImageEditorColorPicker
						label={m.image_editor_shadow_color()}
						value={shadow.color}
						disabled={!editor.canEdit}
						{brandColors}
						recentColors={editor.recentColors}
						onChange={(color) => updateShadow(kind, { color }, `${kind}-color:${layer.id}`)}
						onCommit={(color) => editor.rememberColor(color)}
					/>
				</label>
				<label class="grid gap-1 text-xs">
					<span>{m.image_editor_shadow_opacity({ value: Math.round(shadow.opacity * 100) })}</span>
					<Slider
						value={shadow.opacity}
						min={0}
						max={1}
						step={0.01}
						disabled={!editor.canEdit}
						ariaLabel={m.image_editor_shadow_opacity({ value: Math.round(shadow.opacity * 100) })}
						onValueChange={(opacity) =>
							updateShadow(kind, { opacity }, `${kind}-opacity:${layer.id}`)}
					/>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_shadow_blur()} · {Math.round(shadow.blur)}</span>
						<Slider
							value={shadow.blur}
							min={0}
							max={100}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.image_editor_shadow_blur()}
							onValueChange={(blur) => updateShadow(kind, { blur }, `${kind}-blur:${layer.id}`)}
						/>
					</label>
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_shadow_distance()} · {Math.round(shadow.distance)}</span>
						<Slider
							value={shadow.distance}
							min={0}
							max={200}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.image_editor_shadow_distance()}
							onValueChange={(distance) =>
								updateShadow(kind, { distance }, `${kind}-distance:${layer.id}`)}
						/>
					</label>
				</div>
				<label class="grid gap-1 text-xs">
					<span>{m.image_editor_shadow_angle()} · {Math.round(shadow.angle)}°</span>
					<Slider
						value={shadow.angle}
						min={-180}
						max={180}
						step={1}
						disabled={!editor.canEdit}
						ariaLabel={m.image_editor_shadow_angle()}
						onValueChange={(angle) => updateShadow(kind, { angle }, `${kind}-angle:${layer.id}`)}
					/>
				</label>
			</div>
		{/if}
	</div>
{/snippet}

<section class="space-y-3 border-t pt-4">
	<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
		{m.image_editor_effects()}
	</h3>
	<label class="grid gap-1 text-xs">
		<span>{m.image_editor_blend_mode()}</span>
		<AppSelect
			value={currentEffects().blend_mode}
			ariaLabel={m.image_editor_blend_mode()}
			disabled={!editor.canEdit}
			onValueChange={(value) => setBlendMode(value as ImageEditorBlendMode)}
			options={blendModes.map((mode) => ({ value: mode, label: blendLabel(mode) }))}
			class="h-9 w-full"
		/>
	</label>

	{#if canUseStroke}
		{@const stroke = currentEffects().stroke}
		<div class="rounded-md border" data-testid="image-editor-layer-border">
			<div class="flex min-h-10 items-center gap-2 px-2">
				<span class="min-w-0 flex-1 text-xs font-medium">{m.image_editor_border()}</span>
				<Button
					variant={stroke ? 'secondary' : 'ghost'}
					size="icon-xs"
					disabled={!editor.canEdit}
					onclick={toggleStroke}
					aria-label={stroke ? m.image_editor_remove_border() : m.image_editor_add_border()}
					title={stroke ? m.image_editor_remove_border() : m.image_editor_add_border()}
				>
					{#if stroke}<XIcon />{:else}<PlusIcon />{/if}
				</Button>
			</div>
			{#if stroke}
				<div class="space-y-3 border-t p-2">
					<ImageEditorColorPicker
						label={m.image_editor_border_color()}
						value={stroke.color}
						disabled={!editor.canEdit}
						{brandColors}
						recentColors={editor.recentColors}
						onChange={(color) => updateStroke({ color }, `stroke-color:${layer.id}`)}
						onCommit={(color) => editor.rememberColor(color)}
					/>
					{#if layer.type === 'image'}
						<p class="text-xs leading-relaxed text-muted-foreground">
							{m.image_editor_border_follows_content()}
						</p>
					{/if}
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_border_position()}</span>
						<AppSelect
							value={stroke.position}
							ariaLabel={m.image_editor_border_position()}
							disabled={!editor.canEdit}
							onValueChange={(value) =>
								updateStroke({
									position: value as ImageEditorLayerStrokeEffect['position']
								})}
							options={[
								{ value: 'inside', label: m.image_editor_border_inside() },
								{ value: 'center', label: m.image_editor_border_center() },
								{ value: 'outside', label: m.image_editor_border_outside() }
							]}
							class="h-9 w-full"
						/>
					</label>
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_stroke_width()} · {Math.round(stroke.width)}</span>
						<Slider
							value={stroke.width}
							min={1}
							max={200}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.image_editor_stroke_width()}
							onValueChange={(width) => updateStroke({ width }, `stroke-width:${layer.id}`)}
						/>
					</label>
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_opacity({ value: Math.round(stroke.opacity * 100) })}</span>
						<Slider
							value={stroke.opacity}
							min={0}
							max={1}
							step={0.01}
							disabled={!editor.canEdit}
							ariaLabel={m.image_editor_opacity({
								value: Math.round(stroke.opacity * 100)
							})}
							onValueChange={(opacity) => updateStroke({ opacity }, `stroke-opacity:${layer.id}`)}
						/>
					</label>
				</div>
			{/if}
		</div>
	{/if}

	{#if canMask}
		<div class="space-y-2">
			<label class="grid gap-1 text-xs">
				<span>{m.image_editor_mask()}</span>
				<AppSelect
					value={layer.mask?.shape ?? 'none'}
					ariaLabel={m.image_editor_mask()}
					disabled={!editor.canEdit}
					onValueChange={setMask}
					options={[
						{ value: 'none', label: m.image_editor_mask_none() },
						{ value: 'rectangle', label: m.image_editor_mask_rectangle() },
						{ value: 'rounded_rectangle', label: m.image_editor_mask_rounded() },
						{ value: 'circle', label: m.image_editor_mask_circle() },
						{ value: 'ellipse', label: m.image_editor_mask_ellipse() },
						{ value: 'diamond', label: m.image_editor_mask_diamond() }
					]}
					class="h-9 w-full"
				/>
			</label>
			{#if layer.mask}
				<label class="grid gap-1 text-xs">
					<span>{m.image_editor_mask_inset()} · {Math.round(layer.mask.inset)}</span>
					<Slider
						value={layer.mask.inset}
						min={0}
						max={Math.max(1, Math.min(layer.transform.width, layer.transform.height) / 2 - 1)}
						step={1}
						disabled={!editor.canEdit}
						ariaLabel={m.image_editor_mask_inset()}
						onValueChange={(inset) => updateMask({ inset }, `mask-inset:${layer.id}`)}
					/>
				</label>
				{#if layer.mask.shape === 'rounded_rectangle'}
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_mask_radius()} · {Math.round(layer.mask.radius)}</span>
						<Slider
							value={layer.mask.radius}
							min={0}
							max={Math.max(1, Math.min(layer.transform.width, layer.transform.height) / 2)}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.image_editor_mask_radius()}
							onValueChange={(radius) => updateMask({ radius }, `mask-radius:${layer.id}`)}
						/>
					</label>
				{/if}
			{/if}
		</div>
	{/if}

	{@render shadowEditor('drop_shadow', m.image_editor_drop_shadow())}
	{#if canUseInnerShadow}
		{@render shadowEditor('inner_shadow', m.image_editor_inner_shadow())}
	{/if}
</section>
