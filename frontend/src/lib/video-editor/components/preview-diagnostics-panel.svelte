<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { previewDiagnostics } from '$lib/video-editor/preview/diagnostics.svelte';

	let copied = $state(false);
	let copyError = $state(false);
	const snapshot = $derived(previewDiagnostics.snapshot);
	const statusLabel = $derived.by(() => {
		if (previewDiagnostics.health === 'smooth') return m.video_editor_diagnostics_status_smooth();
		if (previewDiagnostics.health === 'reduced') return m.video_editor_diagnostics_status_reduced();
		if (previewDiagnostics.health === 'under-load')
			return m.video_editor_diagnostics_status_under_load();
		return m.video_editor_diagnostics_status_waiting();
	});
	const statusTone = $derived(
		previewDiagnostics.health === 'under-load'
			? 'text-red-300'
			: previewDiagnostics.health === 'smooth'
				? 'text-emerald-300'
				: 'text-[var(--video-editor-muted)]'
	);
	const rendererLabel = $derived(
		snapshot.renderPath === 'composited'
			? m.video_editor_diagnostics_composited()
			: m.video_editor_diagnostics_direct()
	);
	const gpuLabel = $derived.by(() => {
		if (snapshot.renderPath === 'direct') return m.video_editor_diagnostics_gpu_direct();
		if (!snapshot.webgl2Ready) return m.video_editor_diagnostics_canvas_fallback();
		if (snapshot.webgpuTransitionsReady) return m.video_editor_diagnostics_gpu_full();
		return m.video_editor_diagnostics_gpu_effects();
	});

	function formatMs(value: number | null): string {
		return value === null || value <= 0
			? m.video_editor_diagnostics_not_measured()
			: `${value.toFixed(1)} ms`;
	}

	async function copyReport(): Promise<void> {
		copied = false;
		copyError = false;
		try {
			await navigator.clipboard.writeText(previewDiagnostics.report());
			copied = true;
		} catch {
			copyError = true;
		}
	}
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={m.video_editor_diagnostics_title()}
				title={m.video_editor_diagnostics_title()}
			>
				<ThemeIcon role="analytics" class="size-3.5" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="end"
		sideOffset={8}
		class="video-editor-theme max-h-[min(36rem,calc(100dvh-4rem))] w-[min(23rem,calc(100vw-1rem))] overflow-y-auto border-[oklch(0.28_0.014_55)] bg-[oklch(0.18_0.01_55)] p-0 text-[var(--video-editor-text)]"
	>
		<div class="flex items-start justify-between gap-4 border-b border-[oklch(0.27_0.014_55)] p-4">
			<div>
				<h2 class="text-sm font-medium">{m.video_editor_diagnostics_title()}</h2>
				<p class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
					{m.video_editor_diagnostics_description()}
				</p>
			</div>
			<span class="shrink-0 text-xs font-medium {statusTone}" aria-live="polite">
				{statusLabel}
			</span>
		</div>

		<section
			class="border-b border-[oklch(0.27_0.014_55)] px-4 py-3"
			aria-labelledby="diagnostics-playback"
		>
			<h3 id="diagnostics-playback" class="text-xs font-medium">
				{m.video_editor_diagnostics_playback()}
			</h3>
			<dl class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-xs">
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_frame_time()}</dt>
				<dd class="font-mono tabular-nums">{formatMs(snapshot.frameTimeEmaMs)}</dd>
				<dt class="text-[var(--video-editor-muted)]">
					{m.video_editor_diagnostics_frame_budget()}
				</dt>
				<dd class="font-mono tabular-nums">{formatMs(snapshot.frameBudgetMs)}</dd>
				<dt class="text-[var(--video-editor-muted)]">
					{m.video_editor_diagnostics_skipped_frames()}
				</dt>
				<dd class="font-mono tabular-nums">{snapshot.skippedFrames}</dd>
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_quality()}</dt>
				<dd class="font-mono tabular-nums">
					{snapshot.qualityMode === 'auto'
						? m.video_editor_quality_auto()
						: m.video_editor_quality_full()}
					{Math.round(snapshot.qualityScale * 100)}%
				</dd>
			</dl>
		</section>

		<section
			class="border-b border-[oklch(0.27_0.014_55)] px-4 py-3"
			aria-labelledby="diagnostics-renderer"
		>
			<h3 id="diagnostics-renderer" class="text-xs font-medium">
				{m.video_editor_diagnostics_renderer()}
			</h3>
			<dl class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-xs">
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_path()}</dt>
				<dd>{rendererLabel}</dd>
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_render_time()}</dt>
				<dd class="font-mono tabular-nums">{formatMs(snapshot.renderTimeMs)}</dd>
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_canvas()}</dt>
				<dd class="font-mono tabular-nums">{snapshot.renderWidth}x{snapshot.renderHeight}</dd>
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_layers()}</dt>
				<dd class="font-mono tabular-nums">{snapshot.activeLayers}</dd>
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_gpu()}</dt>
				<dd class="max-w-48 text-right">{gpuLabel}</dd>
				<dt class="text-[var(--video-editor-muted)]">{m.video_editor_diagnostics_proxies()}</dt>
				<dd class="font-mono tabular-nums">
					{snapshot.readyProxies}
					{m.video_editor_diagnostics_ready()}
					{#if snapshot.pendingProxies > 0}
						/ {snapshot.pendingProxies} {m.video_editor_diagnostics_pending()}
					{/if}
				</dd>
			</dl>
			{#if snapshot.lastFallback}
				<p class="mt-2 rounded-md bg-red-950/40 px-2 py-1.5 text-xs text-red-200">
					{m.video_editor_diagnostics_fallback({ reason: snapshot.lastFallback })}
				</p>
			{/if}
		</section>

		<section
			class="border-b border-[oklch(0.27_0.014_55)] px-4 py-3"
			aria-labelledby="diagnostics-overlays"
		>
			<h3 id="diagnostics-overlays" class="text-xs font-medium">
				{m.video_editor_diagnostics_overlays()}
			</h3>
			<div class="mt-2 space-y-2">
				<button
					type="button"
					role="switch"
					aria-checked={previewDiagnostics.performanceOverlay}
					class="flex min-h-11 w-full items-center justify-between gap-4 rounded-md px-2 text-left text-xs hover:bg-[oklch(0.22_0.012_55)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] md:min-h-9"
					data-cuelume-toggle="toggle"
					onclick={() =>
						previewDiagnostics.setPerformanceOverlay(!previewDiagnostics.performanceOverlay)}
				>
					<span>{m.video_editor_diagnostics_performance_overlay()}</span>
					<span class="font-mono text-[var(--video-editor-muted)]">
						{previewDiagnostics.performanceOverlay
							? m.video_editor_status_enabled()
							: m.video_editor_status_disabled()}
					</span>
				</button>
				<button
					type="button"
					role="switch"
					aria-checked={previewDiagnostics.clipTimingOverlay}
					class="flex min-h-11 w-full items-center justify-between gap-4 rounded-md px-2 text-left text-xs hover:bg-[oklch(0.22_0.012_55)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] md:min-h-9"
					data-cuelume-toggle="toggle"
					onclick={() =>
						previewDiagnostics.setClipTimingOverlay(!previewDiagnostics.clipTimingOverlay)}
				>
					<span>{m.video_editor_diagnostics_clip_overlay()}</span>
					<span class="font-mono text-[var(--video-editor-muted)]">
						{previewDiagnostics.clipTimingOverlay
							? m.video_editor_status_enabled()
							: m.video_editor_status_disabled()}
					</span>
				</button>
			</div>
		</section>

		<div class="p-4">
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onclick={() => void copyReport()}>
					{#if copied}<ProtectedIcon icon="success" />{:else}<ThemeIcon role="copy" />{/if}
					{copied ? m.video_editor_diagnostics_copied() : m.video_editor_diagnostics_copy()}
				</Button>
				<Button size="sm" variant="ghost" onclick={() => previewDiagnostics.resetCounters()}>
					<ThemeIcon role="refresh" />
					{m.video_editor_diagnostics_reset()}
				</Button>
			</div>
			<p class="mt-3 text-[10px] leading-snug text-[var(--video-editor-muted)]">
				{m.video_editor_diagnostics_privacy_note()}
			</p>
			{#if copyError}
				<p class="mt-2 text-xs text-red-300" role="alert">
					{m.video_editor_diagnostics_copy_failed()}
				</p>
			{/if}
		</div>
	</Popover.Content>
</Popover.Root>
