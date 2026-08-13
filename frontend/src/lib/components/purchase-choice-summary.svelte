<script lang="ts">
	import type { PurchaseChoice } from '$lib/purchase-choice';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import CheckIcon from '@lucide/svelte/icons/check';

	let { choice, changeHref = 'https://openpost.social/pricing' } = $props<{
		choice: PurchaseChoice;
		changeHref?: string;
	}>();

	const price = $derived(
		new Intl.NumberFormat(getLocaleTag(), {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0
		}).format(choice.list_price_usd)
	);
	const dueToday = $derived(
		new Intl.NumberFormat(getLocaleTag(), {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: 0
		}).format(choice.due_today_usd)
	);
	const period = $derived(
		choice.billing_period === 'annual'
			? m.purchase_choice_per_year()
			: m.purchase_choice_per_month()
	);

	function externalHref(href: string) {
		return { href } as const;
	}
</script>

<section class="rounded-lg border bg-muted/20 p-4" aria-labelledby="purchase-choice-title">
	<div class="flex items-start justify-between gap-4">
		<div>
			<p
				id="purchase-choice-title"
				class="text-xs font-medium tracking-wide text-muted-foreground uppercase"
			>
				{m.purchase_choice_heading()}
			</p>
			<p class="mt-1 font-semibold">OpenPost {choice.plan_name}</p>
			<p class="text-sm text-muted-foreground">{price}{period}</p>
		</div>
		<a
			class="text-sm font-medium text-primary underline-offset-4 hover:underline"
			{...externalHref(changeHref)}
		>
			{m.purchase_choice_change()}
		</a>
	</div>
	<ul class="mt-4 grid gap-2 text-sm text-muted-foreground">
		<li class="flex items-start gap-2">
			<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
			<span>{m.purchase_choice_trial({ days: choice.trial_days })}</span>
		</li>
		<li class="flex items-start gap-2">
			<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
			<span>
				{choice.card_required
					? m.purchase_choice_payment_expectation({ amount: dueToday })
					: m.purchase_choice_payment_expectation_no_card({ amount: dueToday })}
			</span>
		</li>
		<li class="flex items-start gap-2">
			<CheckIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
			<span>{m.purchase_choice_after_trial({ price, period })}</span>
		</li>
	</ul>
</section>
