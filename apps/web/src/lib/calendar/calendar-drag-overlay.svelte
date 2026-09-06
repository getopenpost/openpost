<script lang="ts">
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import type { WeekCalendarTarget } from './calendar-drag';

	type DragAccount = {
		id: string;
		platform: string;
		label: string;
	};

	let {
		title,
		accounts,
		target,
		targetLabel,
		width,
		height,
		overlayElement = $bindable()
	}: {
		title: string;
		accounts: DragAccount[];
		target: WeekCalendarTarget | null;
		targetLabel: string;
		width: number;
		height: number;
		overlayElement?: HTMLDivElement;
	} = $props();
</script>

{#if target}
	<div
		class="calendar-drag-placeholder"
		style={`left:${target.left}px;top:${target.top}px;width:${target.width}px;height:${target.height}px;`}
		aria-hidden="true"
	></div>
{/if}

<div
	bind:this={overlayElement}
	class="calendar-drag-overlay"
	style={`width:${width}px;height:${height}px;`}
	aria-hidden="true"
>
	<div class="calendar-drag-card">
		<div class="truncate text-sm font-semibold tracking-[-0.01em] tabular-nums">
			{targetLabel}
		</div>
		<div class="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
			{#if accounts.length > 0}
				<span class="flex shrink-0 items-center -space-x-1">
					{#each accounts.slice(0, 3) as account (account.id)}
						<span
							class="flex size-5 items-center justify-center rounded-full border border-border bg-background ring-1 ring-background"
							title={`${account.label}`}
						>
							<PlatformIcon platform={account.platform} class="size-3" />
						</span>
					{/each}
				</span>
			{/if}
			<span class="min-w-0 truncate">{title}</span>
		</div>
	</div>
</div>

<style>
	.calendar-drag-placeholder {
		position: fixed;
		z-index: 80;
		pointer-events: none;
		border: 1.5px dashed color-mix(in oklch, var(--primary) 58%, var(--border));
		border-radius: var(--radius-md);
		background: color-mix(in oklch, var(--primary) 9%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--background) 38%, transparent);
		transition:
			opacity 100ms ease,
			transform 100ms ease;
	}

	.calendar-drag-overlay {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 100;
		pointer-events: none;
		transform-origin: center;
		will-change: transform;
	}

	.calendar-drag-card {
		display: flex;
		height: 100%;
		width: 100%;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: color-mix(in oklch, var(--popover) 97%, transparent);
		padding: 0.625rem 0.75rem;
		color: var(--popover-foreground);
		box-shadow:
			0 18px 42px -16px color-mix(in oklch, var(--foreground) 30%, transparent),
			0 5px 14px -8px color-mix(in oklch, var(--foreground) 22%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.calendar-drag-placeholder {
			transition: opacity 80ms linear;
		}
	}
</style>
