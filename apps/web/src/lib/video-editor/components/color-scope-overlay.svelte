<script lang="ts">
	import type { ColorScope } from '$lib/video-editor/effects/scope-cpu-renderer';

	const LUMA_GUIDES = [0, 25, 50, 75, 100] as const;
	const PARADE_CHANNELS = [
		{ label: 'R', left: '16.666%', className: 'text-red-300/90' },
		{ label: 'G', left: '50%', className: 'text-emerald-300/90' },
		{ label: 'B', left: '83.333%', className: 'text-blue-300/90' }
	] as const;
	const VECTOR_TARGETS = [
		{ label: 'R', x: 39, y: 16 },
		{ label: 'Mg', x: 66, y: 18 },
		{ label: 'B', x: 78, y: 55 },
		{ label: 'Cy', x: 61, y: 84 },
		{ label: 'G', x: 35, y: 78 },
		{ label: 'Yl', x: 22, y: 45 }
	] as const;

	let { scope }: { scope: ColorScope } = $props();
</script>

{#if scope === 'vectorscope'}
	<svg
		aria-hidden="true"
		data-scope-overlay="vectorscope"
		class="pointer-events-none absolute inset-0 size-full"
		preserveAspectRatio="xMidYMid meet"
		viewBox="0 0 100 100"
	>
		<circle cx="50" cy="50" r="45" fill="none" stroke="rgba(148, 163, 184, 0.24)" />
		<circle cx="50" cy="50" r="30" fill="none" stroke="rgba(148, 163, 184, 0.18)" />
		<circle cx="50" cy="50" r="15" fill="none" stroke="rgba(148, 163, 184, 0.12)" />
		<path d="M50 5 V95 M5 50 H95" stroke="rgba(148, 163, 184, 0.2)" stroke-width="0.8" />
		<path d="M50 50 L36 15" stroke="rgba(251, 191, 36, 0.72)" stroke-width="1.2" />
		<text
			x="33"
			y="13"
			fill="rgba(251, 191, 36, 0.9)"
			font-size="4"
			font-family="monospace"
			text-anchor="end"
		>
			skin
		</text>
		{#each VECTOR_TARGETS as target (target.label)}
			<g>
				<rect
					x={target.x - 3}
					y={target.y - 3}
					width="6"
					height="6"
					fill="none"
					stroke="rgba(226, 232, 240, 0.34)"
					stroke-width="0.8"
				/>
				<text
					x={target.x}
					y={target.y - 4.5}
					fill="rgba(226, 232, 240, 0.78)"
					font-size="4"
					font-family="monospace"
					text-anchor="middle"
				>
					{target.label}
				</text>
			</g>
		{/each}
	</svg>
{:else}
	<div aria-hidden="true" data-scope-overlay={scope} class="pointer-events-none absolute inset-0">
		{#each LUMA_GUIDES as level (level)}
			<div
				class="absolute right-0 left-0 border-t border-slate-400/20"
				style:top={`${100 - level}%`}
			>
				<span
					class="absolute left-1 -translate-y-1/2 rounded-sm bg-black/50 px-1 font-mono text-[9px] leading-4 text-slate-300/80"
				>
					{level}
				</span>
			</div>
		{/each}

		{#if scope === 'histogram'}
			<span class="absolute bottom-1 left-1 font-mono text-[9px] text-slate-400/80">0</span>
			<span class="absolute right-1 bottom-1 font-mono text-[9px] text-slate-400/80">255</span>
		{/if}

		{#if scope === 'parade'}
			<div class="absolute top-0 bottom-0 left-1/3 border-l border-slate-400/25"></div>
			<div class="absolute top-0 right-1/3 bottom-0 border-l border-slate-400/25"></div>
			{#each PARADE_CHANNELS as channel (channel.label)}
				<span
					class="absolute top-1 -translate-x-1/2 rounded-sm bg-black/50 px-1 font-mono text-[10px] leading-4 {channel.className}"
					style:left={channel.left}
				>
					{channel.label}
				</span>
			{/each}
		{/if}
	</div>
{/if}
