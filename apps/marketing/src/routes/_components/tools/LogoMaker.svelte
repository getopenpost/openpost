<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Check, Clipboard, Download, Rocket, Search } from '@lucide/svelte';
	import { logoIcons, searchLogoIcons, LOGO_ICON_BATCH_SIZE } from './logo-icons';
	import { browser } from '$app/environment';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AppSelect from '$lib/components/app-select.svelte';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import {
		exportSizes,
		logoPresets,
		serializeLogoSvg,
		type ExportSize,
		type LogoDesign
	} from './logo-maker-core';

	type ExportState = 'idle' | 'working' | 'done' | 'failed';
	const sizeOptions = exportSizes.map((size) => ({
		value: String(size),
		label: `${size} × ${size} px`
	}));
	const brandColors = [
		{ id: 'orange', name: 'Orange', value: '#F97316' },
		{ id: 'violet', name: 'Violet', value: '#7C3AED' },
		{ id: 'green', name: 'Green', value: '#16A34A' },
		{ id: 'blue', name: 'Blue', value: '#2563EB' },
		{ id: 'ink', name: 'Ink', value: '#18181B' },
		{ id: 'white', name: 'White', value: '#FFFFFF' }
	] as const;
	const backgroundKinds = [
		'solid',
		'gradient',
		'transparent'
	] satisfies LogoDesign['background']['kind'][];

	let design = $state<LogoDesign>(cloneDesign(logoPresets[0].design));
	let exportSize = $state<ExportSize>(1024);
	let iconSearch = $state('');
	let exportState = $state<ExportState>('idle');
	let statusMessage = $state('');
	let previewElement = $state<SVGSVGElement>();
	let generation = 0;
	const activeUrls = new Set<string>();
	const matchingIcons = $derived(searchLogoIcons(iconSearch));
	let visibleCount = $state(LOGO_ICON_BATCH_SIZE);
	let iconList = $state<HTMLDivElement>();
	let SelectedIcon = $state.raw<typeof Rocket>(Rocket);
	let loadedIcon = $state('rocket');
	let iconError = $state('');
	let retryIcon = $state(0);
	const iconReady = $derived(loadedIcon === design.icon);
	$effect(() => {
		const matches = matchingIcons;
		visibleCount = Math.min(LOGO_ICON_BATCH_SIZE, matches.length);
		if (iconList) iconList.scrollTop = 0;
	});
	$effect(() => {
		const name = design.icon;
		const attempt = retryIcon;
		let current = true;
		iconError = '';
		const icon = logoIcons.find((item) => item.value === name);
		if (icon)
			void icon
				.load()
				.then((module) => {
					if (!current) return;
					SelectedIcon = module.default;
					loadedIcon = name;
				})
				.catch(() => {
					if (current) iconError = `Could not load this icon. Try again. (${attempt + 1})`;
				});
		return () => {
			current = false;
		};
	});
	const iconDimension = $derived(((100 - design.padding * 2) * design.iconSize) / 100);
	const iconOffset = $derived((100 - iconDimension) / 2);
	const gradient = $derived.by(() => {
		const radians =
			((design.background.kind === 'gradient' ? design.background.angle - 90 : 0) * Math.PI) / 180;
		return { x: Math.cos(radians) * 50, y: Math.sin(radians) * 50 };
	});
	const canCopyPng = $derived(
		browser &&
			'clipboard' in navigator &&
			'write' in navigator.clipboard &&
			'ClipboardItem' in globalThis
	);

	function cloneDesign(source: LogoDesign): LogoDesign {
		return { ...source, background: { ...source.background } };
	}
	function markChanged(): void {
		generation += 1;
		exportState = 'idle';
		statusMessage = '';
	}
	function applyPreset(source: LogoDesign): void {
		design = cloneDesign(source);
		markChanged();
	}
	function setBackground(kind: LogoDesign['background']['kind']): void {
		if (kind === 'solid') design.background = { kind, color: '#FDE68A' };
		if (kind === 'gradient')
			design.background = { kind, from: '#F97316', to: '#7C3AED', angle: 135 };
		if (kind === 'transparent') design.background = { kind };
		markChanged();
	}
	function setBackgroundColor(key: 'color' | 'from' | 'to', value: string): void {
		if (design.background.kind === 'solid' && key === 'color')
			design.background = { ...design.background, color: value };
		if (design.background.kind === 'gradient' && key !== 'color')
			design.background = { ...design.background, [key]: value };
		markChanged();
	}
	function currentSvg(): string {
		if (!iconReady) throw new Error('Wait for the selected icon to load.');
		if (!previewElement) throw new Error('Logo preview is unavailable.');
		return serializeLogoSvg(previewElement, exportSize);
	}
	function downloadBlob(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		activeUrls.add(url);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		window.setTimeout(() => {
			URL.revokeObjectURL(url);
			activeUrls.delete(url);
		}, 30_000);
	}
	function downloadSvg(): void {
		try {
			downloadBlob(
				new Blob([currentSvg()], { type: 'image/svg+xml;charset=utf-8' }),
				`logo-${exportSize}.svg`
			);
			exportState = 'done';
			statusMessage = 'SVG downloaded.';
		} catch {
			exportState = 'failed';
			statusMessage = 'The SVG could not be created.';
		}
	}
	async function renderPng(svg: string, size: ExportSize): Promise<Blob> {
		const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
		activeUrls.add(sourceUrl);
		try {
			const image = new Image();
			image.decoding = 'async';
			image.src = sourceUrl;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = size;
			canvas.height = size;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Canvas is unavailable.');
			context.drawImage(image, 0, 0, size, size);
			return await new Promise((resolve, reject) =>
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
					'image/png'
				)
			);
		} finally {
			URL.revokeObjectURL(sourceUrl);
			activeUrls.delete(sourceUrl);
		}
	}
	async function exportPng(mode: 'download' | 'copy'): Promise<void> {
		const requestedGeneration = generation;
		const requestedSize = exportSize;
		let svg: string;
		try {
			svg = currentSvg();
		} catch {
			exportState = 'failed';
			statusMessage = 'The PNG could not be created.';
			return;
		}
		exportState = 'working';
		statusMessage = mode === 'copy' ? 'Preparing PNG to copy…' : 'Preparing PNG…';
		try {
			const blob = await renderPng(svg, requestedSize);
			if (requestedGeneration !== generation || requestedSize !== exportSize) return;
			if (mode === 'copy')
				await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			else downloadBlob(blob, `logo-${requestedSize}.png`);
			if (requestedGeneration !== generation || requestedSize !== exportSize) return;
			exportState = 'done';
			statusMessage = mode === 'copy' ? 'PNG copied.' : 'PNG downloaded.';
		} catch {
			if (requestedGeneration !== generation) return;
			exportState = 'failed';
			statusMessage =
				mode === 'copy' ? 'This browser could not copy the PNG.' : 'The PNG could not be created.';
		}
	}
	onDestroy(() => {
		generation += 1;
		for (const url of activeUrls) URL.revokeObjectURL(url);
		activeUrls.clear();
	});
</script>

<div class="maker mt-8">
	<div class="workspace grid gap-4">
		<section
			class="preview min-w-0 rounded-lg border bg-card p-4"
			aria-labelledby="logo-preview-heading"
		>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 id="logo-preview-heading" class="text-lg font-semibold">Your logo</h2>
					<p class="mt-1 text-sm text-muted-foreground">Export a matching PNG or scalable SVG.</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<AppSelect
						value={String(exportSize)}
						options={sizeOptions}
						ariaLabel="Export size"
						class="w-36"
						onValueChange={(value) => {
							const nextSize = exportSizes.find((size) => size === Number(value));
							if (!nextSize) return;
							exportSize = nextSize;
							markChanged();
						}}
					/><Button type="button" variant="outline" onclick={downloadSvg} disabled={!iconReady}
						><Download data-icon="inline-start" />SVG</Button
					><Button
						type="button"
						onclick={() => exportPng('download')}
						disabled={exportState === 'working' || !iconReady}
						><Download data-icon="inline-start" />PNG</Button
					>{#if canCopyPng}<Button
							type="button"
							variant="outline"
							onclick={() => exportPng('copy')}
							disabled={exportState === 'working' || !iconReady}
							>{#if exportState === 'done' && statusMessage === 'PNG copied.'}<Check
									data-icon="inline-start"
								/>{:else}<Clipboard data-icon="inline-start" />{/if}Copy PNG</Button
						>{/if}
				</div>
			</div>
			<div
				class="checker mt-4 grid min-h-72 place-items-center overflow-hidden rounded-xl border p-4"
			>
				<svg
					bind:this={previewElement}
					class="h-auto w-full max-w-md drop-shadow-sm"
					viewBox="0 0 100 100"
					aria-label="Logo preview"
				>
					<defs
						>{#if design.background.kind === 'gradient'}<linearGradient
								id="logo-background"
								x1={`${50 - gradient.x}%`}
								y1={`${50 - gradient.y}%`}
								x2={`${50 + gradient.x}%`}
								y2={`${50 + gradient.y}%`}
								><stop
									stop-color={design.background.from}
									stop-opacity={(design.background.fromOpacity ?? 100) / 100}
								/><stop
									offset="1"
									stop-color={design.background.to}
									stop-opacity={(design.background.toOpacity ?? 100) / 100}
								/></linearGradient
							>{/if}{#if design.shadow}<filter
								id="logo-shadow"
								x="-30%"
								y="-30%"
								width="160%"
								height="160%"
								><feDropShadow
									dx="0"
									dy="2.5"
									stdDeviation="3"
									flood-color="#000000"
									flood-opacity="0.28"
								/></filter
							>{/if}</defs
					>
					{#if design.background.kind !== 'transparent'}<rect
							width="100"
							height="100"
							rx={design.cornerRadius}
							fill-opacity={design.background.kind === 'solid'
								? (design.background.opacity ?? 100) / 100
								: 1}
							fill={design.background.kind === 'solid'
								? design.background.color
								: 'url(#logo-background)'}
						/>{/if}
					<SelectedIcon
						x={iconOffset}
						y={iconOffset}
						size={iconDimension}
						color={design.iconColor}
						stroke-opacity={(design.iconOpacity ?? 100) / 100}
						fill-opacity={(design.fillOpacity ?? 100) / 100}
						fill={design.fillColor}
						strokeWidth={design.strokeWidth}
						transform={`rotate(${design.rotation} 50 50)`}
						filter={design.shadow ? 'url(#logo-shadow)' : undefined}
						aria-hidden="true"
					/>
				</svg>
			</div>
			<p
				class:!text-destructive={exportState === 'failed'}
				class="mt-2 min-h-5 text-sm text-muted-foreground"
				aria-live="polite"
			>
				{statusMessage}
			</p>
		</section>

		<section class="controls rounded-lg border bg-card p-4" aria-labelledby="logo-controls-heading">
			<h2 id="logo-controls-heading" class="text-lg font-semibold">Customize</h2>
			<div class="mt-4 grid gap-5">
				<fieldset>
					<legend class="text-sm font-medium">Preset</legend>
					<div class="mt-2 grid grid-cols-3 gap-2">
						{#each logoPresets as preset (preset.name)}<Button
								type="button"
								variant="outline"
								class="min-w-0 px-2"
								onclick={() => applyPreset(preset.design)}>{preset.name}</Button
							>{/each}
					</div>
				</fieldset>
				<fieldset>
					<legend class="text-sm font-medium">Icon</legend><label class="relative mt-2 block"
						><span class="sr-only">Search icons</span><Search
							class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/><Input
							bind:value={iconSearch}
							placeholder={`Search ${logoIcons.length.toLocaleString()} Lucide icons`}
							class="h-11 pl-9"
						/></label
					>
					<div
						bind:this={iconList}
						aria-label="Icon collection"
						class="mt-2 grid max-h-44 grid-cols-5 gap-2 overflow-y-auto pr-1"
						onscroll={(event) => {
							const node = event.currentTarget;
							if (node.scrollHeight - node.scrollTop - node.clientHeight < 100)
								visibleCount = Math.min(matchingIcons.length, visibleCount + LOGO_ICON_BATCH_SIZE);
						}}
					>
						{#each matchingIcons.slice(0, visibleCount) as icon (icon.value)}<button
								type="button"
								class="focus-ring grid min-h-11 place-items-center rounded-md border bg-background hover:bg-muted"
								class:border-primary={design.icon === icon.value}
								class:text-primary={design.icon === icon.value}
								aria-label={icon.label}
								aria-pressed={design.icon === icon.value}
								title={icon.label}
								onclick={() => {
									design.icon = icon.value;
									markChanged();
								}}
								>{#await icon.load()}<Skeleton
										class="size-5"
										aria-hidden="true"
									/>{:then module}{@const Icon = module.default}<Icon
										class="size-5"
										aria-hidden="true"
									/>{:catch}<span class="text-xs">Failed</span>{/await}</button
							>{:else}<p class="col-span-5 py-3 text-sm text-muted-foreground">
								No icons match.
							</p>{/each}
					</div>
					<p class="mt-2 text-xs text-muted-foreground" aria-live="polite">
						{matchingIcons.length.toLocaleString()} icons{#if visibleCount < matchingIcons.length}
							· Scroll for more{/if}
					</p>
					{#if visibleCount < matchingIcons.length}<Button
							type="button"
							variant="ghost"
							class="mt-1 w-full"
							onclick={() =>
								(visibleCount = Math.min(
									matchingIcons.length,
									visibleCount + LOGO_ICON_BATCH_SIZE
								))}>Load more icons</Button
						>{/if}
					{#if iconError}<p role="alert" class="text-sm text-destructive">{iconError}</p>
						<Button type="button" variant="outline" onclick={() => retryIcon++}>Retry icon</Button
						>{:else if !iconReady}<p role="status" class="text-sm text-muted-foreground">
							Loading selected icon…
						</p>{/if}
				</fieldset>
				<div class="grid grid-cols-2 gap-3">
					<ColorPicker
						label="Icon color"
						value={design.iconColor}
						opacity={design.iconOpacity ?? 100}
						onOpacityChange={(value) => {
							design.iconOpacity = value;
							markChanged();
						}}
						{brandColors}
						onChange={(value) => {
							design.iconColor = value;
							markChanged();
						}}
					/><ColorPicker
						label="Icon fill"
						value={design.fillColor === 'none' ? '#FFFFFF' : design.fillColor}
						opacity={design.fillOpacity ?? 100}
						onOpacityChange={(value) => {
							design.fillOpacity = value;
							markChanged();
						}}
						swatchColor={design.fillColor === 'none' ? 'transparent' : design.fillColor}
						{brandColors}
						onChange={(value) => {
							design.fillColor = value;
							markChanged();
						}}
					/>
				</div>
				<label class="flex min-h-11 items-center gap-3 text-sm"
					><Checkbox
						checked={design.fillColor === 'none'}
						onCheckedChange={(checked) => {
							design.fillColor = checked ? 'none' : design.iconColor;
							markChanged();
						}}
					/>Outline only</label
				>
				<div class="grid gap-3">
					<label class="grid gap-1 text-sm font-medium"
						>Icon size <span class="font-normal text-muted-foreground">{design.iconSize}%</span
						><Slider
							bind:value={design.iconSize}
							min={20}
							max={90}
							ariaLabel="Icon size"
							onValueChange={markChanged}
						/></label
					><label class="grid gap-1 text-sm font-medium"
						>Rotation <span class="font-normal text-muted-foreground">{design.rotation}°</span
						><Slider
							bind:value={design.rotation}
							min={-180}
							max={180}
							ariaLabel="Icon rotation"
							onValueChange={markChanged}
						/></label
					><label class="grid gap-1 text-sm font-medium"
						>Stroke <span class="font-normal text-muted-foreground">{design.strokeWidth}</span
						><Slider
							bind:value={design.strokeWidth}
							min={0.5}
							max={4}
							step={0.1}
							ariaLabel="Stroke width"
							onValueChange={markChanged}
						/></label
					>
				</div>
				<fieldset>
					<legend class="text-sm font-medium">Background</legend>
					<div class="mt-2 grid grid-cols-3 gap-2">
						{#each backgroundKinds as kind}<Button
								type="button"
								variant={design.background.kind === kind ? 'default' : 'outline'}
								class="min-w-0 px-2 capitalize"
								aria-pressed={design.background.kind === kind}
								onclick={() => setBackground(kind)}>{kind}</Button
							>{/each}
					</div>
					{#if design.background.kind === 'solid'}<div class="mt-3">
							<ColorPicker
								label="Background color"
								value={design.background.color}
								opacity={design.background.opacity ?? 100}
								onOpacityChange={(value) => {
									if (design.background.kind === 'solid') design.background.opacity = value;
									markChanged();
								}}
								{brandColors}
								onChange={(value) => setBackgroundColor('color', value)}
							/>
						</div>{/if}{#if design.background.kind === 'gradient'}<div
							class="mt-3 grid grid-cols-2 gap-3"
						>
							<ColorPicker
								label="Gradient start"
								value={design.background.from}
								opacity={design.background.fromOpacity ?? 100}
								onOpacityChange={(value) => {
									if (design.background.kind === 'gradient') design.background.fromOpacity = value;
									markChanged();
								}}
								{brandColors}
								onChange={(value) => setBackgroundColor('from', value)}
							/><ColorPicker
								label="Gradient end"
								value={design.background.to}
								opacity={design.background.toOpacity ?? 100}
								onOpacityChange={(value) => {
									if (design.background.kind === 'gradient') design.background.toOpacity = value;
									markChanged();
								}}
								{brandColors}
								onChange={(value) => setBackgroundColor('to', value)}
							/>
						</div>
						<label class="mt-3 grid gap-1 text-sm font-medium"
							>Gradient angle <span class="font-normal text-muted-foreground"
								>{design.background.angle}°</span
							><Slider
								bind:value={design.background.angle}
								min={0}
								max={360}
								ariaLabel="Gradient angle"
								onValueChange={markChanged}
							/></label
						>{/if}
				</fieldset>
				<div class="grid gap-3">
					<label class="grid gap-1 text-sm font-medium"
						>Corner radius <span class="font-normal text-muted-foreground"
							>{design.cornerRadius}%</span
						><Slider
							bind:value={design.cornerRadius}
							min={0}
							max={50}
							ariaLabel="Corner radius"
							onValueChange={markChanged}
						/></label
					><label class="grid gap-1 text-sm font-medium"
						>Padding <span class="font-normal text-muted-foreground">{design.padding}%</span><Slider
							bind:value={design.padding}
							min={0}
							max={40}
							ariaLabel="Padding"
							onValueChange={markChanged}
						/></label
					><label class="flex min-h-11 items-center gap-3 text-sm font-medium"
						><Checkbox bind:checked={design.shadow} onCheckedChange={markChanged} />Icon shadow</label
					>
				</div>
			</div>
		</section>
	</div>
</div>

<style>
	.maker {
		container-type: inline-size;
	}
	.checker {
		background-color: var(--muted);
		background-image:
			linear-gradient(
				45deg,
				color-mix(in oklab, var(--foreground) 8%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				-45deg,
				color-mix(in oklab, var(--foreground) 8%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				45deg,
				transparent 75%,
				color-mix(in oklab, var(--foreground) 8%, transparent) 75%
			),
			linear-gradient(
				-45deg,
				transparent 75%,
				color-mix(in oklab, var(--foreground) 8%, transparent) 75%
			);
		background-size: 20px 20px;
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
	}
	@container (min-width: 700px) {
		.workspace {
			grid-template-columns: minmax(0, 1fr) 17rem;
			align-items: start;
		}
		.preview {
			position: sticky;
			top: 1rem;
		}
		.checker {
			min-height: 30rem;
		}
		.controls {
			max-height: 44rem;
			overflow-y: auto;
		}
	}
</style>
