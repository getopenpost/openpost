<script lang="ts">
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import SquarePenIcon from '@lucide/svelte/icons/square-pen';
	import * as Tabs from '$lib/components/ui/tabs';
	import type { PostBuilderCopy, PostBuilderCreationMode } from '$lib/post-builder';

	interface Props {
		value: PostBuilderCreationMode;
		copy: PostBuilderCopy;
		builderEnabled?: boolean;
		disabled?: boolean;
		onChange: (mode: PostBuilderCreationMode) => void;
	}

	let { value, copy, builderEnabled = true, disabled = false, onChange }: Props = $props();

	function changeMode(next: string): void {
		if (next === 'builder' && builderEnabled) onChange('builder');
		if (next === 'manual') onChange('manual');
	}
</script>

{#if builderEnabled}
	<Tabs.Root {value} onValueChange={changeMode} aria-label={copy.creationModeLabel}>
		<Tabs.List class="grid w-64 grid-cols-2">
			<Tabs.Trigger value="builder" {disabled}>
				<SparklesIcon class="size-3.5" />
				{copy.builderMode}
			</Tabs.Trigger>
			<Tabs.Trigger value="manual" {disabled}>
				<SquarePenIcon class="size-3.5" />
				{copy.manualMode}
			</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>
{/if}
