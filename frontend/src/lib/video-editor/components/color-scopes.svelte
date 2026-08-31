<script lang="ts">
	import { onMount } from 'svelte';
	import AppSelect from '$lib/components/app-select.svelte';
	import { m } from '$lib/paraglide/messages';
	import { drawCpuScope, type ColorScope } from '$lib/video-editor/effects/scope-cpu-renderer';
	import { ScopeRenderer } from '$lib/video-editor/effects/gpu-scopes';
	import { scopeSamples, type ScopeSample } from '$lib/video-editor/effects/scope-samples.svelte';
	import ColorScopeOverlay from './color-scope-overlay.svelte';

	type ScopeViewMode = 'rgb' | 'r' | 'g' | 'b' | 'luma';

	const VIEW_MODE_NUMBER = {
		rgb: 0,
		r: 1,
		g: 2,
		b: 3,
		luma: 4
	} as const satisfies Readonly<Record<ScopeViewMode, number>>;
	const SCOPE_STORAGE_KEY = 'timeline:scopes:stackLayout';
	const SCOPE_OPTIONS: readonly ColorScope[] = ['waveform', 'parade', 'vectorscope', 'histogram'];
	interface CanvasShape {
		width: number;
		height: number;
	}
	const VIEW_MODES: ReadonlyArray<{
		value: ScopeViewMode;
		label: string;
		color: string;
	}> = [
		{ value: 'rgb', label: 'RGB', color: '#aaa29a' },
		{ value: 'r', label: 'R', color: '#ff6666' },
		{ value: 'g', label: 'G', color: '#66cc66' },
		{ value: 'b', label: 'B', color: '#6688ff' },
		{ value: 'luma', label: 'Y', color: '#ccccaa' }
	];

	let { itemId, embedded = false }: { itemId: string | null; embedded?: boolean } = $props();
	let gpuCanvas = $state<HTMLCanvasElement | null>(null);
	let cpuCanvas = $state<HTMLCanvasElement | null>(null);
	let renderer = $state.raw<ScopeRenderer | null>(null);
	let gpuReady = $state(false);
	let gpuFailure = $state('');
	let canvasRevision = $state(0);
	let scope = $state<ColorScope>('parade');
	let viewMode = $state<ScopeViewMode>('rgb');
	let scopeStorageReady = $state(false);
	const active = $derived(scopeSamples.current?.itemId === itemId ? scopeSamples.current : null);
	const showViewModes = $derived(gpuReady && (scope === 'histogram' || scope === 'waveform'));
	function isColorScope(value: string | null): value is ColorScope {
		return value !== null && SCOPE_OPTIONS.some((candidate) => candidate === value);
	}

	onMount(() => {
		try {
			const saved = localStorage.getItem(SCOPE_STORAGE_KEY);
			if (isColorScope(saved)) scope = saved;
		} catch {
			// Storage is optional; RGB Parade remains the source-defined default.
		}
		scopeStorageReady = true;
		if (!itemId) return;
		let disposed = false;
		let created: ScopeRenderer | null = null;
		void ScopeRenderer.create((message) => {
			const lostRenderer = renderer;
			if (disposed || !created || lostRenderer !== created) return;
			gpuFailure = message;
			lostRenderer.destroy();
			renderer = null;
			gpuReady = false;
		}).then((nextRenderer) => {
			created = nextRenderer;
			if (disposed) {
				nextRenderer?.destroy();
				return;
			}
			if (nextRenderer && !nextRenderer.available) {
				nextRenderer.destroy();
				gpuFailure = 'WebGPU device was lost during scope setup';
				return;
			}
			renderer = nextRenderer;
			gpuReady = nextRenderer?.available === true;
		});
		return () => {
			disposed = true;
			created?.destroy();
			renderer = null;
		};
	});

	$effect(() => {
		if (!scopeStorageReady) return;
		try {
			localStorage.setItem(SCOPE_STORAGE_KEY, scope);
		} catch {
			// The selected scope still works for this session when storage is unavailable.
		}
	});

	$effect(() => {
		const canvas = gpuReady ? gpuCanvas : cpuCanvas;
		if (!canvas || !globalThis.ResizeObserver) return;
		const observer = new globalThis.ResizeObserver(() => {
			canvasRevision++;
		});
		observer.observe(canvas);
		return () => observer.disconnect();
	});

	$effect(() => {
		void canvasRevision;
		if (!active) {
			clearCpuCanvas(cpuCanvas);
			return;
		}
		const sample = active;
		const selectedScope = scope;
		const selectedViewMode = viewMode;
		const frame = requestAnimationFrame(() => {
			renderSample(sample, selectedScope, selectedViewMode);
		});
		return () => cancelAnimationFrame(frame);
	});

	function renderSample(
		sample: ScopeSample,
		selectedScope: ColorScope,
		selectedViewMode: ScopeViewMode
	): void {
		if (renderer && gpuReady && gpuCanvas) {
			try {
				ensureCanvasSize(gpuCanvas, selectedScope);
				const context = renderer.configureCanvas(gpuCanvas);
				if (!context) throw new Error('WebGPU canvas context is unavailable');
				if (sample.source) renderer.uploadFromCanvas(sample.source);
				else {
					const image = scopeSamples.readImage(sample);
					if (!image) return;
					renderer.uploadFrame(image);
				}
				if (selectedScope === 'histogram') {
					renderer.renderHistogram(context, VIEW_MODE_NUMBER[selectedViewMode]);
				} else if (selectedScope === 'vectorscope') {
					renderer.renderVectorscope(context);
				} else {
					renderer.renderWaveforms([
						{
							ctx: context,
							mode: selectedScope === 'parade' ? 5 : VIEW_MODE_NUMBER[selectedViewMode]
						}
					]);
				}
				return;
			} catch (error) {
				gpuFailure = error instanceof Error ? error.message : 'WebGPU scope rendering failed';
				renderer.destroy();
				renderer = null;
				gpuReady = false;
			}
		}
		const image = scopeSamples.readImage(sample);
		if (!image || !cpuCanvas) return;
		ensureCanvasSize(cpuCanvas, selectedScope);
		const context = cpuCanvas.getContext('2d');
		if (!context) return;
		drawCpuScope(context, image, selectedScope, cpuCanvas.width, cpuCanvas.height);
	}

	function canvasShape(selectedScope: ColorScope): CanvasShape {
		if (selectedScope === 'vectorscope') return { width: 512, height: 512 };
		if (selectedScope === 'parade') return { width: 512, height: 154 };
		return { width: 512, height: 256 };
	}

	function ensureCanvasSize(canvas: HTMLCanvasElement, selectedScope: ColorScope): void {
		const fallback = canvasShape(selectedScope);
		const bounds = canvas.getBoundingClientRect();
		const ratio = Math.min(2, window.devicePixelRatio || 1);
		const cssWidth = Math.max(2, Math.round(bounds.width || fallback.width / ratio));
		const cssHeight = Math.max(2, Math.round(bounds.height || fallback.height / ratio));
		if (selectedScope === 'vectorscope') {
			const size = Math.min(512, Math.round(Math.min(cssWidth, cssHeight) * ratio));
			if (canvas.width !== size) canvas.width = size;
			if (canvas.height !== size) canvas.height = size;
			return;
		}
		const width = Math.min(1024, Math.round(cssWidth * ratio));
		const height = Math.min(512, Math.round(cssHeight * ratio));
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
	}

	function clearCpuCanvas(canvas: HTMLCanvasElement | null): void {
		if (!canvas) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.fillStyle = '#0a0a0a';
		context.fillRect(0, 0, canvas.width, canvas.height);
	}

	function canvasClass(selectedScope: ColorScope): string {
		if (selectedScope === 'vectorscope') return 'mx-auto aspect-square size-full max-h-72 max-w-72';
		if (selectedScope === 'parade') return 'aspect-[10/3] w-full';
		return 'aspect-[2/1] w-full';
	}
</script>

<section
	class="flex min-h-0 flex-col {embedded
		? 'h-full p-2'
		: 'mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2'}"
	data-scope-backend={gpuReady ? 'webgpu' : 'cpu'}
	data-scope-error={gpuFailure || undefined}
>
	<div class="mb-1 flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-1.5">
			<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
				{m.video_editor_scopes()}
			</h3>
			<span
				class="rounded bg-[oklch(0.24_0.01_55)] px-1 py-0.5 font-mono text-[8px] text-[oklch(0.58_0.012_55)]"
				aria-hidden="true"
			>
				{gpuReady ? 'GPU' : 'CPU'}
			</span>
		</div>
		<AppSelect
			bind:value={scope}
			ariaLabel={m.video_editor_scope_live()}
			class="h-7 w-28 text-[10px]"
			options={[
				{ value: 'histogram', label: m.video_editor_scope_histogram() },
				{ value: 'waveform', label: m.video_editor_scope_waveform() },
				{ value: 'parade', label: m.video_editor_scope_parade() },
				{ value: 'vectorscope', label: m.video_editor_scope_vectorscope() }
			]}
		/>
	</div>

	{#if showViewModes}
		<div
			class="mb-1 flex items-center justify-end gap-0.5"
			aria-label={m.video_editor_scope_live()}
		>
			{#each VIEW_MODES as option (option.value)}
				<button
					type="button"
					class="scope-mode {viewMode === option.value ? 'scope-mode-active' : ''}"
					style:--scope-mode-color={option.color}
					aria-pressed={viewMode === option.value}
					onclick={() => (viewMode = option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/if}

	<div
		class="relative min-h-0 overflow-hidden rounded border border-white/10 bg-black/80 {embedded
			? 'flex-1'
			: ''} {canvasClass(scope)}"
	>
		{#if gpuReady}
			<canvas
				bind:this={gpuCanvas}
				data-color-scope-canvas
				class="size-full object-contain"
				aria-label={m.video_editor_scope_live()}
			></canvas>
		{:else}
			<canvas
				bind:this={cpuCanvas}
				data-color-scope-canvas
				class="size-full object-contain"
				aria-label={m.video_editor_scope_live()}
			></canvas>
		{/if}
		<ColorScopeOverlay {scope} />
	</div>
</section>

<style>
	.scope-mode {
		height: 1.5rem;
		min-width: 1.5rem;
		border-radius: 0.25rem;
		padding-inline: 0.25rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.5625rem;
		font-weight: 650;
		color: oklch(0.62 0.015 55);
	}

	.scope-mode:hover,
	.scope-mode:focus-visible {
		background: oklch(0.24 0.01 55);
		color: oklch(0.86 0.008 75);
	}

	.scope-mode:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 1px;
	}

	.scope-mode-active {
		border-bottom: 1.5px solid var(--scope-mode-color);
		background: color-mix(in oklch, var(--scope-mode-color) 18%, transparent);
		color: oklch(0.94 0.006 75);
	}

	@media (pointer: coarse) {
		.scope-mode {
			min-width: 2.75rem;
			height: 2.75rem;
		}
	}
</style>
