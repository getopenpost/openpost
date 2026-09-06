<script lang="ts" module>
	import type { ThemeIconRole } from '$lib/themes/contracts';

	export interface ActionFace {
		id: string;
		label: string;
		icon?: ThemeIconRole;
		status?: 'loading' | 'success' | 'error';
	}
</script>

<script lang="ts">
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	let {
		faces,
		active,
		compact = false
	}: {
		faces: ActionFace[];
		active: string;
		compact?: boolean;
	} = $props();
</script>

<!-- All faces occupy one cell so translated state changes cannot move the action. -->
<span class="action-label" aria-hidden="true">
	{#each faces as face (face.id)}
		<span class="action-face" class:active={face.id === active}>
			{#if face.status || face.icon}
				<span class="size-3.5 shrink-0">
					{#if face.id === active}
						{#if face.status}
							<ProtectedIcon
								icon={face.status}
								class={`size-3.5 ${face.status === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`}
							/>
						{:else if face.icon}
							<ThemeIcon role={face.icon} class="size-3.5" />
						{/if}
					{/if}
				</span>
			{/if}
			<span class={compact ? 'max-sm:sr-only' : undefined}>{face.label}</span>
		</span>
	{/each}
</span>

<style>
	.action-label {
		display: inline-grid;
		place-items: center;
		grid-template-columns: minmax(0, 1fr);
		max-width: 100%;
		min-width: 0;
	}
	.action-face {
		grid-area: 1 / 1;
		min-width: 0;
		max-width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		white-space: nowrap;
		opacity: 0;
		transform: translateY(4px) scale(0.97);
		filter: blur(2px);
		pointer-events: none;
		transition:
			opacity var(--theme-duration-normal, 160ms) ease-out,
			transform var(--theme-duration-slow, 240ms) cubic-bezier(0.16, 1, 0.3, 1),
			filter var(--theme-duration-normal, 160ms) ease-out;
	}
	.action-face > span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.action-face.active {
		opacity: 1;
		transform: translateY(0) scale(1);
		filter: blur(0);
	}
	@media (prefers-reduced-motion: reduce) {
		.action-face {
			transition: none;
			transform: none;
			filter: none;
		}
	}
</style>
