<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import PipetteIcon from '@lucide/svelte/icons/pipette';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { hslToHex, hexToRGB, normalizeHex, rgbToHSL, rgbToHex } from '../color';
	import type { ImageEditorHSL, ImageEditorRGB } from '../color';
	import type { ImageEditorBrandColor } from '../types';
	import { m } from '$lib/paraglide/messages';

	let {
		id,
		label,
		value,
		disabled = false,
		brandColors = [],
		recentColors = [],
		onChange,
		onCommit
	}: {
		id?: string;
		label: string;
		value: string;
		disabled?: boolean;
		brandColors?: ImageEditorBrandColor[];
		recentColors?: string[];
		onChange: (value: string) => void;
		onCommit?: (value: string) => void;
	} = $props();

	let open = $state(false);
	let mode = $state<'hsl' | 'rgb'>('hsl');
	let hex = $state('#ffffff');
	let hexInput = $state('#FFFFFF');
	let rgb = $state<ImageEditorRGB>({ r: 255, g: 255, b: 255 });
	let hsl = $state<ImageEditorHSL>({ h: 0, s: 0, l: 100 });
	const supportsEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

	function syncDraft(next: string): void {
		hex = normalizeHex(next, hex);
		hexInput = hex.toUpperCase();
		rgb = hexToRGB(hex);
		hsl = rgbToHSL(rgb);
	}

	function change(next: string, commit = false): void {
		syncDraft(next);
		onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function changeHSL(key: keyof ImageEditorHSL, next: number, commit = false): void {
		if (!Number.isFinite(next)) return;
		const maximum = key === 'h' ? 360 : 100;
		hsl = { ...hsl, [key]: Math.max(0, Math.min(maximum, next)) };
		hex = hslToHex(hsl);
		hexInput = hex.toUpperCase();
		rgb = hexToRGB(hex);
		onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function changeRGB(key: keyof ImageEditorRGB, next: number, commit = false): void {
		if (!Number.isFinite(next)) return;
		rgb = { ...rgb, [key]: Math.max(0, Math.min(255, next)) };
		hex = rgbToHex(rgb);
		hexInput = hex.toUpperCase();
		hsl = rgbToHSL(rgb);
		onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function commitHex(): void {
		const normalized = normalizeHex(hexInput, hex);
		change(normalized, true);
	}

	function numericValue(event: Event): number {
		return Number((event.currentTarget as HTMLInputElement).value);
	}

	async function pickFromScreen(): Promise<void> {
		const EyeDropperConstructor = (
			window as typeof window & {
				EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
			}
		).EyeDropper;
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
				class="flex h-9 w-full min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-background text-left text-xs transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
				{disabled}
				aria-label={label}
			>
				<span class="w-10 shrink-0 border-r" style:background={normalizeHex(value)}></span>
				<span class="min-w-0 flex-1 self-center truncate px-2 font-mono uppercase"
					>{normalizeHex(value)}</span
				>
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-72 space-y-4 p-3">
		<div class="flex items-center justify-between gap-2">
			<p class="text-sm font-medium">{label}</p>
			{#if supportsEyeDropper}
				<Button
					variant="ghost"
					size="icon-xs"
					onclick={pickFromScreen}
					aria-label={m.image_editor_pick_color()}
					title={m.image_editor_pick_color()}
				>
					<PipetteIcon />
				</Button>
			{/if}
		</div>

		{#if brandColors.length > 0}
			<section class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">{m.image_editor_brand_colors()}</p>
				<div class="grid grid-cols-8 gap-1">
					{#each brandColors as color (color.id)}
						<button
							type="button"
							class="relative aspect-square overflow-hidden rounded-sm ring-1 ring-black/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							style:background={color.value}
							onclick={() => change(color.value, true)}
							aria-label={`${color.name}: ${color.value}`}
							title={color.name}
						>
							{#if normalizeHex(color.value) === hex}
								<CheckIcon class="absolute inset-0 m-auto size-3.5 text-white drop-shadow" />
							{/if}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		{#if recentColors.length > 0}
			<section class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">{m.image_editor_recent_colors()}</p>
				<div class="grid grid-cols-8 gap-1">
					{#each recentColors as color (color)}
						<button
							type="button"
							class="aspect-square rounded-sm ring-1 ring-black/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
							style:background={color}
							onclick={() => change(color, true)}
							aria-label={color}
							title={color}
						></button>
					{/each}
				</div>
			</section>
		{/if}

		<div class="grid grid-cols-[1fr_auto] gap-2">
			<Input
				bind:value={hexInput}
				class="h-9 font-mono uppercase"
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
						class="h-8 rounded px-2 text-xs font-medium uppercase {mode === colorMode
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
					<label class="grid grid-cols-[1rem_1fr_3rem] items-center gap-2 text-xs">
						<span class="font-medium uppercase">{key}</span>
						<Slider
							value={Math.round(hsl[key as keyof ImageEditorHSL])}
							min={0}
							max={max as number}
							step={1}
							ariaLabel={channelLabel as string}
							trackClass={key === 'h'
								? '[background:linear-gradient(90deg,#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)]'
								: ''}
							rangeClass={key === 'h' ? 'bg-transparent' : ''}
							onValueChange={(next) => changeHSL(key as keyof ImageEditorHSL, next)}
							onValueCommit={(next) => changeHSL(key as keyof ImageEditorHSL, next, true)}
						/>
						<Input
							type="text"
							inputmode="numeric"
							value={Math.round(hsl[key as keyof ImageEditorHSL])}
							class="h-8 px-1.5 text-right text-xs"
							onchange={(event) =>
								changeHSL(key as keyof ImageEditorHSL, numericValue(event), true)}
						/>
					</label>
				{/each}
			</div>
		{:else}
			<div class="space-y-2">
				{#each [['R', 'r'], ['G', 'g'], ['B', 'b']] as [channelLabel, key] (key)}
					<label class="grid grid-cols-[1rem_1fr_3rem] items-center gap-2 text-xs">
						<span class="font-medium">{channelLabel}</span>
						<Slider
							value={rgb[key as keyof ImageEditorRGB]}
							min={0}
							max={255}
							step={1}
							ariaLabel={channelLabel}
							onValueChange={(next) => changeRGB(key as keyof ImageEditorRGB, next)}
							onValueCommit={(next) => changeRGB(key as keyof ImageEditorRGB, next, true)}
						/>
						<Input
							type="text"
							inputmode="numeric"
							value={Math.round(rgb[key as keyof ImageEditorRGB])}
							class="h-8 px-1.5 text-right text-xs"
							onchange={(event) =>
								changeRGB(key as keyof ImageEditorRGB, numericValue(event), true)}
						/>
					</label>
				{/each}
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
