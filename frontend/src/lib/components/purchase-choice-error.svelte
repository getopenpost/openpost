<script lang="ts">
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import type { PurchaseChoiceErrorCode } from '$lib/purchase-choice';

	let { code, className = '' } = $props<{
		code: PurchaseChoiceErrorCode;
		className?: string;
	}>();

	const message = $derived.by(() => {
		switch (code) {
			case 'missing':
				return m.purchase_choice_missing();
			case 'invalid':
				return m.purchase_choice_invalid();
			case 'expired':
				return m.purchase_choice_expired();
			case 'mismatch':
				return m.purchase_choice_mismatch();
			default:
				return m.purchase_choice_unavailable();
		}
	});
</script>

<div class={className}>
	<InlineNotice tone="error" {message} />
	<Button href="https://openpost.social/pricing" variant="outline" class="mt-3 w-full">
		{m.purchase_choice_choose_again()}
	</Button>
</div>
