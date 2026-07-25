<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { defaultLayerEffects, defaultLayerMask, DEFAULT_SHADOW_EFFECT } from '../effects';
	import { useStudioEditor } from '../editor.svelte';
	import type {
		StudioBlendMode,
		StudioLayer,
		StudioLayerEffects,
		StudioLayerMask,
		StudioShadowEffect
	} from '../types';
	import StudioColorPicker from './studio-color-picker.svelte';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import XIcon from 'lucide-svelte/icons/x';

	let { layer }: { layer: StudioLayer } = $props();
	const editor = useStudioEditor();
	let brandColors = $derived(editor.brandKit?.colors ?? []);
	let canMask = $derived(
		(layer.type === 'image' || layer.type === 'shape') && layer.shape?.kind !== 'line'
	);
	let canUseInnerShadow = $derived(canMask);

	type ShadowKind = 'drop_shadow' | 'inner_shadow';

	function currentEffects(): StudioLayerEffects {
		return layer.effects ?? defaultLayerEffects();
	}

	function updateEffects(effects: StudioLayerEffects, coalesceKey?: string): void {
		editor.updateLayer(layer.id, { effects }, coalesceKey);
	}

	function setBlendMode(blend_mode: StudioBlendMode): void {
		updateEffects({ ...currentEffects(), blend_mode });
	}

	function shadowFor(kind: ShadowKind): StudioShadowEffect | undefined {
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
		updates: Partial<StudioShadowEffect>,
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

	function applyDropShadowPreset(preset: 'soft' | 'lift' | 'glow'): void {
		const accent = editor.brandKit?.colors[0]?.value ?? '#f97316';
		const effect: StudioShadowEffect =
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
			mask: { ...current, shape: value as StudioLayerMask['shape'] }
		});
	}

	function updateMask(updates: Partial<StudioLayerMask>, coalesceKey?: string): void {
		editor.updateLayer(
			layer.id,
			{ mask: { ...(layer.mask ?? defaultLayerMask()), ...updates } },
			coalesceKey
		);
	}

	function blendLabel(mode: StudioBlendMode): string {
		if (mode === 'multiply') return m.studio_blend_multiply();
		if (mode === 'screen') return m.studio_blend_screen();
		if (mode === 'overlay') return m.studio_blend_overlay();
		if (mode === 'darken') return m.studio_blend_darken();
		if (mode === 'lighten') return m.studio_blend_lighten();
		if (mode === 'soft_light') return m.studio_blend_soft_light();
		return m.studio_blend_normal();
	}

	const blendModes: StudioBlendMode[] = [
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
						? m.studio_remove_drop_shadow()
						: m.studio_remove_inner_shadow()
					: kind === 'drop_shadow'
						? m.studio_add_drop_shadow()
						: m.studio_add_inner_shadow()}
				title={shadow
					? kind === 'drop_shadow'
						? m.studio_remove_drop_shadow()
						: m.studio_remove_inner_shadow()
					: kind === 'drop_shadow'
						? m.studio_add_drop_shadow()
						: m.studio_add_inner_shadow()}
			>
				{#if shadow}<XIcon />{:else}<PlusIcon />{/if}
			</Button>
		</div>
		{#if shadow}
			<div class="space-y-3 border-t p-2">
				{#if kind === 'drop_shadow'}
					<div class="grid grid-cols-3 gap-1">
						<Button variant="outline" size="xs" onclick={() => applyDropShadowPreset('soft')}>
							{m.studio_shadow_soft()}
						</Button>
						<Button variant="outline" size="xs" onclick={() => applyDropShadowPreset('lift')}>
							{m.studio_shadow_lift()}
						</Button>
						<Button variant="outline" size="xs" onclick={() => applyDropShadowPreset('glow')}>
							{m.studio_shadow_glow()}
						</Button>
					</div>
				{/if}
				<label class="grid gap-1 text-xs">
					<span>{m.studio_shadow_color()}</span>
					<StudioColorPicker
						label={m.studio_shadow_color()}
						value={shadow.color}
						disabled={!editor.canEdit}
						{brandColors}
						recentColors={editor.recentColors}
						onChange={(color) => updateShadow(kind, { color }, `${kind}-color:${layer.id}`)}
						onCommit={(color) => editor.rememberColor(color)}
					/>
				</label>
				<label class="grid gap-1 text-xs">
					<span>{m.studio_shadow_opacity({ value: Math.round(shadow.opacity * 100) })}</span>
					<Slider
						value={shadow.opacity}
						min={0}
						max={1}
						step={0.01}
						disabled={!editor.canEdit}
						ariaLabel={m.studio_shadow_opacity({ value: Math.round(shadow.opacity * 100) })}
						onValueChange={(opacity) =>
							updateShadow(kind, { opacity }, `${kind}-opacity:${layer.id}`)}
					/>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="grid gap-1 text-xs">
						<span>{m.studio_shadow_blur()} · {Math.round(shadow.blur)}</span>
						<Slider
							value={shadow.blur}
							min={0}
							max={100}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.studio_shadow_blur()}
							onValueChange={(blur) => updateShadow(kind, { blur }, `${kind}-blur:${layer.id}`)}
						/>
					</label>
					<label class="grid gap-1 text-xs">
						<span>{m.studio_shadow_distance()} · {Math.round(shadow.distance)}</span>
						<Slider
							value={shadow.distance}
							min={0}
							max={200}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.studio_shadow_distance()}
							onValueChange={(distance) =>
								updateShadow(kind, { distance }, `${kind}-distance:${layer.id}`)}
						/>
					</label>
				</div>
				<label class="grid gap-1 text-xs">
					<span>{m.studio_shadow_angle()} · {Math.round(shadow.angle)}°</span>
					<Slider
						value={shadow.angle}
						min={-180}
						max={180}
						step={1}
						disabled={!editor.canEdit}
						ariaLabel={m.studio_shadow_angle()}
						onValueChange={(angle) => updateShadow(kind, { angle }, `${kind}-angle:${layer.id}`)}
					/>
				</label>
			</div>
		{/if}
	</div>
{/snippet}

<section class="space-y-3 border-t pt-4">
	<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
		{m.studio_effects()}
	</h3>
	<label class="grid gap-1 text-xs">
		<span>{m.studio_blend_mode()}</span>
		<select
			class="h-9 rounded-md border border-input bg-background px-2"
			value={currentEffects().blend_mode}
			disabled={!editor.canEdit}
			onchange={(event) => setBlendMode(event.currentTarget.value as StudioBlendMode)}
		>
			{#each blendModes as mode (mode)}
				<option value={mode}>{blendLabel(mode)}</option>
			{/each}
		</select>
	</label>

	{#if canMask}
		<div class="space-y-2">
			<label class="grid gap-1 text-xs">
				<span>{m.studio_mask()}</span>
				<select
					class="h-9 rounded-md border border-input bg-background px-2"
					value={layer.mask?.shape ?? 'none'}
					disabled={!editor.canEdit}
					onchange={(event) => setMask(event.currentTarget.value)}
				>
					<option value="none">{m.studio_mask_none()}</option>
					<option value="rectangle">{m.studio_mask_rectangle()}</option>
					<option value="rounded_rectangle">{m.studio_mask_rounded()}</option>
					<option value="circle">{m.studio_mask_circle()}</option>
					<option value="ellipse">{m.studio_mask_ellipse()}</option>
					<option value="diamond">{m.studio_mask_diamond()}</option>
				</select>
			</label>
			{#if layer.mask}
				<label class="grid gap-1 text-xs">
					<span>{m.studio_mask_inset()} · {Math.round(layer.mask.inset)}</span>
					<Slider
						value={layer.mask.inset}
						min={0}
						max={Math.max(1, Math.min(layer.transform.width, layer.transform.height) / 2 - 1)}
						step={1}
						disabled={!editor.canEdit}
						ariaLabel={m.studio_mask_inset()}
						onValueChange={(inset) => updateMask({ inset }, `mask-inset:${layer.id}`)}
					/>
				</label>
				{#if layer.mask.shape === 'rounded_rectangle'}
					<label class="grid gap-1 text-xs">
						<span>{m.studio_mask_radius()} · {Math.round(layer.mask.radius)}</span>
						<Slider
							value={layer.mask.radius}
							min={0}
							max={Math.max(1, Math.min(layer.transform.width, layer.transform.height) / 2)}
							step={1}
							disabled={!editor.canEdit}
							ariaLabel={m.studio_mask_radius()}
							onValueChange={(radius) => updateMask({ radius }, `mask-radius:${layer.id}`)}
						/>
					</label>
				{/if}
			{/if}
		</div>
	{/if}

	{@render shadowEditor('drop_shadow', m.studio_drop_shadow())}
	{#if canUseInnerShadow}
		{@render shadowEditor('inner_shadow', m.studio_inner_shadow())}
	{/if}
</section>
