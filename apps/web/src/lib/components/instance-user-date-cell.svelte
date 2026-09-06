<script lang="ts">
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	let { value, includeTime = false }: { value: string; includeTime?: boolean } = $props();

	const formatted = $derived.by(() => {
		if (!value) return m.settings_never();
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return m.settings_never();
		const options: Intl.DateTimeFormatOptions = {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		};
		if (includeTime) {
			options.hour = 'numeric';
			options.minute = '2-digit';
		}
		return new Intl.DateTimeFormat(getLocaleTag(), options).format(date);
	});
</script>

{#if value}
	<time datetime={value} class="text-xs text-muted-foreground">{formatted}</time>
{:else}
	<span class="text-xs text-muted-foreground">{formatted}</span>
{/if}
