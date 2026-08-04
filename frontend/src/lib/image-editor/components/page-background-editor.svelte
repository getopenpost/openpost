<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import MediaPreviewImage from '$lib/components/media-preview-image.svelte';
	import { m } from '$lib/paraglide/messages';
	import { defaultImageEditorPageGradient, imageEditorPageBackground } from '../document';
	import { gradientColorAt, normalizedGradientStops } from '../gradient';
	import { normalizeHex } from '../color';
	import { useImageEditor } from '../editor.svelte';
	import type {
		ImageEditorGradientType,
		ImageEditorGradientValue,
		ImageEditorPageBackground
	} from '../types';
	import ImageEditorColorPicker from './image-editor-color-picker.svelte';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import TrashIcon from 'lucide-svelte/icons/trash-2';
	import ImageIcon from 'lucide-svelte/icons/image';

	let { onOpenMedia = () => undefined }: { onOpenMedia?: () => void } = $props();

	const editor = useImageEditor();
	let page = $derived(editor.activePage);
	let background = $derived(
		page
			? imageEditorPageBackground(page)
			: ({ type: 'solid', color: '#ffffff', opacity: 1 } as const)
	);
	let brandColors = $derived(editor.brandKit?.colors ?? []);
	let gradientStops = $derived(
		background.type === 'gradient' && background.gradient
			? normalizedGradientStops(background.gradient.stops, background.gradient.reverse)
			: []
	);
	let gradientPreview = $derived(
		gradientStops.length
			? `linear-gradient(90deg, ${gradientStops
					.map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
					.join(', ')})`
			: 'linear-gradient(90deg, #f97316, #7c3aed)'
	);

	function updateBackground(next: ImageEditorPageBackground, coalesceKey?: string): void {
		editor.mutate(
			'Change page background',
			(document) => {
				const target = document.pages.find((item) => item.id === editor.activePageID);
				if (!target) return;
				target.background = structuredClone(next);
				if (next.type === 'solid' && next.color) target.background_color = next.color;
			},
			coalesceKey
		);
	}

	function setBackgroundType(type: ImageEditorPageBackground['type']): void {
		if (!editor.document) return;
		if (type === 'transparent') {
			updateBackground({ type: 'transparent', opacity: 0 });
			return;
		}
		if (type === 'solid') {
			updateBackground({
				type: 'solid',
				color: background.type === 'solid' ? background.color : page?.background_color || '#ffffff',
				opacity: background.type === 'solid' ? background.opacity : 1
			});
			return;
		}
		if (type === 'gradient') {
			updateBackground({
				type: 'gradient',
				opacity: background.type === 'gradient' ? background.opacity : 1,
				gradient:
					background.type === 'gradient' && background.gradient
						? background.gradient
						: defaultImageEditorPageGradient(editor.document.width_px, editor.document.height_px)
			});
			return;
		}
		editor.backgroundImagePickerActive = true;
		onOpenMedia();
	}

	function updateGradient(
		mutation: (gradient: ImageEditorGradientValue) => void,
		coalesceKey?: string
	): void {
		if (background.type !== 'gradient' || !background.gradient) return;
		const gradient = structuredClone(background.gradient);
		mutation(gradient);
		updateBackground({ ...background, gradient }, coalesceKey);
	}

	function gradientAngle(gradient: ImageEditorGradientValue): number {
		return Math.round(
			(Math.atan2(gradient.end.y - gradient.start.y, gradient.end.x - gradient.start.x) * 180) /
				Math.PI
		);
	}

	function setGradientAngle(angle: number): void {
		if (!editor.document) return;
		const radians = (angle * Math.PI) / 180;
		const centerX = editor.document.width_px / 2;
		const centerY = editor.document.height_px / 2;
		const radius = Math.hypot(editor.document.width_px, editor.document.height_px) / 2;
		updateGradient((gradient) => {
			gradient.start = {
				x: centerX - Math.cos(radians) * radius,
				y: centerY - Math.sin(radians) * radius
			};
			gradient.end = {
				x: centerX + Math.cos(radians) * radius,
				y: centerY + Math.sin(radians) * radius
			};
		}, 'page-background-angle');
	}

	function addGradientStop(): void {
		if (background.type !== 'gradient' || !background.gradient) return;
		const stops = normalizedGradientStops(background.gradient.stops);
		let left = stops[0];
		let right = stops[1];
		for (let index = 1; index < stops.length; index++) {
			const candidateLeft = stops[index - 1];
			const candidateRight = stops[index];
			if (candidateRight.offset - candidateLeft.offset > right.offset - left.offset) {
				left = candidateLeft;
				right = candidateRight;
			}
		}
		const offset = (left.offset + right.offset) / 2;
		const point = {
			x:
				background.gradient.start.x +
				(background.gradient.end.x - background.gradient.start.x) * offset,
			y:
				background.gradient.start.y +
				(background.gradient.end.y - background.gradient.start.y) * offset
		};
		const interpolatedColor = gradientColorAt(background.gradient, point);
		updateGradient((gradient) => {
			gradient.stops.push({
				offset,
				color: normalizeHex(interpolatedColor, interpolatedColor)
			});
			gradient.stops.sort((first, second) => first.offset - second.offset);
		});
	}

	function updateGradientStop(
		index: number,
		updates: Partial<ImageEditorGradientValue['stops'][number]>,
		coalesceKey?: string
	): void {
		updateGradient((gradient) => {
			gradient.stops[index] = { ...gradient.stops[index], ...updates };
		}, coalesceKey);
	}

	function removeGradientStop(index: number): void {
		updateGradient((gradient) => {
			if (gradient.stops.length > 2) gradient.stops.splice(index, 1);
		});
	}

	function setOpacity(opacity: number): void {
		if (background.type === 'transparent') return;
		updateBackground({ ...background, opacity }, 'page-background-opacity');
	}
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-sm font-semibold">{m.image_editor_page_background()}</h3>
		<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
			{m.image_editor_page_background_help()}
		</p>
	</div>

	<div class="grid grid-cols-2 gap-2">
		<Button
			variant={background.type === 'transparent' ? 'secondary' : 'outline'}
			class="min-h-11 justify-start"
			aria-pressed={background.type === 'transparent'}
			disabled={!editor.canEdit}
			onclick={() => setBackgroundType('transparent')}
		>
			<span class="background-checker size-4 rounded-sm border"></span>
			{m.image_editor_transparent()}
		</Button>
		<Button
			variant={background.type === 'solid' ? 'secondary' : 'outline'}
			class="min-h-11 justify-start"
			aria-pressed={background.type === 'solid'}
			disabled={!editor.canEdit}
			onclick={() => setBackgroundType('solid')}
		>
			<span
				class="size-4 rounded-sm border"
				style:background-color={background.type === 'solid'
					? background.color
					: page?.background_color}
			></span>
			{m.image_editor_solid_color()}
		</Button>
		<Button
			variant={background.type === 'gradient' ? 'secondary' : 'outline'}
			class="min-h-11 justify-start"
			aria-pressed={background.type === 'gradient'}
			disabled={!editor.canEdit}
			onclick={() => setBackgroundType('gradient')}
		>
			<span class="size-4 rounded-sm border" style:background={gradientPreview}></span>
			{m.image_editor_gradient()}
		</Button>
		<Button
			variant={background.type === 'image' ? 'secondary' : 'outline'}
			class="min-h-11 justify-start"
			aria-pressed={background.type === 'image'}
			disabled={!editor.canEdit}
			onclick={() => setBackgroundType('image')}
		>
			<ImageIcon />
			{m.image_editor_image()}
		</Button>
	</div>

	{#if background.type === 'solid'}
		<ImageEditorColorPicker
			label={m.image_editor_background_color()}
			value={background.color ?? '#ffffff'}
			disabled={!editor.canEdit}
			{brandColors}
			recentColors={editor.recentColors}
			onChange={(color) => updateBackground({ ...background, color }, 'page-background-color')}
			onCommit={(color) => editor.rememberColor(color)}
		/>
	{:else if background.type === 'gradient' && background.gradient}
		<div class="space-y-3 rounded-lg border p-3">
			<div class="h-8 rounded-md border shadow-inner" style:background={gradientPreview}></div>
			<div class="grid grid-cols-2 gap-2">
				<AppSelect
					value={background.gradient.type}
					ariaLabel={m.image_editor_gradient_style()}
					disabled={!editor.canEdit}
					onValueChange={(value) =>
						updateGradient(
							(gradient) => (gradient.type = value as ImageEditorGradientType),
							'page-background-gradient-type'
						)}
					options={[
						{ value: 'linear', label: m.image_editor_gradient_linear() },
						{ value: 'radial', label: m.image_editor_gradient_radial() },
						{ value: 'angle', label: m.image_editor_gradient_angle() },
						{ value: 'reflected', label: m.image_editor_gradient_reflected() },
						{ value: 'diamond', label: m.image_editor_gradient_diamond() }
					]}
					class="h-11 w-full lg:h-10"
				/>
				<Button
					variant={background.gradient.reverse ? 'secondary' : 'outline'}
					class="min-h-11 lg:min-h-10"
					aria-pressed={background.gradient.reverse}
					disabled={!editor.canEdit}
					onclick={() => updateGradient((gradient) => (gradient.reverse = !gradient.reverse))}
				>
					{m.image_editor_gradient_reverse()}
				</Button>
			</div>
			<label class="grid gap-1 text-xs">
				<span>
					{m.image_editor_gradient_direction({
						value: gradientAngle(background.gradient)
					})}
				</span>
				<Slider
					value={gradientAngle(background.gradient)}
					min={-180}
					max={180}
					step={1}
					disabled={!editor.canEdit}
					ariaLabel={m.image_editor_gradient_direction({
						value: gradientAngle(background.gradient)
					})}
					onValueChange={setGradientAngle}
				/>
			</label>
			<div class="space-y-3">
				{#each background.gradient.stops as stop, index (`${index}:${stop.offset}:${stop.color}`)}
					<div class="space-y-2 rounded-md border p-2">
						<div class="flex items-center gap-2">
							<span class="min-w-0 flex-1 text-xs font-medium">
								{m.image_editor_gradient_stop({ number: index + 1 })}
							</span>
							<Button
								variant="ghost"
								size="icon-xs"
								disabled={!editor.canEdit || background.gradient.stops.length <= 2}
								aria-label={m.image_editor_remove_gradient_stop({ number: index + 1 })}
								onclick={() => removeGradientStop(index)}
							>
								<TrashIcon />
							</Button>
						</div>
						<ImageEditorColorPicker
							label={m.image_editor_gradient_stop_color({ number: index + 1 })}
							value={stop.color}
							disabled={!editor.canEdit}
							{brandColors}
							recentColors={editor.recentColors}
							onChange={(color) =>
								updateGradientStop(index, { color }, `page-background-stop-color:${index}`)}
							onCommit={(color) => editor.rememberColor(color)}
						/>
						<label class="grid gap-1 text-xs">
							<span
								>{m.image_editor_gradient_stop_position({
									value: Math.round(stop.offset * 100)
								})}</span
							>
							<Slider
								value={stop.offset * 100}
								min={0}
								max={100}
								step={1}
								disabled={!editor.canEdit}
								ariaLabel={m.image_editor_gradient_stop_position({
									value: Math.round(stop.offset * 100)
								})}
								onValueChange={(value) =>
									updateGradientStop(
										index,
										{ offset: value / 100 },
										`page-background-stop-position:${index}`
									)}
							/>
						</label>
					</div>
				{/each}
			</div>
			<Button
				variant="outline"
				class="min-h-11 w-full"
				disabled={!editor.canEdit || background.gradient.stops.length >= 32}
				onclick={addGradientStop}
			>
				<PlusIcon />
				{m.image_editor_add_gradient_stop()}
			</Button>
		</div>
	{:else if background.type === 'image'}
		<div class="space-y-3 rounded-lg border p-3">
			{#if background.image?.media_id}
				<MediaPreviewImage
					mediaId={background.image.media_id}
					alt={m.image_editor_page_background()}
					class="aspect-video w-full rounded-md border object-cover"
				/>
				<AppSelect
					value={background.image.fit}
					ariaLabel={m.image_editor_fit()}
					disabled={!editor.canEdit}
					onValueChange={(fit) =>
						updateBackground({
							...background,
							image: {
								...background.image!,
								fit: fit as 'cover' | 'contain' | 'stretch'
							}
						})}
					options={[
						{ value: 'cover', label: m.image_editor_cover() },
						{ value: 'contain', label: m.image_editor_contain() },
						{ value: 'stretch', label: m.image_editor_stretch() }
					]}
					class="h-11 w-full lg:h-10"
				/>
			{/if}
			<Button
				variant="outline"
				class="min-h-11 w-full"
				disabled={!editor.canEdit}
				onclick={() => {
					editor.backgroundImagePickerActive = true;
					onOpenMedia();
				}}
			>
				{background.image?.media_id
					? m.image_editor_replace_background_image()
					: m.image_editor_choose_background_image()}
			</Button>
		</div>
	{/if}

	{#if background.type !== 'transparent'}
		<label class="grid gap-1 text-xs">
			<span
				>{m.image_editor_background_opacity({ value: Math.round(background.opacity * 100) })}</span
			>
			<Slider
				value={background.opacity}
				min={0}
				max={1}
				step={0.01}
				disabled={!editor.canEdit}
				ariaLabel={m.image_editor_background_opacity({
					value: Math.round(background.opacity * 100)
				})}
				onValueChange={setOpacity}
			/>
		</label>
	{/if}
</section>

<style>
	.background-checker {
		background-color: color-mix(in oklch, var(--background) 78%, var(--foreground));
		background-image: conic-gradient(
			color-mix(in oklch, var(--background) 55%, var(--foreground)) 25%,
			transparent 0 50%,
			color-mix(in oklch, var(--background) 55%, var(--foreground)) 0 75%,
			transparent 0
		);
		background-size: 6px 6px;
	}
</style>
