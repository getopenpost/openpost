<script lang="ts">
	import NumberFlow from '@number-flow/svelte';
	import { getLocaleTag } from '$lib/i18n';

	let { value, locale = getLocaleTag() }: { value: number | null; locale?: string } = $props();
	const format = {
		notation: 'compact',
		maximumFractionDigits: 1
	} satisfies Intl.NumberFormatOptions;
	const label = $derived(value === null ? '' : new Intl.NumberFormat(locale, format).format(value));
</script>

{#if value === null}
	<span>—</span>
{:else}
	<NumberFlow
		{value}
		{format}
		locales={locale}
		role="img"
		aria-label={label}
		transformTiming={{ duration: 300, easing: 'ease-out' }}
		opacityTiming={{ duration: 150, easing: 'ease-out' }}
	/>
{/if}
