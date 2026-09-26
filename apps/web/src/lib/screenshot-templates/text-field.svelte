<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	let {
		label,
		value,
		oninput,
		multiline = false,
		maxlength = 100
	}: {
		label: string;
		value: string;
		oninput: (value: string) => void;
		multiline?: boolean;
		maxlength?: number;
	} = $props();
	const id = $props.id();
</script>

<div class="space-y-1.5">
	<Label for={id}>{label}</Label>
	{#if multiline}<Textarea
			{id}
			{value}
			{maxlength}
			rows={3}
			oninput={(event) => oninput(event.currentTarget.value)}
		/>{:else}<Input
			{id}
			{value}
			{maxlength}
			oninput={(event) => oninput(event.currentTarget.value)}
		/>{/if}
</div>
