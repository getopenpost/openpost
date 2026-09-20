<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Check, Clipboard, Download, LoaderCircle, RotateCcw, Sparkles, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import {
		BACKGROUND_REMOVAL_MAX_INPUT_BYTES,
		BACKGROUND_REMOVAL_MAX_OUTPUT_DIMENSION,
		BACKGROUND_REMOVAL_MAX_OUTPUT_PIXELS,
		ImageEditorBackgroundRemoval,
		type BackgroundRemovalProgress
	} from '$lib/image-editor/background-removal';
	import LocalImageDropZone from './LocalImageDropZone.svelte';

	type ToolPhase = 'empty' | 'ready' | 'processing' | 'complete' | 'error';

	const removal = new ImageEditorBackgroundRemoval();
	let phase = $state<ToolPhase>('empty');
	let sourceFile = $state<File>();
	let sourceUrl = $state('');
	let resultBlob = $state<Blob>();
	let resultUrl = $state('');
	let error = $state('');
	let progress = $state<BackgroundRemovalProgress>({ stage: '', progress: 0 });
	let comparison = $state(50);
	let copied = $state(false);
	let requestVersion = 0;
	let destroyed = false;

	const filename = $derived(
		sourceFile ? `${sourceFile.name.replace(/\.[^.]+$/u, '') || 'image'}-no-background.png` : ''
	);
	const progressPercent = $derived(Math.max(0, Math.min(100, Math.round(progress.progress * 100))));
	const progressLabel = $derived(formatProgress(progress));

	function formatProgress(value: BackgroundRemovalProgress): string {
		if (value.stage === 'Preparing an optimized processing copy') return 'Preparing image';
		if (value.stage === 'Restoring original resolution') return 'Restoring original size';
		if (value.stage === 'Using CPU fallback') return 'Switching to a compatible processor';
		if (value.stage.startsWith('fetch:')) return 'Loading the removal model';
		return 'Removing background';
	}

	function revoke(url: string) {
		if (url) URL.revokeObjectURL(url);
	}

	function clearResult() {
		requestVersion += 1;
		removal.cancel();
		revoke(resultUrl);
		resultUrl = '';
		resultBlob = undefined;
		progress = { stage: '', progress: 0 };
		copied = false;
	}

	function reset() {
		clearResult();
		revoke(sourceUrl);
		sourceUrl = '';
		sourceFile = undefined;
		error = '';
		phase = 'empty';
		comparison = 50;
	}

	async function useFile(file: File) {
		clearResult();
		const version = requestVersion;
		revoke(sourceUrl);
		sourceUrl = '';
		sourceFile = undefined;
		error = '';
		if (!file.type.startsWith('image/')) {
			error = 'Choose an image file.';
			phase = 'error';
			return;
		}
		if (file.size > BACKGROUND_REMOVAL_MAX_INPUT_BYTES) {
			error = 'Choose an image smaller than 25 MB.';
			phase = 'error';
			return;
		}
		try {
			const bitmap = await createImageBitmap(file);
			const tooLarge =
				bitmap.width * bitmap.height > BACKGROUND_REMOVAL_MAX_OUTPUT_PIXELS ||
				bitmap.width > BACKGROUND_REMOVAL_MAX_OUTPUT_DIMENSION ||
				bitmap.height > BACKGROUND_REMOVAL_MAX_OUTPUT_DIMENSION;
			bitmap.close();
			if (destroyed || version !== requestVersion) return;
			if (tooLarge) {
				error = 'Choose an image no larger than 40 megapixels or 8192 pixels on one side.';
				phase = 'error';
				return;
			}
		} catch {
			if (destroyed || version !== requestVersion) return;
			error = 'This image could not be opened. Try a PNG, JPEG, or WebP file.';
			phase = 'error';
			return;
		}
		if (destroyed || version !== requestVersion) return;
		sourceFile = file;
		sourceUrl = URL.createObjectURL(file);
		phase = 'ready';
	}

	async function removeBackground() {
		if (!sourceFile || phase === 'processing') return;
		revoke(resultUrl);
		resultUrl = '';
		resultBlob = undefined;
		phase = 'processing';
		error = '';
		progress = { stage: 'Starting', progress: 0 };
		const version = ++requestVersion;
		try {
			const result = await removal.remove(sourceFile, '/image-editor-models/', (next) => {
				if (!destroyed && version === requestVersion) progress = next;
			});
			if (destroyed || version !== requestVersion) return;
			resultBlob = result;
			resultUrl = URL.createObjectURL(result);
			phase = 'complete';
		} catch (cause) {
			if (destroyed || version !== requestVersion) return;
			if (cause instanceof DOMException && cause.name === 'AbortError') {
				phase = 'ready';
				return;
			}
			error = cause instanceof Error ? cause.message : 'Background removal failed. Try again.';
			phase = 'error';
		}
	}

	function cancel() {
		requestVersion += 1;
		removal.cancel();
		phase = sourceFile ? 'ready' : 'empty';
	}

	function download() {
		if (!resultUrl) return;
		const link = document.createElement('a');
		link.href = resultUrl;
		link.download = filename;
		link.click();
	}

	async function copyResult() {
		if (!resultBlob || !('ClipboardItem' in globalThis)) return;
		try {
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': resultBlob })]);
			copied = true;
			window.setTimeout(() => (copied = false), 2000);
		} catch {
			error = 'Your browser did not allow copying. Download the PNG instead.';
		}
	}

	onDestroy(() => {
		destroyed = true;
		requestVersion += 1;
		removal.dispose();
		revoke(sourceUrl);
		revoke(resultUrl);
	});
</script>

<div class="background-remover">
	{#if phase === 'empty' || (!sourceFile && phase === 'error')}
		<LocalImageDropZone
			onfile={useFile}
			maxBytes={BACKGROUND_REMOVAL_MAX_INPUT_BYTES}
			hint="PNG, JPEG, or WebP. Up to 25 MB, 40 MP, and 8192 px per side."
			onerror={(message) => {
				error = message;
				phase = 'error';
			}}
		/>
	{:else if sourceFile}
		<div class="workspace">
			<div class="workspace-bar">
				<div class="file-name">
					<span>{sourceFile.name}</span>
					<small>{(sourceFile.size / 1024 / 1024).toFixed(1)} MB</small>
				</div>
				<button
					class="icon-button focus-ring"
					type="button"
					aria-label="Choose another image"
					onclick={reset}><X size={18} /></button
				>
			</div>

			<div class="preview checkerboard" class:is-processing={phase === 'processing'}>
				<img src={sourceUrl} alt="Original upload" />
				{#if resultUrl}
					<div
						class="result-layer checkerboard"
						style={`clip-path: inset(0 ${100 - comparison}% 0 0)`}
					>
						<img src={resultUrl} alt="Background removed" />
					</div>
					<div class="comparison-line" style={`left: ${comparison}%`} aria-hidden="true"></div>
				{/if}

				{#if phase === 'processing'}
					<div class="progress-card" role="status" aria-live="polite">
						<LoaderCircle class="spinner" size={24} />
						<strong>{progressLabel}</strong>
						<div class="progress-track" aria-hidden="true">
							<span style={`width: ${progressPercent}%`}></span>
						</div>
						<small>{progressPercent}%</small>
						<Button variant="outline" size="sm" onclick={cancel}>Cancel</Button>
					</div>
				{/if}
			</div>

			{#if resultUrl}
				<label class="comparison-control">
					<span>Original</span>
					<Slider
						bind:value={comparison}
						min={0}
						max={100}
						ariaLabel="Compare original and result"
					/>
					<span>Result</span>
				</label>
			{/if}

			<div class="actions">
				{#if phase === 'complete'}
					<Button onclick={download}><Download data-icon="inline-start" /> Download PNG</Button>
					<Button
						variant="outline"
						onclick={copyResult}
						disabled={typeof ClipboardItem === 'undefined'}
					>
						{#if copied}<Check data-icon="inline-start" /> Copied{:else}<Clipboard
								data-icon="inline-start"
							/> Copy PNG{/if}
					</Button>
					<Button variant="ghost" onclick={() => void removeBackground()}
						><RotateCcw data-icon="inline-start" /> Try again</Button
					>
				{:else if phase !== 'processing'}
					<Button onclick={() => void removeBackground()}
						><Sparkles data-icon="inline-start" /> Remove background</Button
					>
				{/if}
			</div>
		</div>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<p class="local-note">Your image stays in this browser. Nothing is uploaded.</p>
</div>

<style>
	.background-remover {
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--card);
		padding: clamp(16px, 3vw, 28px);
	}
	.local-note,
	.file-name small {
		color: var(--muted-foreground);
	}
	.workspace {
		display: grid;
		gap: 16px;
	}
	.workspace-bar,
	.actions,
	.comparison-control {
		display: flex;
		align-items: center;
	}
	.workspace-bar {
		justify-content: space-between;
		gap: 16px;
	}
	.file-name {
		display: grid;
		min-width: 0;
		font-size: 14px;
	}
	.file-name span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.icon-button {
		display: grid;
		width: 36px;
		height: 36px;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--background);
		color: var(--foreground);
	}
	.preview {
		position: relative;
		display: grid;
		min-height: 300px;
		max-height: 620px;
		place-items: center;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 10px;
	}
	.checkerboard {
		background-color: var(--background);
		background-image:
			linear-gradient(45deg, var(--muted) 25%, transparent 25%),
			linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--muted) 75%),
			linear-gradient(-45deg, transparent 75%, var(--muted) 75%);
		background-position:
			0 0,
			0 10px,
			10px -10px,
			-10px 0;
		background-size: 20px 20px;
	}
	.preview > img,
	.result-layer,
	.result-layer img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.preview > img {
		max-height: 620px;
	}
	.result-layer {
		position: absolute;
		inset: 0;
	}
	.result-layer img {
		position: absolute;
		inset: 0;
	}
	.comparison-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: white;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 35%);
	}
	.is-processing > img {
		opacity: 0.5;
	}
	.progress-card {
		position: absolute;
		display: grid;
		width: min(280px, calc(100% - 32px));
		justify-items: center;
		gap: 10px;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: color-mix(in oklch, var(--background) 94%, transparent);
		backdrop-filter: blur(8px);
		text-align: center;
	}
	:global(.spinner) {
		animation: spin 1s linear infinite;
		color: var(--primary);
	}
	.progress-card strong {
		font-size: 14px;
	}
	.progress-card small {
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.progress-track {
		height: 5px;
		width: 100%;
		overflow: hidden;
		border-radius: 3px;
		background: var(--muted);
	}
	.progress-track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--primary);
		transition: width 160ms ease;
	}
	.comparison-control {
		gap: 12px;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.comparison-control :global([data-slot='slider-root']) {
		width: 100%;
	}
	.actions {
		flex-wrap: wrap;
		gap: 8px;
	}
	.error {
		margin-top: 14px;
		padding: 10px 12px;
		border: 1px solid color-mix(in oklch, var(--destructive) 35%, var(--border));
		border-radius: 8px;
		background: color-mix(in oklch, var(--destructive) 8%, transparent);
		color: var(--destructive);
		font-size: 13px;
	}
	.local-note {
		margin-top: 14px;
		font-size: 12px;
		text-align: center;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.spinner) {
			animation: none;
		}
		.progress-track span {
			transition: none;
		}
	}
	@media (max-width: 480px) {
		.background-remover {
			padding: 12px;
		}
		.preview {
			min-height: 260px;
		}
		.actions :global(a),
		.actions :global(button) {
			flex: 1 1 auto;
		}
	}
	@media (pointer: coarse) {
		.icon-button {
			width: 44px;
			height: 44px;
		}
		.comparison-control :global([data-slot='slider-root']) {
			min-height: 44px;
		}
	}
</style>
