<script lang="ts">
	import { getLocaleTag } from '$lib/i18n';

	interface Props {
		primaryLabel: string;
		primaryValue: number;
		secondaryLabel: string;
		secondaryValue: number;
	}

	let { primaryLabel, primaryValue, secondaryLabel, secondaryValue }: Props = $props();

	function formatNumber(value: number) {
		return new Intl.NumberFormat(getLocaleTag()).format(value);
	}
</script>

<dl class="grid min-w-32 grid-cols-2 gap-3">
	<div>
		<dt class="text-[11px] text-muted-foreground">{primaryLabel}</dt>
		<dd class="mt-0.5 text-sm font-medium tabular-nums">{formatNumber(primaryValue)}</dd>
	</div>
	<div>
		<dt class="text-[11px] text-muted-foreground">{secondaryLabel}</dt>
		<dd class="mt-0.5 text-sm font-medium tabular-nums">{formatNumber(secondaryValue)}</dd>
	</div>
</dl>
