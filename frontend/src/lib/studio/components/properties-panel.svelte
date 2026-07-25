<script lang="ts">
	import { useStudioEditor } from '../editor.svelte';
	import { defaultImageAdjustments } from '../document';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import CopyIcon from 'lucide-svelte/icons/copy';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import BringToFrontIcon from 'lucide-svelte/icons/bring-to-front';
	import SendToBackIcon from 'lucide-svelte/icons/send-to-back';
	import FlipHorizontalIcon from 'lucide-svelte/icons/flip-horizontal-2';
	import FlipVerticalIcon from 'lucide-svelte/icons/flip-vertical-2';
	import { m } from '$lib/paraglide/messages';

	const editor = useStudioEditor();
	let layer = $derived(editor.selectedLayers[0] ?? null);

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
		if (alignment === 'left') return m.studio_align_left();
		if (alignment === 'center') return m.studio_align_center();
		return m.studio_align_right();
	}

	const adjustmentControls = [
		[m.studio_brightness(), 'brightness', -1, 1],
		[m.studio_contrast(), 'contrast', -1, 1],
		[m.studio_saturation(), 'saturation', -1, 1],
		[m.studio_exposure(), 'exposure', -1, 1],
		[m.studio_temperature(), 'temperature', -1, 1],
		[m.studio_highlights(), 'highlights', -1, 1],
		[m.studio_shadows(), 'shadows', -1, 1],
		[m.studio_blur(), 'blur', 0, 1]
	] as const;
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
	<div class="border-b px-3 py-2">
		<h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
			{m.studio_properties()}
		</h2>
	</div>
	<div
		class="studio-properties-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3"
	>
		{#if !layer}
			<section class="space-y-3">
				<div>
					<label for="page-background" class="mb-1 block text-xs font-medium"
						>{m.studio_page_background()}</label
					>
					<div class="flex gap-2">
						<input
							id="page-background"
							type="color"
							value={editor.activePage?.background_color ?? '#ffffff'}
							class="size-10 rounded-md border bg-background p-1"
							disabled={!editor.canEdit}
							oninput={(event) =>
								editor.mutate(
									'Change page background',
									(document) => {
										const page = document.pages.find((item) => item.id === editor.activePageID);
										if (page) page.background_color = event.currentTarget.value;
									},
									'page-background'
								)}
						/>
						<Input
							value={editor.activePage?.background_color ?? '#ffffff'}
							disabled={!editor.canEdit}
							onchange={(event) =>
								editor.mutate('Change page background', (document) => {
									const page = document.pages.find((item) => item.id === editor.activePageID);
									if (page) page.background_color = event.currentTarget.value;
								})}
						/>
					</div>
				</div>
				<p class="text-sm text-muted-foreground">{m.studio_select_layer_help()}</p>
			</section>
		{:else}
			<div class="space-y-5">
				<section class="space-y-2">
					<label for="layer-name" class="block text-xs font-medium">{m.studio_layer_name()}</label>
					<Input
						id="layer-name"
						value={layer.name}
						disabled={!editor.canEdit}
						onchange={(event) => editor.updateLayer(layer.id, { name: event.currentTarget.value })}
					/>
					<div class="grid grid-cols-2 gap-2">
						<Button variant="outline" size="sm" onclick={() => align('horizontal')}
							>{m.studio_center_x()}</Button
						>
						<Button variant="outline" size="sm" onclick={() => align('vertical')}
							>{m.studio_center_y()}</Button
						>
					</div>
					{#if editor.selectedLayers.length > 1}
						<div class="grid grid-cols-3 gap-1">
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('left')}
								>{m.studio_align_left()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('center_x')}
								>{m.studio_align_center()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('right')}
								>{m.studio_align_right()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('top')}
								>{m.studio_align_top()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('center_y')}
								>{m.studio_align_middle()}</Button
							>
							<Button variant="outline" size="xs" onclick={() => editor.alignSelected('bottom')}
								>{m.studio_align_bottom()}</Button
							>
						</div>
						{#if editor.selectedLayers.length > 2}
							<div class="grid grid-cols-2 gap-1">
								<Button
									variant="outline"
									size="xs"
									onclick={() => editor.distributeSelected('horizontal')}
									>{m.studio_distribute_x()}</Button
								>
								<Button
									variant="outline"
									size="xs"
									onclick={() => editor.distributeSelected('vertical')}
									>{m.studio_distribute_y()}</Button
								>
							</div>
						{/if}
					{/if}
					<div class="grid grid-cols-4 gap-1">
						<Button
							variant="outline"
							size="icon-sm"
							onclick={() => editor.reorderLayer(layer.id, 'front')}
							aria-label={m.studio_bring_front()}><BringToFrontIcon /></Button
						>
						<Button
							variant="outline"
							size="icon-sm"
							onclick={() => editor.reorderLayer(layer.id, 'back')}
							aria-label={m.studio_send_back()}><SendToBackIcon /></Button
						>
						<Button
							variant="outline"
							size="icon-sm"
							onclick={() => editor.duplicateSelected()}
							aria-label={m.studio_duplicate()}><CopyIcon /></Button
						>
						<Button
							variant="destructive"
							size="icon-sm"
							onclick={() => editor.deleteSelected()}
							aria-label={m.studio_delete_layer()}><TrashIcon /></Button
						>
					</div>
				</section>

				<section class="space-y-2 border-t pt-4">
					<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						{m.studio_transform()}
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
					<label class="grid gap-1 text-xs">
						<span>{m.studio_rotation()}</span>
						<Input
							type="number"
							value={Math.round(layer.transform.rotation)}
							disabled={!editor.canEdit || layer.locked}
							oninput={(event) =>
								editor.updateTransform(layer.id, {
									rotation: numberValue(event, layer.transform.rotation)
								})}
						/>
					</label>
					<div class="grid grid-cols-2 gap-2">
						<Button
							variant={layer.transform.flip_x ? 'secondary' : 'outline'}
							size="sm"
							onclick={() => editor.updateTransform(layer.id, { flip_x: !layer.transform.flip_x })}
						>
							<FlipHorizontalIcon />
							{m.studio_flip_x()}
						</Button>
						<Button
							variant={layer.transform.flip_y ? 'secondary' : 'outline'}
							size="sm"
							onclick={() => editor.updateTransform(layer.id, { flip_y: !layer.transform.flip_y })}
						>
							<FlipVerticalIcon />
							{m.studio_flip_y()}
						</Button>
					</div>
					<label class="grid gap-1 text-xs">
						<span>{m.studio_opacity({ value: Math.round(layer.opacity * 100) })}</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.01"
							value={layer.opacity}
							disabled={!editor.canEdit}
							oninput={(event) =>
								editor.updateLayer(
									layer.id,
									{ opacity: numberValue(event, layer.opacity) },
									`opacity:${layer.id}`
								)}
						/>
					</label>
				</section>

				{#if layer.type === 'text' && layer.text}
					<section class="space-y-2 border-t pt-4">
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							{m.studio_text()}
						</h3>
						<textarea
							class="min-h-24 w-full resize-y rounded-md border border-input bg-input/20 px-3 py-2 text-sm"
							value={layer.text.text}
							disabled={!editor.canEdit}
							oninput={(event) =>
								editor.updateLayer(
									layer.id,
									{ text: { ...layer.text!, text: event.currentTarget.value } },
									`text:${layer.id}`
								)}
						></textarea>
						<label class="grid gap-1 text-xs">
							<span>{m.studio_font_family()}</span>
							<Input
								value={layer.text.font_family}
								disabled={!editor.canEdit}
								onchange={(event) =>
									editor.updateLayer(layer.id, {
										text: { ...layer.text!, font_family: event.currentTarget.value }
									})}
							/>
						</label>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.studio_size()}</span>
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
								<span>{m.studio_weight()}</span>
								<select
									class="h-9 rounded-md border border-input bg-background px-2"
									value={layer.text.font_weight}
									disabled={!editor.canEdit}
									onchange={(event) =>
										editor.updateLayer(layer.id, {
											text: { ...layer.text!, font_weight: Number(event.currentTarget.value) }
										})}
								>
									<option value="400">{m.studio_regular()}</option>
									<option value="500">{m.studio_medium()}</option>
									<option value="600">{m.studio_semibold()}</option>
									<option value="700">{m.studio_bold()}</option>
									<option value="800">{m.studio_extra_bold()}</option>
								</select>
							</label>
						</div>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.studio_style()}</span>
								<select
									class="h-9 rounded-md border border-input bg-background px-2"
									value={layer.text.font_style}
									disabled={!editor.canEdit}
									onchange={(event) =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												font_style: event.currentTarget.value as 'normal' | 'italic'
											}
										})}
								>
									<option value="normal">{m.studio_normal()}</option>
									<option value="italic">{m.studio_italic()}</option>
								</select>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.studio_line_height()}</span>
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
							<span>{m.studio_letter_spacing()}</span>
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
							<span>{m.studio_color()}</span>
							<input
								type="color"
								value={layer.text.color}
								class="h-10 w-full rounded-md border bg-background p-1"
								disabled={!editor.canEdit}
								oninput={(event) =>
									editor.updateLayer(
										layer.id,
										{ text: { ...layer.text!, color: event.currentTarget.value } },
										`text-color:${layer.id}`
									)}
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
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.studio_highlight()}</span>
								<input
									type="color"
									value={layer.text.highlight_color?.slice(0, 7) || '#ffffff'}
									class="h-10 w-full rounded-md border bg-background p-1"
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											text: { ...layer.text!, highlight_color: event.currentTarget.value }
										})}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.studio_stroke()}</span>
								<input
									type="color"
									value={layer.text.stroke_color?.slice(0, 7) || '#000000'}
									class="h-10 w-full rounded-md border bg-background p-1"
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											text: { ...layer.text!, stroke_color: event.currentTarget.value }
										})}
								/>
							</label>
						</div>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.studio_stroke_width()}</span>
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
							<label class="grid gap-1 text-xs">
								<span>{m.studio_shadow_blur()}</span>
								<Input
									type="number"
									min="0"
									max="100"
									value={layer.text.shadow.blur}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												shadow: {
													...layer.text!.shadow,
													blur: numberValue(event, layer.text!.shadow.blur)
												}
											}
										})}
								/>
							</label>
						</div>
						<div class="grid grid-cols-3 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.studio_shadow()}</span>
								<input
									type="color"
									value={layer.text.shadow.color.slice(0, 7)}
									class="h-10 w-full rounded-md border bg-background p-1"
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												shadow: { ...layer.text!.shadow, color: event.currentTarget.value }
											}
										})}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.studio_offset_x()}</span>
								<Input
									type="number"
									value={layer.text.shadow.offset_x}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												shadow: {
													...layer.text!.shadow,
													offset_x: numberValue(event, layer.text!.shadow.offset_x)
												}
											}
										})}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.studio_offset_y()}</span>
								<Input
									type="number"
									value={layer.text.shadow.offset_y}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											text: {
												...layer.text!,
												shadow: {
													...layer.text!.shadow,
													offset_y: numberValue(event, layer.text!.shadow.offset_y)
												}
											}
										})}
								/>
							</label>
						</div>
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
										shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 }
									}
								})}>{m.studio_clear_text_effects()}</Button
						>
					</section>
				{/if}

				{#if layer.type === 'shape' && layer.shape}
					<section class="space-y-2 border-t pt-4">
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							{m.studio_shape()}
						</h3>
						<label class="grid gap-1 text-xs">
							<span>{m.studio_fill()}</span>
							<input
								type="color"
								value={layer.shape.fill}
								class="h-10 w-full rounded-md border bg-background p-1"
								disabled={!editor.canEdit}
								oninput={(event) =>
									editor.updateLayer(
										layer.id,
										{ shape: { ...layer.shape!, fill: event.currentTarget.value } },
										`shape-fill:${layer.id}`
									)}
							/>
						</label>
						<div class="grid grid-cols-2 gap-2">
							<label class="grid gap-1 text-xs">
								<span>{m.studio_stroke()}</span>
								<input
									type="color"
									value={layer.shape.stroke}
									class="h-10 w-full rounded-md border bg-background p-1"
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(layer.id, {
											shape: { ...layer.shape!, stroke: event.currentTarget.value }
										})}
								/>
							</label>
							<label class="grid gap-1 text-xs">
								<span>{m.studio_stroke_width()}</span>
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
							<span>{m.studio_corner_radius()}</span>
							<Input
								type="number"
								min="0"
								value={layer.shape.radius}
								disabled={!editor.canEdit || layer.shape.kind !== 'rounded_rectangle'}
								oninput={(event) =>
									editor.updateLayer(layer.id, {
										shape: {
											...layer.shape!,
											radius: numberValue(event, layer.shape!.radius)
										}
									})}
							/>
						</label>
					</section>
				{/if}

				{#if layer.type === 'image' && layer.image}
					<section class="space-y-2 border-t pt-4">
						<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
							{m.studio_image()}
						</h3>
						<label class="grid gap-1 text-xs">
							<span>{m.studio_fit()}</span>
							<select
								class="h-9 rounded-md border border-input bg-background px-2"
								value={layer.image.fit}
								disabled={!editor.canEdit}
								onchange={(event) =>
									editor.updateLayer(layer.id, {
										image: {
											...layer.image!,
											fit: event.currentTarget.value as 'cover' | 'contain' | 'stretch'
										}
									})}
							>
								<option value="cover">{m.studio_cover()}</option>
								<option value="contain">{m.studio_contain()}</option>
								<option value="stretch">{m.studio_stretch()}</option>
							</select>
						</label>
						<div class="space-y-2 rounded-md border p-2">
							<div class="flex items-center justify-between gap-2">
								<span class="text-xs font-medium">{m.studio_crop_percent()}</span>
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
									{m.studio_reset()}
								</Button>
							</div>
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
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium">{m.studio_adjustments()}</span>
							<Button
								variant="ghost"
								size="xs"
								onclick={() =>
									editor.updateLayer(layer.id, {
										image: { ...layer.image!, adjustments: defaultImageAdjustments() }
									})}
							>
								{m.studio_reset_all()}
							</Button>
						</div>
						{#each adjustmentControls as [label, key, min, max] (key)}
							<label class="grid gap-1 text-xs">
								<span>{label}</span>
								<input
									type="range"
									{min}
									{max}
									step="0.01"
									value={layer.image.adjustments[key as keyof typeof layer.image.adjustments]}
									disabled={!editor.canEdit}
									oninput={(event) =>
										editor.updateLayer(
											layer.id,
											{
												image: {
													...layer.image!,
													adjustments: {
														...layer.image!.adjustments,
														[key]: numberValue(
															event,
															layer.image!.adjustments[key as keyof typeof layer.image.adjustments]
														)
													}
												}
											},
											`image-${key}:${layer.id}`
										)}
								/>
							</label>
						{/each}
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.studio-properties-scroll :global(.grid > *),
	.studio-properties-scroll :global(.flex > *) {
		min-width: 0;
	}
</style>
