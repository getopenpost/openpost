<script lang="ts">
	import { Clipboard, Download, RotateCcw } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Slider } from '$lib/components/ui/slider';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import LocalImageDropZone from './LocalImageDropZone.svelte';
	import {
		canvasFromBitmap,
		decodeLocalImage,
		encodeCanvas,
		localImageMessage,
		LOCAL_IMAGE_MIME,
		ObjectURLSlot,
		type LocalImageFormat
	} from './local-image';

	let {
		inputFormat,
		outputFormat = 'png',
		autoDownload = false
	}: {
		inputFormat?: LocalImageFormat;
		outputFormat?: LocalImageFormat;
		autoDownload?: boolean;
	} = $props();

	let bitmap = $state<ImageBitmap | null>(null);
	let fileName = $state('image');
	let width = $state(0);
	let height = $state(0);
	let quality = $state(90);
	let matte = $state('#FFFFFF');
	let busy = $state(false);
	let error = $state('');
	let status = $state('');
	let preview = $state('');
	let outputBlob = $state<Blob | null>(null);
	const previewURL = new ObjectURLSlot();
	let loadVersion = 0;
	let outputVersion = 0;
	let encodeTail: Promise<void> = Promise.resolve();
	let automaticDownloadPending = false;

	const effectiveInputLabel = $derived(
		inputFormat ? inputFormat.toUpperCase().replace('JPEG', 'JPG') : 'PNG, JPEG, or WebP'
	);
	const lossy = $derived(outputFormat !== 'png');
	const needsMatte = $derived(outputFormat === 'jpeg');

	function reset(): void {
		loadVersion++;
		outputVersion++;
		bitmap?.close();
		bitmap = null;
		previewURL.clear();
		preview = '';
		outputBlob = null;
		automaticDownloadPending = false;
		width = 0;
		height = 0;
		error = '';
		status = '';
		busy = false;
	}

	async function load(file: File): Promise<void> {
		if (inputFormat && file.type !== LOCAL_IMAGE_MIME[inputFormat]) {
			error = `Choose a ${effectiveInputLabel} image.`;
			status = '';
			return;
		}
		const version = ++loadVersion;
		busy = true;
		error = '';
		try {
			const next = await decodeLocalImage(file);
			if (version !== loadVersion) {
				next.close();
				return;
			}
			bitmap?.close();
			bitmap = next;
			width = next.width;
			height = next.height;
			fileName = file.name.replace(/\.[^.]+$/, '') || 'image';
			automaticDownloadPending = autoDownload;
			status = `${file.name} loaded. Creating the ${outputFormat.toUpperCase()} preview.`;
		} catch (reason) {
			if (version === loadVersion) error = localImageMessage(reason);
		} finally {
			if (version === loadVersion) busy = false;
		}
	}

	async function download(): Promise<void> {
		if (!outputBlob) return;
		busy = true;
		error = '';
		try {
			downloadBlob(outputBlob);
		} catch (reason) {
			error = localImageMessage(reason);
		} finally {
			busy = false;
		}
	}

	function downloadBlob(blob: Blob): void {
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${fileName}.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 30_000);
		status = `Downloaded ${link.download} at ${width} by ${height} pixels.`;
	}

	async function copyPNG(): Promise<void> {
		if (!navigator.clipboard?.write || !('ClipboardItem' in globalThis)) {
			error = 'This browser cannot copy images. Download the PNG instead.';
			return;
		}
		busy = true;
		try {
			const blob = await encodeCanvas(canvasFromBitmap(bitmap!, width, height), 'png');
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			status = `Source pixels copied as PNG${outputFormat === 'png' ? '.' : `, separate from the ${outputFormat.toUpperCase()} download.`}`;
			error = '';
		} catch {
			error = 'The browser blocked image copying. Allow clipboard access or download the PNG.';
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		const source = bitmap;
		if (!source) return;
		const settings = {
			format: outputFormat,
			quality: quality / 100,
			matte: needsMatte ? matte : undefined
		};
		const version = ++outputVersion;
		outputBlob = null;
		previewURL.clear();
		preview = '';
		busy = true;
		error = '';
		const timer = setTimeout(() => {
			encodeTail = encodeTail.then(async () => {
				if (version !== outputVersion) return;
				await encodeCanvas(
					canvasFromBitmap(source, source.width, source.height, settings.matte),
					settings.format,
					settings.quality
				)
					.then((blob) => {
						if (version !== outputVersion) return;
						outputBlob = blob;
						preview = previewURL.set(blob).url;
						status = `${outputFormat.toUpperCase()} preview ready at ${width} by ${height} pixels.`;
						if (automaticDownloadPending) {
							automaticDownloadPending = false;
							downloadBlob(blob);
						}
					})
					.catch((reason) => {
						if (version === outputVersion) error = localImageMessage(reason);
					})
					.finally(() => {
						if (version === outputVersion) busy = false;
					});
			});
		}, 150);
		return () => clearTimeout(timer);
	});

	onDestroy(() => {
		loadVersion++;
		outputVersion++;
		bitmap?.close();
		previewURL.clear();
	});
</script>

<div class="converter">
	{#if !bitmap}
		<LocalImageDropZone
			onfile={load}
			onerror={(message) => (error = message)}
			disabled={busy}
			label={`Drop, paste, or choose a ${effectiveInputLabel} image`}
			hint={`${effectiveInputLabel}, up to 50 MB`}
			acceptTypes={inputFormat ? LOCAL_IMAGE_MIME[inputFormat] : undefined}
		/>
	{:else}
		<div class="workspace">
			<div class="preview checker">
				{#if preview}<img
						src={preview}
						alt={`${outputFormat.toUpperCase()} output preview`}
					/>{:else}<span>Creating preview…</span>{/if}
			</div>
			<div class="settings">
				<div class="summary"><strong>{fileName}</strong><span>{width} × {height} px</span></div>
				<div class="field">
					<Label for="output-format">Output format</Label><AppSelect
						id="output-format"
						value={outputFormat}
						onValueChange={(value) => (outputFormat = value as LocalImageFormat)}
						options={[
							{ value: 'png', label: 'PNG' },
							{ value: 'jpeg', label: 'JPEG' },
							{ value: 'webp', label: 'WebP' }
						]}
					/>
				</div>
				{#if lossy}
					<div>
						<Label>Quality: {quality}%</Label><Slider
							bind:value={quality}
							min={10}
							max={100}
							step={1}
							ariaLabel="Output quality"
						/>
					</div>
					{#if needsMatte}
						<div class="field">
							<Label for="image-matte">Transparent pixel color</Label><ColorPicker
								id="image-matte"
								label="Transparent pixel color"
								value={matte}
								onChange={(value) => (matte = value.toUpperCase())}
							/>
						</div>
						<p class="hint">JPEG cannot keep transparency, so transparent pixels use this color.</p>
					{/if}
				{/if}
				<div class="actions">
					<Button onclick={download} disabled={busy || !outputBlob}
						><Download data-icon="inline-start" />Download {outputFormat.toUpperCase()}</Button
					><Button variant="outline" onclick={copyPNG} disabled={busy}
						><Clipboard data-icon="inline-start" />Copy source as PNG</Button
					><Button variant="ghost" onclick={reset}
						><RotateCcw data-icon="inline-start" />Start over</Button
					>
				</div>
			</div>
		</div>
	{/if}
	{#if error}<p class="message error" role="alert">{error}</p>{/if}
	<p class="sr-only" aria-live="polite">{status}</p>
</div>

<style>
	.converter {
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
		padding: 20px;
	}
	.workspace {
		display: grid;
		gap: 20px;
	}
	.preview {
		display: grid;
		min-height: 260px;
		place-items: center;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.preview img {
		display: block;
		max-height: 420px;
		max-width: 100%;
		object-fit: contain;
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
	.settings {
		display: grid;
		align-content: start;
		gap: 18px;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px;
	}
	.summary span,
	.hint {
		color: var(--muted-foreground);
		font-size: 12px;
	}
	.field {
		display: grid;
		gap: 8px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.message {
		margin-top: 14px;
		font-size: 13px;
	}
	.error {
		color: var(--destructive);
	}
	@container tool (min-width: 650px) {
		.workspace {
			grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr);
		}
	}
</style>
