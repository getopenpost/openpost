<script lang="ts">
	import { useImageEditor } from '../editor.svelte';
	import { defaultImageAdjustments } from '../document';
	import { defaultTextCurve } from '../effects';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import ImageEditorFontPicker from './image-editor-font-picker.svelte';
	import LayerEffectsPanel from './layer-effects-panel.svelte';
	import PageBackgroundEditor from './page-background-editor.svelte';
	import CopyIcon from 'lucide-svelte/icons/copy';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import BringToFrontIcon from 'lucide-svelte/icons/bring-to-front';
	import SendToBackIcon from 'lucide-svelte/icons/send-to-back';
	import FlipHorizontalIcon from 'lucide-svelte/icons/flip-horizontal-2';
	import FlipVerticalIcon from 'lucide-svelte/icons/flip-vertical-2';
	import RotateCcwIcon from 'lucide-svelte/icons/rotate-ccw';
	import CropIcon from 'lucide-svelte/icons/crop';
	import ChevronDownIcon from 'lucide-svelte/icons/chevron-down';
	import { m } from '$lib/paraglide/messages';
	import type { ImageEditorImageAdjustments, ImageEditorTextCurveType } from '../types';

	let { onOpenMedia = () => undefined }: { onOpenMedia?: () => void } = $props();

	const editor = useImageEditor();
	let layer = $derived(editor.selectedLayers[0] ?? null);
	let cropOpen = $state(false);
	let brandColors = $derived(editor.brandKit?.colors ?? []);
	let brandFonts = $derived(editor.brandKit?.fonts ?? []);

	function numberValue(event: Event, fallback: number): number {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		return Number.isFinite(value) ? value : fallback;
	}

	function align(axis: 'horizontal' | 'vertical'): void {
		if (!layer || !editor.document) return;
		editor.updateTransform(layer.id, {
			...(axis === 'horizontal'
				? { x: (editor.document.width_px - layer.transform.width) / 2 }
				: { y: (editor.document.height_px - layer.transform.height) / 2 })
		});
	}

	function updateCrop(key: 'x' | 'y' | 'width' | 'height', event: Event, fallback: number): void {
		if (!layer?.image) return;
		const value = numberValue(event, fallback * 100) / 100;
		const crop = { ...layer.image.crop, [key]: value };
		crop.width = Math.min(1, Math.max(0.01, crop.width));
		crop.height = Math.min(1, Math.max(0.01, crop.height));
		crop.x = Math.min(1 - crop.width, Math.max(0, crop.x));
		crop.y = Math.min(1 - crop.height, Math.max(0, crop.y));
		editor.updateLayer(layer.id, { image: { ...layer.image, crop } }, `image-crop:${layer.id}`);
	}

	function cropValue(key: 'x' | 'y' | 'width' | 'height'): number {
		return layer?.image?.crop[key] ?? (key === 'width' || key === 'height' ? 1 : 0);
	}

	function alignmentLabel(alignment: string): string {
		if (alignment === 'left') return m.image_editor_align_left();
		if (alignment === 'center') return m.image_editor_align_center();
		return m.image_editor_align_right();
	}

	function setTextCurveType(type: ImageEditorTextCurveType): void {
		if (!layer?.text || !editor.document) return;
		editor.mutate('Change text curve', (document) => {
			const current = document.pages
				.find((page) => page.id === editor.activePageID)
				?.layers.find((candidate) => candidate.id === layer?.id);
			if (!current?.text) return;
			const previousType = current.text.curve?.type ?? 'none';
			current.text.curve = { ...(current.text.curve ?? defaultTextCurve()), type };
			if (type !== 'circle' && type !== 'ellipse') return;
			const nextHeight =
				type === 'circle'
					? current.transform.width
					: previousType === 'circle'
						? current.transform.width * 0.55
						: Math.max(current.transform.height, current.transform.width * 0.55);
			const centerY = current.transform.y + current.transform.height / 2;
			current.transform.height = nextHeight;
			current.transform.y = Math.max(
				0,
				Math.min(document.height_px - nextHeight, centerY - nextHeight / 2)
			);
		});
	}

	type AdjustmentControl = readonly [string, keyof ImageEditorImageAdjustments, number, number];

	const toneControls: AdjustmentControl[] = [
		[m.image_editor_brightness(), 'brightness', -1, 1],
		[m.image_editor_exposure(), 'exposure', -1, 1],
		[m.image_editor_contrast(), 'contrast', -1, 1],
		[m.image_editor_highlights(), 'highlights', -1, 1],
		[m.image_editor_shadows(), 'shadows', -1, 1]
	];
	const colorControls: AdjustmentControl[] = [
		[m.image_editor_temperature(), 'temperature', -1, 1],
		[m.image_editor_tint(), 'tint', -1, 1],
		[m.image_editor_vibrance(), 'vibrance', -1, 1],
		[m.image_editor_saturation(), 'saturation', -1, 1],
		[m.image_editor_hue(), 'hue', -1, 1]
	];
	const detailControls: AdjustmentControl[] = [[m.image_editor_blur(), 'blur', 0, 1]];
	const adjustmentGroups = [
		{ label: m.image_editor_tone(), controls: toneControls },
		{ label: m.image_editor_color(), controls: colorControls },
		{ label: m.image_editor_detail(), controls: detailControls }
	];

	const quickLooks: Array<{
		key: 'original' | 'crisp' | 'warm' | 'cool' | 'mono';
		label: string;
		adjustments: Partial<ImageEditorImageAdjustments>;
	}> = [
		{ key: 'original', label: m.image_editor_look_original(), adjustments: {} },
		{
			key: 'crisp',
			label: m.image_editor_look_crisp(),
			adjustments: { contrast: 0.14, vibrance: 0.12, highlights: -0.08, shadows: 0.08 }
		},
		{
			key: 'warm',
			label: m.image_editor_look_warm(),
			adjustments: { temperature: 0.18, tint: 0.04, vibrance: 0.08 }
		},
		{
			key: 'cool',
			label: m.image_editor_look_cool(),
			adjustments: { temperature: -0.16, tint: -0.03, contrast: 0.05 }
		},
		{
			key: 'mono',
			label: m.image_editor_look_mono(),
			adjustments: { saturation: -1, contrast: 0.12, shadows: 0.08 }
		}
	];

	function setAdjustment(key: keyof ImageEditorImageAdjustments, value: number): void {
		if (!layer?.image) return;
		editor.updateLayer(
			layer.id,
			{
				image: {
					...layer.image,
					adjustments: { ...layer.image.adjustments, [key]: value }
				}
			},
			`image-${key}:${layer.id}`
		);
	}

	function applyLook(adjustments: Partial<ImageEditorImageAdjustments>): void {
		if (!layer?.image) return;
		editor.updateLayer(layer.id, {
			image: {
				...layer.image,
				adjustments: { ...defaultImageAdjustments(), ...adjustments }
			}
		});
	}

	function lookIsActive(adjustments: Partial<ImageEditorImageAdjustments>): boolean {
		if (!layer?.image) return false;
		const target = { ...defaultImageAdjustments(), ...adjustments };
		return Object.entries(target).every(
			([key, value]) =>
				Math.abs(layer!.image!.adjustments[key as keyof ImageEditorImageAdjustments] - value) <
				0.001
		);
	}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
	<div class="border-b px-3 py-2">
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{m.image_editor_properties()}
		</h2>
	</div>
	<div
		class="image-editor-properties-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3"
	>
		{#if !layer}
			<PageBackgroundEditor {onOpenMedia} />
		{:else}
			<div class="space-y-5">
				<section class="space-y-2">
					<label for="layer-name" class="block text-xs font-medium"
						>{m.image_editor_layer_name()}</label
					>
					<Input
						id="layer-name"
						value={layer.name}
						disabled={!editor.canEdit}
						onchange={(event) => editor.updateLayer(layer.id, { name: event.currentTarget.value })}
					/>
					<div class="grid grid-cols-2 gap-2">
						<Button variant="outline" size="sm" onclick={() => align('horizontal')}
							>{m.image_editor_center_x()}</Button
						>
						<Button variant="outline" size="sm" onclick={() => align('vertical')}
							>{m.image_editor_center_y()}</Button
						>
					</div>
					{#if editor.selectedLayers.length > 1}
						<div class="grid grid-cols-3 gap-1">
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('left')}
								>{m.image_editor_align_left()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('center_x')}
								>{m.image_editor_align_center()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('right')}
								>{m.image_editor_align_right()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('top')}
								>{m.image_editor_align_top()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('center_y')}
								>{m.image_editor_align_middle()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('bottom')}
								>{m.image_editor_align_bottom()}</Button
							>
						</div>
						{#if editor.selectedLayers.length > 2}
							<div class="grid grid-cols-2 gap-1">
								<Button
									variant="outline"
									size="xs"
									onclick={() => editor.distributeSelected('horizontal')}
									>{m.image_editor_distribute_x()}</Button
								>
								<Button
									variant="outline"
									size="xs"
									onclick={() => editor.distributeSelected('vertical')}
									>{m.image_editor_distribute_y()}</Button
								>
							</div>
						{/if}
					{/if}
					<div class="grid grid-cols-4 gap-1">
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="icon-sm"
										onclick={() => editor.reorderLayer(layer.id, 'front')}
										aria-label={m.image_editor_bring_front()}><BringToFrontIcon /></Button
									>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>{m.image_editor_bring_front()}</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="icon-sm"
										onclick={() => editor.reorderLayer(layer.id, 'back')}
										aria-label={m.image_editor_send_back()}><SendToBackIcon /></Button
									>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>{m.image_editor_send_back()}</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="icon-sm"
										onclick={() => editor.duplicateSelected()}
										aria-label={m.image_editor_duplicate()}><CopyIcon /></Button
									>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>{m.image_editor_duplicate()}</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="destructive"
										size="icon-sm"
										onclick={() => editor.deleteSelected()}
										aria-label={m.image_editor_delete_layer()}><TrashIcon /></Button
									>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>{m.image_editor_delete_layer()}</Tooltip.Content>
						</Tooltip.Root>
					</div>
				</section>

				<section class="space-y-2 border-t pt-4">
					<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{m.image_editor_transform()}
					</h3>
					<div class="grid grid-cols-2 gap-2">
						{#each [['X', 'x'], ['Y', 'y'], ['W', 'width'], ['H', 'height']] as [label, key] (key)}
							<label class="grid grid-cols-[1.5rem_1fr] items-center">
								<span class="text-xs text-muted-foreground">{label}</span>
								<Input
									type="number"
									value={Math.round(layer.transform[key as keyof typeof layer.transform] as number)}
									disabled={!editor.canEdit || layer.locked}
									oninput={(event) =>
										editor.updateTransform(layer.id, {
											[key]: numberValue(
												event,
												layer.transform[key as keyof typeof layer.transform] as number
											)
										})}
								/>
							</label>
						{/each}
					</div>
					<div class="space-y-1">
						<div class="flex items-center justify-between gap-2">
							<span class="text-xs">{m.image_editor_rotation()}</span>
							<div class="flex items-center gap-1">
								<Input
									type="number"
									min="-180"
									max="180"
									value={Math.round(layer.transform.rotation)}
									class="h-8 w-16 px-1.5 text-right text-xs"
									disabled={!editor.canEdit || layer.locked}
									oninput={(event) =>
										editor.updateTransform(layer.id, {
											rotation: numberValue(event, layer.transform.rotation)
										})}
								/>
								<Button
									variant="ghost"
									size="icon-xs"
									onclick={() => editor.updateTransform(layer.id, { rotation: 0 })}
									disabled={!editor.canEdit || layer.locked}
									aria-label={m.image_editor_reset_rotation()}
									title={m.image_editor_reset_rotation()}
								>
									<RotateCcwIcon />
								</Button>
							</div>
						</div>
						<Slider
							value={layer.transform.rotation}
							min={-180}
							max={180}
							step={1}
							disabled={!editor.canEdit || layer.locked}
							ariaLabel={m.image_editor_rotation()}
							onValueChange={(rotation) =>
								editor.updateTransform(layer.id, { rotation }, `rotation:${layer.id}`)}
						/>
					</div>
					<div class="grid grid-cols-2 gap-2">
						<Button
							variant={layer.transform.flip_x ? 'secondary' : 'outline'}
							size="sm"
							onclick={() => editor.updateTransform(layer.id, { flip_x: !layer.transform.flip_x })}
						>
							<FlipHorizontalIcon />
							{m.image_editor_flip_x()}
						</Button>
						<Button
							variant={layer.transform.flip_y ? 'secondary' : 'outline'}
							size="sm"
							onclick={() => editor.updateTransform(layer.id, { flip_y: !layer.transform.flip_y })}
						>
							<FlipVerticalIcon />
							{m.image_editor_flip_y()}
						</Button>
					</div>
					<label class="grid gap-1 text-xs">
						<span>{m.image_editor_opacity({ value: Math.round(layer.opacity * 100) })}</span>
						<Slider
							min={0}
							max={1}
							step={0.01}
							value={layer.opacity}
							disabled={!editor.canEdit}
							ariaLabel={m.image_editor_opacity({ value: Math.round(layer.opacity * 100) })}
							onValueChange={(opacity) =>
								editor.updateLayer(layer.id, { opacity }, `opacity:${layer.id}`)}
						/>
					</label>
				</section>

				{#if layer.type !== 'group'}
					<LayerEffectsPanel {layer} />
				{/if}

				{#if layer.type === 'text' && layer.text}
					<section class="space-y-2 border-t pt-4">
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							{m.image_editor_text()}
						</h3>
						<Textarea
							class="min-h-24"
							value={layer.text.text}
							disabled={!editor.canEdit}
							oninput={(event) =>
								editor.updateLayer(
									layer.id,
									{ text: { ...layer.text!, text: event.currentTarget.value } },
									`text:${layer.id}`
								)}
						/>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_font_family()}</span>
							<ImageEditorFontPicker
								value={layer.text.font_family}
								disabled={!editor.canEdit}
								{brandFonts}
								onChange={(font) =>
									editor.updateLayer(layer.id, {
										text: {
											...layer.text!,
											font_family: font.family,
											font_asset_id: font.assetID,
											font_weight: font.weight ?? layer.text!.font_weight,
											font_style: font.style ?? layer.text!.font_style
										}
									})}
							/>
						</label>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_size()}</span>
								<Input
									type="number"
									min="1"
									value={layer.text.font_size}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(
											layer.id,
											{
												text: {
													...layer.text!,
													font_size: numberValue(event, layer.text!.font_size)
												}
											},
											`font-size:${layer.id}`
										)}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_weight()}</span>
								<AppSelect
									value={String(layer.text.font_weight)}
									ariaLabel={m.image_editor_weight()}
									disabled={!editor.canEdit}
									onValueChange={(value) =>
										editor.updateLayer(layer.id, {
											text: { ...layer.text!, font_weight: Number(value) }
										})}
									options={[
										[100, m.image_editor_thin()],
										[200, m.image_editor_extra_light()],
										[300, m.image_editor_light()],
										[400, m.image_editor_regular()],
										[500, m.image_editor_medium()],
										[600, m.image_editor_semibold()],
										[700, m.image_editor_bold()],
										[800, m.image_editor_extra_bold()],
										[900, m.image_editor_black()]
									].map(([weight, label]) => ({
										value: String(weight),
										label: `${weight} — ${label}`
									}))}
									class="h-9 w-full"
								/>
							</label>
						</div>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_style()}</span>
								<AppSelect
									value={layer.text.font_style}
									ariaLabel={m.image_editor_style()}
									disabled={!editor.canEdit}
									onValueChange={(value) =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												font_style: value as 'normal' | 'italic'
											}
										})}
									options={[
										{ value: 'normal', label: m.image_editor_normal() },
										{ value: 'italic', label: m.image_editor_italic() }
									]}
									class="h-9 w-full"
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_line_height()}</span>
								<Input
									type="number"
									min="0.5"
									max="4"
									step="0.05"
									value={layer.text.line_height}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(
											layer.id,
											{
												text: {
													...layer.text!,
													line_height: numberValue(event, layer.text!.line_height)
												}
											},
											`line-height:${layer.id}`
										)}
								/>
							</label>
						</div>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_letter_spacing()}</span>
							<Input
								type="number"
								min="-20"
								max="100"
								step="0.1"
								value={layer.text.letter_spacing}
								disabled={!editor.canEdit}
								oninput={(event) =>
									editor.updateLayer(
										layer.id,
										{
											text: {
												...layer.text!,
												letter_spacing: numberValue(event, layer.text!.letter_spacing)
											}
										},
										`letter-spacing:${layer.id}`
									)}
							/>
						</label>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_color()}</span>
							<ImageEditorColorPicker
								label={m.image_editor_color()}
								value={layer.text.color}
								disabled={!editor.canEdit}
								{brandColors}
								recentColors={editor.recentColors}
								onChange={(value) =>
									editor.updateLayer(
										layer.id,
										{ text: { ...layer.text!, color: value } },
										`text-color:${layer.id}`
									)}
								onCommit={(value) => editor.rememberColor(value)}
							/>
						</label>
						<div class="grid grid-cols-3 gap-1">
							{#each ['left', 'center', 'right'] as alignment (alignment)}
								<Button
									variant={layer.text.align === alignment ? 'secondary' : 'outline'}
									size="sm"
									onclick={() =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												align: alignment as 'left' | 'center' | 'right'
											}
										})}>{alignmentLabel(alignment)}</Button
								>
							{/each}
						</div>
						<div class="space-y-2 rounded-md border p-2">
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_text_curve()}</span>
								<AppSelect
									value={layer.text.curve?.type ?? 'none'}
									ariaLabel={m.image_editor_text_curve()}
									disabled={!editor.canEdit}
									onValueChange={(value) => setTextCurveType(value as ImageEditorTextCurveType)}
									options={[
										{ value: 'none', label: m.image_editor_curve_none() },
										{ value: 'arc_up', label: m.image_editor_curve_arc_up() },
										{ value: 'arc_down', label: m.image_editor_curve_arc_down() },
										{ value: 'wave', label: m.image_editor_curve_wave() },
										{ value: 'circle', label: m.image_editor_curve_circle() },
										{ value: 'ellipse', label: m.image_editor_curve_ellipse() }
									]}
									class="h-9 w-full"
								/>
							</label>
							{#if layer.text.curve && layer.text.curve.type !== 'none'}
								{#if ['arc_up', 'arc_down', 'wave'].includes(layer.text.curve.type)}
									<label class="grid gap-1 text-xs">
										<span
											>{m.image_editor_curve_strength()} · {Math.round(
												layer.text.curve.strength * 100
											)}%</span
										>
										<Slider
											value={layer.text.curve.strength}
											min={0.05}
											max={1}
											step={0.01}
											disabled={!editor.canEdit}
											ariaLabel={m.image_editor_curve_strength()}
											onValueChange={(strength) =>
												editor.updateLayer(
													layer.id,
													{
														text: {
															...layer.text!,
															curve: { ...layer.text!.curve!, strength }
														}
													},
													`text-curve-strength:${layer.id}`
												)}
										/>
									</label>
								{/if}
								<label class="grid gap-1 text-xs">
									<span
										>{m.image_editor_curve_offset()} · {Math.round(
											layer.text.curve.offset * 100
										)}%</span
									>
									<Slider
										value={layer.text.curve.offset}
										min={-1}
										max={1}
										step={0.01}
										disabled={!editor.canEdit}
										ariaLabel={m.image_editor_curve_offset()}
										onValueChange={(offset) =>
											editor.updateLayer(
												layer.id,
												{
													text: {
														...layer.text!,
														curve: { ...layer.text!.curve!, offset }
													}
												},
												`text-curve-offset:${layer.id}`
											)}
									/>
								</label>
								<Button
									variant={layer.text.curve.reverse ? 'secondary' : 'outline'}
									size="xs"
									onclick={() =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												curve: {
													...layer.text!.curve!,
													reverse: !layer.text!.curve!.reverse
												}
											}
										})}
								>
									{m.image_editor_curve_reverse()}
								</Button>
							{/if}
						</div>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_highlight()}</span>
								<ImageEditorColorPicker
									label={m.image_editor_highlight()}
									value={layer.text.highlight_color?.slice(0, 7) || '#ffffff'}
									disabled={!editor.canEdit}
									{brandColors}
									recentColors={editor.recentColors}
									onChange={(value) =>
										editor.updateLayer(layer.id, {
											text: { ...layer.text!, highlight_color: value }
										})}
									onCommit={(value) => editor.rememberColor(value)}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_stroke()}</span>
								<ImageEditorColorPicker
									label={m.image_editor_stroke()}
									value={layer.text.stroke_color?.slice(0, 7) || '#000000'}
									disabled={!editor.canEdit}
									{brandColors}
									recentColors={editor.recentColors}
									onChange={(value) =>
										editor.updateLayer(layer.id, {
											text: { ...layer.text!, stroke_color: value }
										})}
									onCommit={(value) => editor.rememberColor(value)}
								/>
							</label>
						</div>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_stroke_width()}</span>
							<Input
								type="number"
								min="0"
								max="32"
								step="0.5"
								value={layer.text.stroke_width}
								disabled={!editor.canEdit}
								oninput={(event) =>
									editor.updateLayer(layer.id, {
										text: {
											...layer.text!,
											stroke_width: numberValue(event, layer.text!.stroke_width)
										}
									})}
							/>
						</label>
						<Button
							variant="ghost"
							size="xs"
							onclick={() =>
								editor.updateLayer(layer.id, {
									text: {
										...layer.text!,
										highlight_color: undefined,
										stroke_color: undefined,
										stroke_width: 0,
										shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 },
										curve: defaultTextCurve()
									}
								})}>{m.image_editor_clear_text_effects()}</Button
						>
					</section>
				{/if}

				{#if layer.type === 'shape' && layer.shape}
					<section class="space-y-2 border-t pt-4">
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							{m.image_editor_shape()}
						</h3>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_shape_kind()}</span>
							<AppSelect
								value={layer.shape.kind}
								ariaLabel={m.image_editor_shape_kind()}
								disabled={!editor.canEdit}
								onValueChange={(value) =>
									editor.updateLayer(layer.id, {
										shape: {
											...layer.shape!,
											kind: value as 'rectangle' | 'rounded_rectangle' | 'ellipse' | 'line',
											radius:
												value === 'rounded_rectangle'
													? Math.max(24, layer.shape!.radius)
													: layer.shape!.radius
										}
									})}
								options={[
									{ value: 'rectangle', label: m.image_editor_rectangle() },
									{ value: 'rounded_rectangle', label: m.image_editor_rounded_rectangle() },
									{ value: 'ellipse', label: m.image_editor_ellipse() },
									{ value: 'line', label: m.image_editor_line() }
								]}
								class="h-9 w-full"
							/>
						</label>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_fill()}</span>
							<ImageEditorColorPicker
								label={m.image_editor_fill()}
								value={layer.shape.fill}
								disabled={!editor.canEdit}
								{brandColors}
								recentColors={editor.recentColors}
								onChange={(value) =>
									editor.updateLayer(
										layer.id,
										{ shape: { ...layer.shape!, fill: value } },
										`shape-fill:${layer.id}`
									)}
								onCommit={(value) => editor.rememberColor(value)}
							/>
						</label>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_stroke()}</span>
								<ImageEditorColorPicker
									label={m.image_editor_stroke()}
									value={layer.shape.stroke}
									disabled={!editor.canEdit}
									{brandColors}
									recentColors={editor.recentColors}
									onChange={(value) =>
										editor.updateLayer(layer.id, {
											shape: { ...layer.shape!, stroke: value }
										})}
									onCommit={(value) => editor.rememberColor(value)}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.image_editor_stroke_width()}</span>
								<Input
									type="number"
									min="0"
									max="64"
									value={layer.shape.stroke_width}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											shape: {
												...layer.shape!,
												stroke_width: numberValue(event, layer.shape!.stroke_width)
											}
										})}
								/>
							</label>
						</div>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_corner_radius()}</span>
							<Input
								type="number"
								min="0"
								value={layer.shape.radius}
								disabled={!editor.canEdit ||
									!['rectangle', 'rounded_rectangle'].includes(layer.shape.kind)}
								oninput={(event) =>
									editor.updateLayer(layer.id, {
										shape: {
											...layer.shape!,
											kind:
												numberValue(event, layer.shape!.radius) > 0
													? 'rounded_rectangle'
													: 'rectangle',
											radius: Math.max(0, numberValue(event, layer.shape!.radius))
										}
									})}
							/>
						</label>
					</section>
				{/if}

				{#if layer.type === 'image' && layer.image}
					<section class="space-y-2 border-t pt-4">
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							{m.image_editor_image()}
						</h3>
						<label class="grid gap-1 text-xs">
							<span>{m.image_editor_fit()}</span>
							<AppSelect
								value={layer.image.fit}
								ariaLabel={m.image_editor_fit()}
								disabled={!editor.canEdit}
								onValueChange={(value) =>
									editor.updateLayer(layer.id, {
										image: {
											...layer.image!,
											fit: value as 'cover' | 'contain' | 'stretch'
										}
									})}
								options={[
									{ value: 'cover', label: m.image_editor_cover() },
									{ value: 'contain', label: m.image_editor_contain() },
									{ value: 'stretch', label: m.image_editor_stretch() }
								]}
								class="h-9 w-full"
							/>
						</label>
						<Collapsible.Root bind:open={cropOpen} class="rounded-md border">
							<div class="flex min-h-9 items-center gap-1 px-1">
								<Collapsible.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											type="button"
											class="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-1.5 text-left text-xs font-medium hover:bg-muted"
										>
											<CropIcon class="size-3.5" />
											<span class="min-w-0 flex-1">{m.image_editor_crop()}</span>
											<ChevronDownIcon
												class="size-3.5 transition-transform data-[open=true]:rotate-180"
												data-open={cropOpen}
											/>
										</button>
									{/snippet}
								</Collapsible.Trigger>
								<Button
									variant="ghost"
									size="xs"
									onclick={() =>
										editor.updateLayer(layer.id, {
											image: {
												...layer.image!,
												crop: { x: 0, y: 0, width: 1, height: 1 }
											}
										})}
								>
									{m.image_editor_reset()}
								</Button>
							</div>
							<Collapsible.Content class="border-t p-2">
								<p class="mb-2 text-xs text-muted-foreground">{m.image_editor_crop_percent()}</p>
								<div class="grid grid-cols-2 gap-2">
									{#each [['X', 'x'], ['Y', 'y'], ['W', 'width'], ['H', 'height']] as [label, key] (key)}
										<label class="grid grid-cols-[1.25rem_1fr] items-center gap-1 text-xs">
											<span class="text-muted-foreground">{label}</span>
											<Input
												type="number"
												min="0"
												max="100"
												step="1"
												value={Math.round(cropValue(key as 'x' | 'y' | 'width' | 'height') * 100)}
												disabled={!editor.canEdit}
												oninput={(event) =>
													updateCrop(
														key as 'x' | 'y' | 'width' | 'height',
														event,
														cropValue(key as 'x' | 'y' | 'width' | 'height')
													)}
											/>
										</label>
									{/each}
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">{m.image_editor_adjustments()}</span>
							<Button
								variant="ghost"
								size="xs"
								onclick={() =>
									editor.updateLayer(layer.id, {
										image: { ...layer.image!, adjustments: defaultImageAdjustments() }
									})}
							>
								{m.image_editor_reset_all()}
							</Button>
						</div>
						<div class="space-y-2">
							<span class="text-xs font-medium">{m.image_editor_quick_looks()}</span>
							<div class="grid grid-cols-3 gap-1">
								{#each quickLooks as look (look.key)}
									<Button
										variant={lookIsActive(look.adjustments) ? 'secondary' : 'outline'}
										size="xs"
										aria-pressed={lookIsActive(look.adjustments)}
										onclick={() => applyLook(look.adjustments)}
									>
										{look.label}
									</Button>
								{/each}
							</div>
						</div>
						{#each adjustmentGroups as group (group.label)}
							<div class="space-y-3 border-t pt-3">
								<h4 class="text-xs font-medium">{group.label}</h4>
								{#each group.controls as [label, key, min, max] (key)}
									<label class="grid gap-1 text-xs">
										<span class="flex items-center justify-between gap-2">
											<span>{label}</span>
											<span class="text-muted-foreground tabular-nums">
												{Math.round(layer.image.adjustments[key] * 100)}
											</span>
										</span>
										<Slider
											{min}
											{max}
											step={0.01}
											value={layer.image.adjustments[key]}
											disabled={!editor.canEdit}
											ariaLabel={label}
											onValueChange={(value) => setAdjustment(key, value)}
										/>
									</label>
								{/each}
							</div>
						{/each}
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.image-editor-properties-scroll :global(.grid > *),
	.image-editor-properties-scroll :global(.flex > *) {
		min-width: 0;
	}
</style>
