<script lang="ts">
	import { tick } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import { formatTimecode, parseTimecode } from '../model';
	let {
		value,
		duration,
		disabled = false,
		'aria-label': label,
		onCommit
	}: {
		value: number;
		duration: number;
		disabled?: boolean;
		'aria-label': string;
		onCommit: (value: number) => void;
	} = $props();
	let draft = $state('');
	let error = $state(false);
	const errorId = $props.id();
	$effect(() => {
		draft = formatTimecode(value);
		error = false;
	});
	async function commit() {
		const parsed = parseTimecode(draft);
		error = parsed === null;
		if (parsed !== null) {
			const clamped = Math.max(0, Math.min(duration, parsed));
			if (clamped !== value) onCommit(clamped);
		}
		await tick();
		draft = formatTimecode(value);
	}
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void commit();
			return;
		}
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		draft = formatTimecode(value);
		error = false;
	}
</script>

<Input
	{disabled}
	type="text"
	inputmode="decimal"
	bind:value={draft}
	aria-label={label}
	aria-describedby={error ? errorId : undefined}
	onchange={commit}
	onkeydown={handleKeydown}
	oninput={() => (error = false)}
	class="h-7 min-h-7 min-w-0 font-mono text-xs tabular-nums [@media(pointer:coarse)]:min-h-11"
/>
{#if error}<span id={errorId} role="status" class="text-xs text-muted-foreground"
		>{m.quick_cut_time_invalid()}</span
	>{/if}
