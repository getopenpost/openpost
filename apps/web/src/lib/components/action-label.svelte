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
	import { TextMorph } from 'torph/svelte';
	import { onMount } from 'svelte';
	import { getLocaleTag } from '$lib/i18n';

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	let {
		faces,
		active,
		compact = false
	}: {
		faces: ActionFace[];
		active: string;
		compact?: boolean;
	} = $props();
	const current = $derived(faces.find((face) => face.id === active));
</script>

<!-- All faces occupy one cell so translated state changes cannot move the action. -->
<span class="action-label" aria-hidden="true">
	{#each faces as face (face.id)}
		<span class="action-face sizing-face">
			{#if face.status || face.icon}<span class="size-3.5 shrink-0"></span>{/if}
			<span class={compact ? 'max-sm:sr-only' : undefined}>{face.label}</span>
		</span>
	{/each}
	{#if current}
		{@const face = current}
		<span class="action-face">
			{#if face.status || face.icon}
				<span class="size-3.5 shrink-0">
					{#if face.status}
						<ProtectedIcon
							icon={face.status}
							class={`size-3.5 ${face.status === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`}
						/>
					{:else if face.icon}
						<ThemeIcon role={face.icon} class="size-3.5" />
					{/if}
				</span>
			{/if}
			<span class={compact ? 'max-sm:sr-only' : undefined}>
				{#if mounted}
					<TextMorph
						text={face.label}
						as="span"
						duration={200}
						scale={false}
						locale={getLocaleTag()}
					/>
				{:else}{face.label}{/if}
			</span>
		</span>
	{/if}
</span>

<style>
	.action-label {
		position: relative;
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
		pointer-events: none;
	}
	.action-face > span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sizing-face {
		visibility: hidden;
	}
	/* Only the reserved faces size the control, never Torph's transient width. */
	.action-face:not(.sizing-face) {
		position: absolute;
		inset: 0;
	}
</style>
