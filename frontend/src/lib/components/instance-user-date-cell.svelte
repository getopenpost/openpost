<script lang="ts">
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	let { value, includeTime = false }: { value: string; includeTime?: boolean } = $props();

	const formatted = $derived.by(() => {
		if (!value) return m.settings_never();
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return m.settings_never();
		return new Intl.DateTimeFormat(getLocaleTag(), {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {})
		}).format(date);
	});
</script>

{#if value}
	<time datetime={value} class="text-xs text-muted-foreground">{formatted}</time>
{:else}
	<span class="text-xs text-muted-foreground">{formatted}</span>
{/if}
