<script lang="ts" module>
	export interface AppSelectOption {
		value: string;
		label: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import * as Select from '$lib/components/ui/select';

	interface Props {
		value?: string;
		options: AppSelectOption[];
		placeholder?: string;
		id?: string;
		ariaLabel?: string;
		disabled?: boolean;
		class?: string;
		contentClass?: string;
		onValueChange?: (value: string) => void;
	}

	let {
		value = $bindable(''),
		options,
		placeholder = '',
		id,
		ariaLabel,
		disabled = false,
		class: className = 'w-full',
		contentClass,
		onValueChange
	}: Props = $props();

	const selectedLabel = $derived(
		options.find((option) => option.value === value)?.label ?? placeholder
	);
</script>

<Select.Root
	type="single"
	{value}
	{disabled}
	onValueChange={(nextValue) => {
		value = nextValue;
		onValueChange?.(nextValue);
	}}
>
	<Select.Trigger {id} class={className} aria-label={ariaLabel}>
		<span class="truncate">{selectedLabel}</span>
	</Select.Trigger>
	<Select.Content class={contentClass}>
		{#each options as option (option.value)}
			<Select.Item value={option.value} disabled={option.disabled}>{option.label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
