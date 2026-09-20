<script lang="ts">
	import { Clipboard, Pipette, RotateCcw } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { OpenPostEyeDropperConstructor } from '$lib/browser-capabilities';
	import { rgbToHSL } from '$lib/color';
	import LocalImageDropZone from './LocalImageDropZone.svelte';
	import {
		canvasFromBitmap,
		decodeLocalImage,
		extractPalette,
		localImageMessage,
		mapRenderedPoint,
		ObjectURLSlot,
		rgbaToHex,
		sampleCanvasPixel,
		type RGBAColor
	} from './local-image';

	let bitmap = $state<ImageBitmap | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let preview = $state('');
	let width = $state(0);
	let height = $state(0);
	let x = $state(0);
	let y = $state(0);
	let selected = $state<RGBAColor>({ r: 0, g: 0, b: 0, a: 1 });
	let palette = $state<RGBAColor[]>([]);
	let busy = $state(false);
	let error = $state('');
	let status = $state('');
	let imageElement = $state<HTMLImageElement>();
	let loadVersion = 0;
	const previewURL = new ObjectURLSlot();
	const supportsEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

	const hex = $derived(rgbaToHex(selected));
	const rgb = $derived(
		`rgb${selected.a < 1 ? 'a' : ''}(${selected.r}, ${selected.g}, ${selected.b}${selected.a < 1 ? `, ${selected.a.toFixed(2)}` : ''})`
	);
	const hsl = $derived.by(() => {
		const value = rgbToHSL(selected);
		return `hsl${selected.a < 1 ? 'a' : ''}(${Math.round(value.h)}, ${Math.round(value.s)}%, ${Math.round(value.l)}%${selected.a < 1 ? `, ${selected.a.toFixed(2)}` : ''})`;
	});

	function choose(color: RGBAColor, nextX = x, nextY = y): void {
		selected = color;
		x = nextX;
		y = nextY;
		error = '';
		status = `${hex}, pixel ${x + 1} by ${y + 1}.`;
	}

	function sample(nextX: number, nextY: number): void {
		const context = canvas?.getContext('2d', { willReadFrequently: true });
		if (!context) return;
		choose(
			sampleCanvasPixel(context, nextX, nextY),
			Math.max(0, Math.min(width - 1, Math.round(nextX))),
			Math.max(0, Math.min(height - 1, Math.round(nextY)))
		);
	}

	function sampleField(axis: 'x' | 'y', event: Event): void {
		if (!(event.currentTarget instanceof HTMLInputElement)) return;
		const value = Number(event.currentTarget.value) - 1;
		if (!Number.isFinite(value)) return;
		sample(axis === 'x' ? value : x, axis === 'y' ? value : y);
	}

	async function load(file: File): Promise<void> {
		const version = ++loadVersion;
		let next: ImageBitmap | null = null;
		busy = true;
		error = '';
		try {
			const decoded = await decodeLocalImage(file);
			next = decoded;
			if (version !== loadVersion) {
				decoded.close();
				next = null;
				return;
			}
			const nextCanvas = canvasFromBitmap(decoded, decoded.width, decoded.height);
			const nextPalette = extractPalette(
				nextCanvas.getContext('2d', { willReadFrequently: true })!
			);
			if (version !== loadVersion) {
				decoded.close();
				next = null;
				return;
			}
			const nextPreview = previewURL.set(file).url;
			bitmap?.close();
			bitmap = decoded;
			width = decoded.width;
			height = decoded.height;
			canvas = nextCanvas;
			palette = nextPalette;
			preview = nextPreview;
			next = null;
			sample(Math.floor(width / 2), Math.floor(height / 2));
		} catch (reason) {
			next?.close();
			if (version === loadVersion) error = localImageMessage(reason);
		} finally {
			if (version === loadVersion) busy = false;
		}
	}

	function reset(): void {
		loadVersion++;
		bitmap?.close();
		bitmap = null;
		canvas = null;
		previewURL.clear();
		preview = '';
		error = '';
		status = '';
	}

	async function copy(value: string, label: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			status = `${label} copied.`;
			error = '';
		} catch {
			error = 'The browser blocked clipboard access. Select and copy the value instead.';
		}
	}

	async function pickScreenColor(): Promise<void> {
		const Constructor: OpenPostEyeDropperConstructor | undefined = window.EyeDropper;
		if (!Constructor) return;
		try {
			const result = await new Constructor().open();
			const value = result.sRGBHex;
			choose({
				r: Number.parseInt(value.slice(1, 3), 16),
				g: Number.parseInt(value.slice(3, 5), 16),
				b: Number.parseInt(value.slice(5, 7), 16),
				a: 1
			});
		} catch {
			/* The native picker was cancelled. */
		}
	}

	onDestroy(() => {
		loadVersion++;
		bitmap?.close();
		previewURL.clear();
	});
</script>

<div class="picker">
	{#if !bitmap}
		<LocalImageDropZone
			onfile={load}
			onerror={(message) => (error = message)}
			disabled={busy}
			label="Drop, paste, or choose an image"
		/>
	{:else}
		<div class="workspace">
			<div class="image-wrap checker">
				<button
					type="button"
					class="image-control"
					aria-label={`Image color sampler. Pixel ${x + 1} of ${width} horizontally, ${y + 1} of ${height} vertically.`}
					onclick={(event) => {
						const point = mapRenderedPoint(
							event.clientX,
							event.clientY,
							imageElement!.getBoundingClientRect(),
							width,
							height
						);
						sample(point.x, point.y);
					}}
					onkeydown={(event) => {
						let dx = 0,
							dy = 0;
						if (event.key === 'ArrowLeft') dx = -1;
						else if (event.key === 'ArrowRight') dx = 1;
						else if (event.key === 'ArrowUp') dy = -1;
						else if (event.key === 'ArrowDown') dy = 1;
						else return;
						event.preventDefault();
						sample(x + dx, y + dy);
					}}
				>
					<img bind:this={imageElement} src={preview} alt="" />
					<span
						class="marker"
						aria-hidden="true"
						style:left={`${((x + 0.5) / width) * 100}%`}
						style:top={`${((y + 0.5) / height) * 100}%`}
					></span>
				</button>
			</div>
			<div class="results">
				<div class="selected">
					<span style:background={selected.a === 0 ? 'transparent' : hex}></span>
					<div>
						<strong>{hex}</strong><small
							>{selected.a < 1 ? `${Math.round(selected.a * 100)}% opacity` : 'Opaque'} · pixel {x +
								1}, {y + 1}</small
						>
					</div>
				</div>
				<div class="coordinates">
					<div>
						<Label for="sample-x">X pixel</Label><Input
							id="sample-x"
							type="number"
							min="1"
							max={width}
							value={x + 1}
							onchange={(event) => sampleField('x', event)}
						/>
					</div>
					<div>
						<Label for="sample-y">Y pixel</Label><Input
							id="sample-y"
							type="number"
							min="1"
							max={height}
							value={y + 1}
							onchange={(event) => sampleField('y', event)}
						/>
					</div>
				</div>
				<div class="values">
					{#each [[hex, 'HEX'], [rgb, 'RGB'], [hsl, 'HSL']] as item (item[1])}<button
							type="button"
							onclick={() => copy(item[0], item[1])}
							><span><b>{item[1]}</b>{item[0]}</span><Clipboard
								size={15}
								aria-hidden="true"
							/></button
						>{/each}
				</div>
				{#if palette.length}<section>
						<h2>Image palette</h2>
						<div class="palette">
							{#each palette as color (rgbaToHex(color))}<button
									type="button"
									title={`Use ${rgbaToHex(color)}`}
									aria-label={`Use ${rgbaToHex(color)}`}
									style:background={rgbaToHex(color)}
									onclick={() => choose(color)}
								></button>{/each}
						</div>
					</section>{/if}
				<p class="hint">
					Click the image to sample a pixel. Focus it and use the arrow keys for precise movement.
					Transparent pixels include alpha in HEX, RGB, and HSL values.
				</p>
				<div class="actions">
					{#if supportsEyeDropper}<Button variant="outline" onclick={pickScreenColor}
							><Pipette data-icon="inline-start" />Pick from screen</Button
						>{/if}<Button variant="ghost" onclick={reset}
						><RotateCcw data-icon="inline-start" />Start over</Button
					>
				</div>
			</div>
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="sr-only" aria-live="polite">{status}</p>
</div>

<style>
	.picker {
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
		padding: 20px;
	}
	.workspace {
		display: grid;
		gap: 20px;
	}
	.image-wrap {
		position: relative;
		display: grid;
		min-height: 280px;
		place-items: center;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.image-control {
		position: relative;
		display: block;
		max-width: 100%;
		cursor: crosshair;
	}
	.image-control img {
		display: block;
		max-height: 500px;
		max-width: 100%;
		object-fit: contain;
	}
	.marker {
		position: absolute;
		width: 14px;
		height: 14px;
		transform: translate(-50%, -50%);
		border: 2px solid white;
		border-radius: 50%;
		box-shadow: 0 0 0 1px black;
		pointer-events: none;
	}
	.checker {
		background-color: var(--muted);
		background-image:
			linear-gradient(
				45deg,
				color-mix(in srgb, var(--foreground) 8%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				-45deg,
				color-mix(in srgb, var(--foreground) 8%, transparent) 25%,
				transparent 25%
			),
			linear-gradient(
				45deg,
				transparent 75%,
				color-mix(in srgb, var(--foreground) 8%, transparent) 75%
			),
			linear-gradient(
				-45deg,
				transparent 75%,
				color-mix(in srgb, var(--foreground) 8%, transparent) 75%
			);
		background-size: 20px 20px;
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
	}
	.results {
		display: grid;
		align-content: start;
		gap: 18px;
	}
	.coordinates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.coordinates > div {
		display: grid;
		gap: 6px;
	}
	.selected {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.selected > span {
		width: 44px;
		height: 44px;
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.selected div {
		display: grid;
	}
	.selected small,
	.hint {
		color: var(--muted-foreground);
		font-size: 11px;
		line-height: 1.6;
	}
	.values {
		display: grid;
		gap: 6px;
	}
	.values button {
		display: flex;
		min-height: 44px;
		align-items: center;
		justify-content: space-between;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px 10px;
		text-align: left;
	}
	.values button:hover {
		background: var(--accent);
	}
	.values span {
		display: grid;
		gap: 2px;
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.values b {
		color: var(--muted-foreground);
		font-family: inherit;
	}
	section h2 {
		margin-bottom: 9px;
		font-size: 12px;
		font-weight: 550;
	}
	.palette {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.palette button {
		width: 38px;
		height: 38px;
		border: 2px solid var(--background);
		border-radius: 8px;
		box-shadow: 0 0 0 1px var(--border);
	}
	@media (pointer: coarse) {
		.palette button {
			width: 44px;
			height: 44px;
		}
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.error {
		margin-top: 14px;
		color: var(--destructive);
		font-size: 13px;
	}
	@container tool (min-width: 700px) {
		.workspace {
			grid-template-columns: minmax(0, 1.35fr) minmax(250px, 0.65fr);
		}
	}
</style>
