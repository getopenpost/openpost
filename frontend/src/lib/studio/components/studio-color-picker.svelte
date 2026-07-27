<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import PipetteIcon from 'lucide-svelte/icons/pipette';
	import CheckIcon from 'lucide-svelte/icons/check';
	import { hslToHex, hexToRGB, normalizeHex, rgbToHSL, rgbToHex } from '../color';
	import type { StudioHSL, StudioRGB } from '../color';
	import type { StudioBrandColor } from '../types';
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
		brandColors?: StudioBrandColor[];
		recentColors?: string[];
		onChange: (value: string) => void;
		onCommit?: (value: string) => void;
	} = $props();

	let open = $state(false);
	let mode = $state<'hsl' | 'rgb'>('hsl');
	let hex = $state('#000000');
	let rgb = $state<StudioRGB>({ r: 0, g: 0, b: 0 });
	let hsl = $state<StudioHSL>({ h: 0, s: 0, l: 0 });

	function syncDraft(next: string): void {
		hex = normalizeHex(next, '#000000');
		rgb = hexToRGB(hex);
		hsl = rgbToHSL(rgb);
	}

	function change(next: string, commit = false): void {
		syncDraft(next);
		onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function changeHSL(key: keyof StudioHSL, next: number, commit = false): void {
		hsl = { ...hsl, [key]: next };
		hex = hslToHex(hsl);
		rgb = hexToRGB(hex);
		onChange(hex);
		if (commit) onCommit?.(hex);
	}

	function changeRGB(key: keyof StudioRGB, next: number, commit = false): void {
		rgb = { ...rgb, [key]: next };
		hex = rgbToHex(rgb);
		hsl = rgbToHSL(rgb);
		onChange(hex);
		if (commit) onCommit?.(hex);
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
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={pickFromScreen}
				aria-label={m.studio_pick_color()}
				title={m.studio_pick_color()}
			>
				<PipetteIcon />
			</Button>
		</div>

		{#if brandColors.length > 0}
			<section class="space-y-1.5">
				<p class="text-xs font-medium text-muted-foreground">{m.studio_brand_colors()}</p>
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
				<p class="text-xs font-medium text-muted-foreground">{m.studio_recent_colors()}</p>
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
				value={hex}
				class="h-9 font-mono uppercase"
				aria-label={m.studio_hex_color()}
				onchange={(event) => change(event.currentTarget.value, true)}
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
				{#each [[m.studio_hue(), 'h', 360], [m.studio_saturation(), 's', 100], [m.studio_lightness(), 'l', 100]] as [channelLabel, key, max] (key)}
					<label class="grid grid-cols-[1rem_1fr_3rem] items-center gap-2 text-xs">
						<span class="font-medium uppercase">{key}</span>
						<Slider
							value={Math.round(hsl[key as keyof StudioHSL])}
							min={0}
							max={max as number}
							step={1}
							ariaLabel={channelLabel as string}
							trackClass={key === 'h'
								? '[background:linear-gradient(90deg,#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)]'
								: ''}
							onValueChange={(next) => changeHSL(key as keyof StudioHSL, next)}
							onValueCommit={(next) => changeHSL(key as keyof StudioHSL, next, true)}
						/>
						<Input
							type="number"
							min="0"
							{max}
							value={Math.round(hsl[key as keyof StudioHSL])}
							class="h-8 px-1.5 text-right text-xs"
							onchange={(event) =>
								changeHSL(key as keyof StudioHSL, Number(event.currentTarget.value), true)}
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
							value={rgb[key as keyof StudioRGB]}
							min={0}
							max={255}
							step={1}
							ariaLabel={channelLabel}
							onValueChange={(next) => changeRGB(key as keyof StudioRGB, next)}
							onValueCommit={(next) => changeRGB(key as keyof StudioRGB, next, true)}
						/>
						<Input
							type="number"
							min="0"
							max="255"
							value={Math.round(rgb[key as keyof StudioRGB])}
							class="h-8 px-1.5 text-right text-xs"
							onchange={(event) =>
								changeRGB(key as keyof StudioRGB, Number(event.currentTarget.value), true)}
						/>
					</label>
				{/each}
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>
