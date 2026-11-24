<!-- Composite-composition picker shared by the timeline header and empty state. -->
<script lang="ts">
	import * as Select from '$lib/components/ui/select';

	let {
		compositions,
		value,
		label,
		triggerId,
		testId,
		triggerClass,
		ariaLabel,
		onswitch
	}: {
		compositions: readonly { id: string; name: string }[];
		value: string;
		/** Text shown in the closed trigger. */
		label: string;
		triggerId: string;
		testId: string;
		triggerClass?: string;
		ariaLabel?: string;
		onswitch: (compositionId: string) => void;
	} = $props();
</script>

<Select.Root type="single" {value} onValueChange={(next) => next && onswitch(next)}>
	<Select.Trigger id={triggerId} class={triggerClass} aria-label={ariaLabel} data-testid={testId}>
		<span class="truncate">{label}</span>
	</Select.Trigger>
	<Select.Content>
		{#each compositions as comp (comp.id)}
			<Select.Item value={comp.id}>{comp.name}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
