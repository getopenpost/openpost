<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		mostConstrainedCharacterUsage,
		platformTextLength,
		type PlatformLimit
	} from '$lib/platform-limits';

	interface Props {
		content: string;
		limits: PlatformLimit[];
	}

	let { content, limits }: Props = $props();

	function editorCharacterUsage(value: string): { count: number; limit: number } {
		const usage = mostConstrainedCharacterUsage(value, limits);
		if (usage.limit === null) {
			throw new Error('Editor character usage requires at least one destination limit');
		}
		return usage;
	}

	function getCharCounterColor(count: number, max: number): string {
		const pct = count / max;
		if (pct >= 1) return 'text-red-500';
		if (pct >= 0.8) return 'text-amber-500';
		return 'text-muted-foreground';
	}

	function getCharCounterStrokeColor(count: number, max: number): string {
		const pct = count / max;
		if (pct >= 1) return '#ef4444';
		if (pct >= 0.8) return '#f59e0b';
		return 'currentColor';
	}
</script>

{#if limits.length > 0}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				{@const editorUsage = editorCharacterUsage(content)}
				<div {...props} class="flex cursor-default items-center gap-1.5">
					<svg
						class="h-4 w-4 {getCharCounterColor(editorUsage.count, editorUsage.limit)}"
						viewBox="0 0 20 20"
					>
						<circle
							cx="10"
							cy="10"
							r="8"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							opacity="0.15"
						/>
						<circle
							cx="10"
							cy="10"
							r="8"
							fill="none"
							stroke={getCharCounterStrokeColor(editorUsage.count, editorUsage.limit)}
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-dasharray={50.27}
							stroke-dashoffset={50.27 * Math.max(0, 1 - editorUsage.count / editorUsage.limit)}
							transform="rotate(-90 10 10)"
						/>
					</svg>
					<span class="text-xs text-muted-foreground tabular-nums"
						>{editorUsage.count}/{editorUsage.limit}</span
					>
				</div>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			<div class="space-y-1">
				<p class="text-xs font-medium text-muted-foreground">
					{m.compose_character_limits()}
				</p>
				{#each limits as pl (pl.key)}
					{@const platformCount = platformTextLength(pl.key, content)}
					<div class="flex items-center justify-between gap-2 text-xs">
						<div class="flex items-center gap-1.5">
							<PlatformIcon platform={pl.key} class="h-3 w-3" /><span>{pl.platform}</span>
						</div>
						<span
							class="tabular-nums {platformCount > pl.limit
								? 'text-red-500'
								: 'text-muted-foreground'}">{platformCount}/{pl.limit}</span
						>
					</div>
				{/each}
			</div>
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
