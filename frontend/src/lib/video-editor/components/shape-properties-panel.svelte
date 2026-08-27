<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import type { ShapeType, TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import { hasPathVertexKeyframes } from '$lib/video-editor/timeline/path-vertex-keyframes';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();

	const shapeTypes: Array<{ type: ShapeType; label: () => string }> = [
		{ type: 'rectangle', label: m.video_editor_shape_primitive_rectangle },
		{ type: 'circle', label: m.video_editor_shape_primitive_circle },
		{ type: 'ellipse', label: m.video_editor_shape_primitive_ellipse },
		{ type: 'triangle', label: m.video_editor_shape_primitive_triangle },
		{ type: 'star', label: m.video_editor_shape_primitive_star },
		{ type: 'polygon', label: m.video_editor_shape_primitive_polygon },
		{ type: 'heart', label: m.video_editor_shape_primitive_heart },
		{ type: 'path', label: m.video_editor_shape_primitive_pen }
	];
	const pathTopologyLocked = $derived(
		item.shapeType === 'path' && hasPathVertexKeyframes(item.keyframes)
	);
	type StrokePathProperty =
		| 'trimPathStart'
		| 'trimPathEnd'
		| 'trimPathOffset'
		| 'taperStartWidth'
		| 'taperEndWidth'
		| 'taperStartLength'
		| 'taperEndLength';
	interface StrokePathField {
		property: StrokePathProperty;
		label: string;
		minimum: number;
		maximum: number;
		defaultValue: number;
	}
	const trimPathFields: StrokePathField[] = [
		{
			property: 'trimPathStart',
			label: m.video_editor_shape_trim_start(),
			minimum: 0,
			maximum: 100,
			defaultValue: 0
		},
		{
			property: 'trimPathEnd',
			label: m.video_editor_shape_trim_end(),
			minimum: 0,
			maximum: 100,
			defaultValue: 100
		},
		{
			property: 'trimPathOffset',
			label: m.video_editor_shape_trim_offset(),
			minimum: -360,
			maximum: 360,
			defaultValue: 0
		}
	];
	const taperFields: StrokePathField[] = [
		{
			property: 'taperStartWidth',
			label: m.video_editor_shape_taper_start_width(),
			minimum: 0,
			maximum: 200,
			defaultValue: 100
		},
		{
			property: 'taperStartLength',
			label: m.video_editor_shape_taper_start_length(),
			minimum: 0,
			maximum: 100,
			defaultValue: 0
		},
		{
			property: 'taperEndWidth',
			label: m.video_editor_shape_taper_end_width(),
			minimum: 0,
			maximum: 200,
			defaultValue: 100
		},
		{
			property: 'taperEndLength',
			label: m.video_editor_shape_taper_end_length(),
			minimum: 0,
			maximum: 100,
			defaultValue: 0
		}
	];

	function commit(patch: Partial<TimelineItem>): void {
		updateItemProperties(item.id, patch, 'UPDATE_SHAPE_PROPERTIES');
		onedit();
	}

	function numberPatch(property: keyof TimelineItem, value: number): void {
		if (Number.isFinite(value)) commit({ [property]: value });
	}

	function strokePathPatch(field: StrokePathField, value: number): void {
		if (!Number.isFinite(value)) return;
		commit({ [field.property]: Math.max(field.minimum, Math.min(field.maximum, value)) });
	}

	function setMaskEnabled(enabled: boolean): void {
		if (enabled && pathTopologyLocked && item.pathClosed === false) return;
		commit({
			isMask: enabled,
			blendMode: enabled ? 'normal' : undefined,
			maskType: enabled ? 'clip' : undefined,
			maskFeather: enabled ? 0 : undefined,
			maskOpacity: enabled ? 100 : undefined,
			maskInvert: enabled ? false : undefined,
			pathClosed: enabled ? true : item.pathClosed
		});
	}

	function setMaskType(maskType: 'clip' | 'alpha'): void {
		const existingFeather = item.maskFeather ?? 0;
		commit({
			maskType,
			maskFeather: maskType === 'alpha' ? (existingFeather > 0 ? existingFeather : 10) : 0
		});
	}
</script>

<section class="flex flex-col gap-2">
	<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_shapes()}
	</h3>

	<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
		{m.video_editor_shape_kind()}
		<AppSelect
			class="mt-0.5 h-8 w-full text-xs"
			value={item.shapeType ?? 'rectangle'}
			options={shapeTypes.map((shape) => ({ value: shape.type, label: shape.label() }))}
			disabled={pathTopologyLocked}
			ariaLabel={m.video_editor_shape_kind()}
			onValueChange={(value) => commit({ shapeType: value as ShapeType })}
		/>
	</label>
	{#if pathTopologyLocked}
		<p class="rounded bg-amber-400/10 px-2 py-1.5 text-[10px] leading-4 text-amber-100">
			{m.video_editor_path_topology_locked()}
		</p>
	{/if}

	{#if !item.isMask}
		<div class="grid grid-cols-2 gap-1">
			<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
				<Checkbox
					checked={item.fillEnabled ?? true}
					onCheckedChange={(checked) => commit({ fillEnabled: checked === true })}
					aria-label={m.video_editor_shape_fill_enabled()}
				/>
				{m.video_editor_shape_fill_enabled()}
			</label>
			<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
				<Checkbox
					checked={item.strokeEnabled ?? false}
					onCheckedChange={(checked) => commit({ strokeEnabled: checked === true })}
					aria-label={m.video_editor_shape_stroke_enabled()}
				/>
				{m.video_editor_shape_stroke_enabled()}
			</label>
		</div>

		{#if item.fillEnabled ?? true}
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_fill_style()}
					<AppSelect
						class="mt-0.5 h-8 w-full text-xs"
						value={item.fillType ?? 'solid'}
						options={[{ value: 'solid', label: m.video_editor_shape_fill_solid() }, { value: 'linear', label: m.video_editor_shape_fill_linear() }]}
						ariaLabel={m.video_editor_shape_fill_style()}
						onValueChange={(value) => commit({ fillType: value as 'solid' | 'linear' })}
					/>
				</label>
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{item.fillType === 'linear'
						? m.video_editor_shape_gradient_start()
						: m.video_editor_shape_fill()}
					<Input
						type="color"
						class="mt-0.5 h-8 w-full rounded bg-transparent"
						value={item.fillType === 'linear'
							? (item.gradientStartColor ?? item.fillColor ?? '#f97316')
							: (item.fillColor ?? '#f97316')}
						onchange={(event) =>
							commit(
								item.fillType === 'linear'
									? { gradientStartColor: event.currentTarget.value }
									: { fillColor: event.currentTarget.value }
							)}
					/>
				</label>
			</div>
			{#if item.fillType === 'linear'}
				<div class="grid grid-cols-2 gap-1">
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_shape_gradient_end()}
						<Input
							type="color"
							class="mt-0.5 h-8 w-full rounded bg-transparent"
							value={item.gradientEndColor ?? '#fb7185'}
							onchange={(event) => commit({ gradientEndColor: event.currentTarget.value })}
						/>
					</label>
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_shape_gradient_angle()}
						<Input
							type="number"
							min="-360"
							max="360"
							step="1"
							class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
							value={item.gradientAngle ?? 0}
							onchange={(event) => numberPatch('gradientAngle', event.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
			{/if}
		{/if}

		{#if item.strokeEnabled}
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_stroke()}
					<Input
						type="color"
						class="mt-0.5 h-8 w-full rounded bg-transparent"
						value={item.strokeColor ?? '#ffffff'}
						onchange={(event) => commit({ strokeColor: event.currentTarget.value })}
					/>
				</label>
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_stroke_width()}
					<Input
						type="number"
						min="0"
						max="500"
						step="1"
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.strokeWidth ?? 8}
						onchange={(event) => numberPatch('strokeWidth', event.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_line_cap()}
					<AppSelect
						class="mt-0.5 h-8 w-full text-xs"
						value={item.strokeLineCap ?? 'butt'}
						options={[{ value: 'butt', label: m.video_editor_shape_line_cap_butt() }, { value: 'round', label: m.video_editor_shape_line_cap_round() }, { value: 'square', label: m.video_editor_shape_line_cap_square() }]}
						ariaLabel={m.video_editor_shape_line_cap()}
						onValueChange={(value) => commit({ strokeLineCap: value as NonNullable<TimelineItem['strokeLineCap']> })}
					/>
				</label>
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_line_join()}
					<AppSelect
						class="mt-0.5 h-8 w-full text-xs"
						value={item.strokeLineJoin ?? 'miter'}
						options={[{ value: 'miter', label: m.video_editor_shape_line_join_miter() }, { value: 'round', label: m.video_editor_shape_line_join_round() }, { value: 'bevel', label: m.video_editor_shape_line_join_bevel() }]}
						ariaLabel={m.video_editor_shape_line_join()}
						onValueChange={(value) => commit({ strokeLineJoin: value as NonNullable<TimelineItem['strokeLineJoin']> })}
					/>
				</label>
			</div>
			{#if (item.strokeLineJoin ?? 'miter') === 'miter'}
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_miter_limit()}
					<Input
						type="number"
						min="1"
						max="100"
						step="0.5"
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.strokeMiterLimit ?? 4}
						onchange={(event) => numberPatch('strokeMiterLimit', event.currentTarget.valueAsNumber)}
					/>
				</label>
			{/if}

			{#if !item.isMask}
				<fieldset class="space-y-1.5 border-t border-white/10 pt-2">
					<legend
						class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
					>
						{m.video_editor_shape_trim_paths()}
					</legend>
					<div class="grid grid-cols-2 gap-1">
						{#each trimPathFields as field (field.property)}
							<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
								{field.label}
								<Input
									type="number"
									min={field.minimum}
									max={field.maximum}
									step="1"
									class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
									value={item[field.property] ?? field.defaultValue}
									onchange={(event) => strokePathPatch(field, event.currentTarget.valueAsNumber)}
								/>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="space-y-1.5 border-t border-white/10 pt-2">
					<legend
						class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase"
					>
						{m.video_editor_shape_taper()}
					</legend>
					<div class="grid grid-cols-2 gap-1">
						{#each taperFields as field (field.property)}
							<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
								{field.label}
								<Input
									type="number"
									min={field.minimum}
									max={field.maximum}
									step="1"
									class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
									value={item[field.property] ?? field.defaultValue}
									onchange={(event) => strokePathPatch(field, event.currentTarget.valueAsNumber)}
								/>
							</label>
						{/each}
					</div>
				</fieldset>
			{/if}
		{/if}

		{#if ['rectangle', 'triangle', 'star', 'polygon'].includes(item.shapeType ?? 'rectangle')}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_corner_radius()}
				<Input
					type="number"
					min="0"
					max="1000"
					step="1"
					class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
					value={item.shapeCornerRadius ?? 0}
					onchange={(event) => numberPatch('shapeCornerRadius', event.currentTarget.valueAsNumber)}
				/>
			</label>
		{/if}

		{#if item.shapeType === 'triangle'}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_shape_direction()}
				<AppSelect
					class="mt-0.5 h-8 w-full text-xs"
					value={item.shapeDirection ?? 'up'}
					options={[{ value: 'up', label: m.video_editor_shape_direction_up() }, { value: 'down', label: m.video_editor_shape_direction_down() }, { value: 'left', label: m.video_editor_shape_direction_left() }, { value: 'right', label: m.video_editor_shape_direction_right() }]}
					ariaLabel={m.video_editor_shape_direction()}
					onValueChange={(value) => commit({ shapeDirection: value as NonNullable<TimelineItem['shapeDirection']> })}
				/>
			</label>
		{/if}

		{#if item.shapeType === 'star' || item.shapeType === 'polygon'}
			<div class="grid grid-cols-2 gap-1">
				<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
					{m.video_editor_shape_points()}
					<Input
						type="number"
						min="3"
						max="64"
						step="1"
						class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
						value={item.shapePoints ?? (item.shapeType === 'star' ? 5 : 6)}
						onchange={(event) => numberPatch('shapePoints', event.currentTarget.valueAsNumber)}
					/>
				</label>
				{#if item.shapeType === 'star'}
					<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
						{m.video_editor_shape_inner_radius()}
						<Input
							type="number"
							min="0.05"
							max="0.95"
							step="0.01"
							class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
							value={item.shapeInnerRadius ?? 0.5}
							onchange={(event) =>
								numberPatch('shapeInnerRadius', event.currentTarget.valueAsNumber)}
						/>
					</label>
				{/if}
			</div>
		{/if}
	{/if}

	<div class="border-t border-[oklch(0.3_0.015_55)] pt-2">
		<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
			<Checkbox
				checked={item.isMask ?? false}
				disabled={pathTopologyLocked && !item.isMask && item.pathClosed === false}
				onCheckedChange={(checked) => setMaskEnabled(checked === true)}
				aria-label={m.video_editor_shape_use_as_mask()}
			/>
			{m.video_editor_shape_use_as_mask()}
		</label>
	</div>

	{#if item.isMask}
		<p class="text-[10px] leading-4 text-[oklch(0.6_0.01_55)]">
			{m.video_editor_shape_mask_scope()}
		</p>
		<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_shape_mask_type()}
			<AppSelect
				class="mt-0.5 h-8 w-full text-xs"
				value={item.maskType ?? 'clip'}
				options={[{ value: 'clip', label: m.video_editor_shape_mask_clip() }, { value: 'alpha', label: m.video_editor_shape_mask_alpha() }]}
				ariaLabel={m.video_editor_shape_mask_type()}
				onValueChange={(value) => setMaskType(value as 'clip' | 'alpha')}
			/>
		</label>

		{#if item.maskType === 'alpha'}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_shape_mask_feather()}
				<Input
					type="number"
					min="0"
					max="100"
					step="1"
					class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
					value={item.maskFeather ?? 10}
					onchange={(event) => numberPatch('maskFeather', event.currentTarget.valueAsNumber)}
				/>
			</label>
		{/if}

		<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_shape_mask_opacity()}
			<Input
				type="number"
				min="0"
				max="100"
				step="1"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.maskOpacity ?? 100}
				onchange={(event) => numberPatch('maskOpacity', event.currentTarget.valueAsNumber)}
			/>
		</label>

		<label class="flex items-center gap-1.5 text-[10px] text-[oklch(0.7_0.01_55)]">
			<Checkbox
				checked={item.maskInvert ?? false}
				onCheckedChange={(checked) => commit({ maskInvert: checked === true })}
				aria-label={m.video_editor_shape_mask_invert()}
			/>
			{m.video_editor_shape_mask_invert()}
		</label>

		{#if item.shapeType === 'path'}
			<p
				class="rounded bg-[oklch(0.18_0.01_50)] px-2 py-1.5 text-[10px] leading-4 text-[oklch(0.72_0.01_55)]"
			>
				{m.video_editor_shape_mask_path_hint()}
			</p>
		{/if}
	{/if}
</section>
