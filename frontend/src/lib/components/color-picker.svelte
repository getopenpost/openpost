<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { hslToHex, hexToRGB, normalizeHex, rgbToHSL, rgbToHex } from '$lib/color';
	import type { HSLColor, RGBColor } from '$lib/color';
	import { m } from '$lib/paraglide/messages';
	import type { OpenPostEyeDropperConstructor } from '$lib/browser-capabilities';
	import { type ColorPickerPreset, useOptionalColorPickerPalette } from './color-picker-context';

	let {
		id,
		label,
		value,
		disabled = false,
		brandColors,
		recentColors = [],
		variant = 'field',
		triggerClass = '',
		live = true,
		onChange,
		onCommit
	}: {
		id?: string;
		label: string;
		value: string;
		disabled?: boolean;
		brandColors?: readonly ColorPickerPreset[];
		recentColors?: readonly string[];
		variant?: 'field' | 'swatch';
		triggerClass?: string;
		live?: boolean;
		onChange: (value: string) => void;
		onCommit?: (value: string) => void;
	} = $props();

	const palette = useOptionalColorPickerPalette();
	const resolvedBrandColors = $derived(brandColors ?? palette?.brandColors ?? []);
	let open = $state(false);
	let mode = $state<'hsl' | 'rgb'>('hsl');
	let hex = $state('#ffffff');
	let hexInput = $state('#FFFFFF');
	let rgb = $state<RGBColor>({ r: 255, g: 255, b: 255 });
	let hsl = $state<HSLColor>({ h: 0, s: 0, l: 100 });
	const supportsEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

	function syncDraft(next: string): void {
		hex = normalizeHex(next, hex);
		hexInput = hex.toUpperCase();
		rgb = hexToRGB(hex);
		hsl = rgbToHSL(rgb);
	}

	function change(next: string, commit = false): void {
		syncDraft(next);
		if (live || commit) onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function changeHSL(key: keyof HSLColor, next: number, commit = false): void {
		if (!Number.isFinite(next)) return;
		const maximum = key === 'h' ? 360 : 100;
		hsl = { ...hsl, [key]: Math.max(0, Math.min(maximum, next)) };
		hex = hslToHex(hsl);
		hexInput = hex.toUpperCase();
		rgb = hexToRGB(hex);
		if (live || commit) onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function changeRGB(key: keyof RGBColor, next: number, commit = false): void {
		if (!Number.isFinite(next)) return;
		rgb = { ...rgb, [key]: Math.max(0, Math.min(255, next)) };
		hex = rgbToHex(rgb);
		hexInput = hex.toUpperCase();
		hsl = rgbToHSL(rgb);
		if (live || commit) onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function commitHex(): void {
		change(normalizeHex(hexInput, hex), true);
	}

	function numericValue(event: Event): number {
		return event.currentTarget instanceof HTMLInputElement
			? Number(event.currentTarget.value)
			: Number.NaN;
	}

	async function pickFromScreen(): Promise<void> {
		const EyeDropperConstructor: OpenPostEyeDropperConstructor | undefined = window.EyeDropper;
		if (!EyeDropperConstructor) return;
		try {
			const result = await new EyeDropperConstructor().open();
			change(result.sRGBHex, true);
		} catch {
			// Closing the eyedropper leaves the current color unchanged.
		}
	}

	function setOpen(next: boolean): void {
		open = next;
		if (next) syncDraft(value);
	}
</script>

<Popover.Root {open} onOpenChange={setOpen}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				{id}
				type="button"
				class={variant === 'field'
					? `flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-background text-left text-xs transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 ${triggerClass}`
					: `relative flex size-8 min-w-8 items-center justify-center overflow-hidden rounded-md border border-input bg-background p-1 transition-colors hover:border-foreground/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:min-w-11 ${triggerClass}`}
				{disabled}
				aria-label={label}
				title={`${label}: ${normalizeHex(value).toUpperCase()}`}
			>
				{#if variant === 'field'}
					<span class="w-10 shrink-0 border-r border-input" style:background={normalizeHex(value)}
					></span>
					<span class="min-w-0 flex-1 self-center truncate px-2 font-mono uppercase"
						>{normalizeHex(value)}</span
					>
				{:else}
					<span
						class="size-full rounded-sm ring-1 ring-foreground/15"
						style:background={normalizeHex(value)}
					></span>
				{/if}
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="end"
		class="max-h-[min(34rem,calc(100dvh-1rem))] w-[min(18rem,calc(100vw-1rem))] space-y-4 overflow-y-auto p-3"
	>
		<div class="flex items-center justify-between gap-2">
			<p class="text-sm font-medium">{label}</p>
			{#if supportsEyeDropper}
				<Button
					variant="ghost"
					size="icon-xs"
					class="[@media(pointer:coarse)]:size-11"
					onclick={pickFromScreen}
					aria-label={m.image_editor_pick_color()}
					title={m.image_editor_pick_color()}
				>
					<ProtectedIcon icon="editor-eyedropper" />
				</Button>
			{/if}
		</div>

		{#if resolvedBrandColors.length > 0}
			<section class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">{m.image_editor_brand_colors()}</p>
				<div class="grid grid-cols-6 gap-1.5">
					{#each resolvedBrandColors as color (color.id)}
						<button
							type="button"
							class="relative aspect-square min-h-9 overflow-hidden rounded-md ring-1 ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:min-h-11"
							style:background={color.value}
							onclick={() => change(color.value, true)}
							aria-label={`${color.name}: ${color.value}`}
							aria-pressed={normalizeHex(color.value) === hex}
							title={color.name}
						>
							{#if normalizeHex(color.value) === hex}
								<span
									class="absolute inset-0 m-auto grid size-5 place-items-center rounded-full bg-background text-foreground shadow-sm"
								>
									<ThemeIcon role="check" class="size-3.5" />
								</span>
							{/if}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if recentColors.length > 0}
			<section class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">{m.image_editor_recent_colors()}</p>
				<div class="grid grid-cols-6 gap-1.5">
					{#each recentColors as color (color)}
						<button
							type="button"
							class="relative aspect-square min-h-9 rounded-md ring-1 ring-foreground/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:min-h-11"
							style:background={color}
							onclick={() => change(color, true)}
							aria-label={color}
							aria-pressed={normalizeHex(color) === hex}
							title={color}
						>
							{#if normalizeHex(color) === hex}
								<span
									class="absolute inset-0 m-auto grid size-5 place-items-center rounded-full bg-background text-foreground shadow-sm"
								>
									<ThemeIcon role="check" class="size-3.5" />
								</span>
							{/if}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<div class="grid grid-cols-[1fr_auto] gap-2">
			<Input
				bind:value={hexInput}
				class="h-9 font-mono uppercase [@media(pointer:coarse)]:min-h-11"
				aria-label={m.image_editor_hex_color()}
				onchange={commitHex}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						commitHex();
						event.currentTarget.select();
					}
				}}
			/>
			<div class="flex rounded-md bg-muted p-0.5">
				{#each ['hsl', 'rgb'] as colorMode (colorMode)}
					<button
						type="button"
						class="h-8 rounded px-2 text-xs font-medium uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:h-11 {mode ===
						colorMode
							? 'bg-background shadow-sm'
							: 'text-muted-foreground'}"
						aria-pressed={mode === colorMode}
						onclick={() => (mode = colorMode as 'hsl' | 'rgb')}
					>
						{colorMode}
					</button>
				{/each}
			</div>
		</div>

		{#if mode === 'hsl'}
			<div class="space-y-2">
				{#each [[m.image_editor_hue(), 'h', 360], [m.image_editor_saturation(), 's', 100], [m.image_editor_lightness(), 'l', 100]] as [channelLabel, key, max] (key)}
					<div class="grid grid-cols-[1rem_1fr_3rem] items-center gap-2 text-xs">
						<span class="font-medium uppercase">{key}</span>
						<Slider
							value={Math.round(hsl[key as keyof HSLColor])}
							min={0}
							max={max as number}
							step={1}
							ariaLabel={channelLabel as string}
							trackClass={key === 'h'
								? '[background:linear-gradient(90deg,#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)]'
								: ''}
							rangeClass={key === 'h' ? 'bg-transparent' : ''}
							onValueChange={(next) => changeHSL(key as keyof HSLColor, next)}
							onValueCommit={(next) => changeHSL(key as keyof HSLColor, next, true)}
						/>
						<Input
							type="text"
							inputmode="numeric"
							value={Math.round(hsl[key as keyof HSLColor])}
							class="h-8 px-1.5 text-right text-xs [@media(pointer:coarse)]:h-11"
							aria-label={channelLabel as string}
							onchange={(event) => changeHSL(key as keyof HSLColor, numericValue(event), true)}
						/>
					</div>
				{/each}
			</div>
		{:else}
			<div class="space-y-2">
				{#each [['R', 'r'], ['G', 'g'], ['B', 'b']] as [channelLabel, key] (key)}
					<div class="grid grid-cols-[1rem_1fr_3rem] items-center gap-2 text-xs">
						<span class="font-medium">{channelLabel}</span>
						<Slider
							value={rgb[key as keyof RGBColor]}
							min={0}
							max={255}
							step={1}
							ariaLabel={channelLabel}
							onValueChange={(next) => changeRGB(key as keyof RGBColor, next)}
							onValueCommit={(next) => changeRGB(key as keyof RGBColor, next, true)}
						/>
						<Input
							type="text"
							inputmode="numeric"
							value={Math.round(rgb[key as keyof RGBColor])}
							class="h-8 px-1.5 text-right text-xs [@media(pointer:coarse)]:h-11"
							aria-label={channelLabel}
							onchange={(event) => changeRGB(key as keyof RGBColor, numericValue(event), true)}
						/>
					</div>
				{/each}
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
