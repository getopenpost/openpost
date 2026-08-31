<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		hasText: boolean;
		building: boolean;
		disabled: boolean;
		ideateLabel: string;
		buildLabel: string;
		buildingLabel: string;
		title?: string;
		onclick: () => void | Promise<void>;
	}

	let {
		hasText,
		building,
		disabled,
		ideateLabel,
		buildLabel,
		buildingLabel,
		title,
		onclick
	}: Props = $props();

	let ideateWidth = $state(0);
	let buildWidth = $state(0);
	let buildingWidth = $state(0);
	const activeLabel = $derived(building ? buildingLabel : hasText ? buildLabel : ideateLabel);
	const activeWidth = $derived(building ? buildingWidth : hasText ? buildWidth : ideateWidth);
</script>

<Button
	type="button"
	variant={hasText ? 'secondary' : 'default'}
	size="sm"
	class="ai-action-button ml-auto min-h-11 overflow-hidden p-0 md:min-h-8"
	style={activeWidth > 0 ? `width: ${activeWidth}px` : undefined}
	{disabled}
	{onclick}
	aria-label={activeLabel}
	aria-busy={building}
	{title}
	data-state={building ? 'building' : hasText ? 'build' : 'ideate'}
>
	<span class="invisible flex h-full w-max items-center gap-1.5 px-2.5" aria-hidden="true">
		{#if building}
			<LoaderIcon class="size-3.5" />
			{buildingLabel}
		{:else if hasText}
			<SparklesIcon class="size-3.5" />
			{buildLabel}
		{:else}
			<LightbulbIcon class="size-3.5" />
			{ideateLabel}
		{/if}
	</span>

	<span
		class="ai-action-track absolute inset-y-0 left-0 flex w-max"
		class:invisible={building}
		style:transform={`translateX(-${hasText ? ideateWidth : 0}px)`}
		aria-hidden="true"
	>
		<span
			class="flex h-full w-max items-center gap-1.5 px-2.5"
			bind:clientWidth={ideateWidth}
			data-ai-action-pill="ideate"
		>
			<LightbulbIcon class="size-3.5" />
			{ideateLabel}
		</span>
		<span
			class="flex h-full w-max items-center gap-1.5 px-2.5"
			bind:clientWidth={buildWidth}
			data-ai-action-pill="build"
		>
			<SparklesIcon class="size-3.5" />
			{buildLabel}
		</span>
	</span>

	<span
		class="invisible absolute inset-y-0 left-0 flex w-max items-center gap-1.5 px-2.5"
		bind:clientWidth={buildingWidth}
		aria-hidden="true"
	>
		<LoaderIcon class="size-3.5" />
		{buildingLabel}
	</span>

	{#if building}
		<span
			class="absolute inset-y-0 left-0 flex w-max items-center gap-1.5 px-2.5"
			aria-hidden="true"
		>
			<LoaderIcon class="size-3.5 animate-spin" />
			{buildingLabel}
		</span>
	{/if}
</Button>

<style>
	:global(.ai-action-button) {
		/* Keep semantic foreground and surface pairs atomic so their transition never loses contrast. */
		transition-property: width, transform, box-shadow;
		transition-duration: 400ms, 100ms, 140ms;
		transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1), ease-out, ease-out;
	}

	.ai-action-track {
		transition: transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.ai-action-button) {
			transition-duration: 0ms, 100ms, 140ms;
		}

		.ai-action-track {
			transition-duration: 0ms;
		}
	}
</style>
