<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	let {
		value,
		options,
		onchange,
		id,
		label,
		disabled = false
	}: {
		value: string;
		options: { value: string; label: string }[];
		onchange: (value: string) => void;
		id?: string;
		label?: string;
		disabled?: boolean;
	} = $props();
</script>

<Select.Root {value} onValueChange={onchange} {disabled}>
	<Select.Trigger {id} aria-label={label} class="w-full min-w-0"
		><span class="truncate">{options.find((option) => option.value === value)?.label ?? value}</span
		></Select.Trigger
	>
	<Select.Content
		>{#each options as option (option.value)}<Select.Item value={option.value}
				>{option.label}</Select.Item
			>{/each}</Select.Content
	>
</Select.Root>
