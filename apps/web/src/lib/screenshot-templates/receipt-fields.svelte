<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AppSelect from '$lib/components/app-select.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import TextField from './text-field.svelte';
	import RowActions from './row-actions.svelte';
	import { moveRow, type Receipt } from './document';
	let { value, onchange }: { value: Receipt; onchange: (value: Receipt, key?: string) => void } =
		$props();
	const prefix = $props.id();
	const items = $derived(value.items ?? []);
	const currencies: Receipt['currency'][] = ['USD', 'EUR', 'GBP', 'BRL', 'JPY'];
	function patch(update: Partial<Receipt>, key?: string) {
		onchange({ ...value, ...update }, key);
	}
	function itemPatch(id: string, update: Partial<NonNullable<Receipt['items']>[number]>) {
		patch({ items: items.map((item) => (item.id === id ? { ...item, ...update } : item)) }, id);
	}
</script>

<div class="space-y-5">
	<TextField
		label={m.templates_business()}
		value={value.business}
		maxlength={150}
		oninput={(business) => patch({ business }, 'business')}
	/>
	<TextField
		label={m.templates_address()}
		value={value.address}
		maxlength={300}
		multiline
		oninput={(address) => patch({ address }, 'address')}
	/>
	<TextField
		label={m.templates_timestamp()}
		value={value.timestamp}
		oninput={(timestamp) => patch({ timestamp }, 'timestamp')}
	/>
	<TextField
		label={m.templates_order()}
		value={value.order}
		oninput={(order) => patch({ order }, 'order')}
	/>
	<div class="space-y-1.5">
		<Label for="{prefix}-currency">{m.templates_currency()}</Label><AppSelect
			id="{prefix}-currency"
			value={value.currency}
			options={currencies.map((value) => ({ value, label: value }))}
			onValueChange={(currency) => {
				const known = currencies.find((value) => value === currency);
				if (known) patch({ currency: known });
			}}
		/>
	</div>
	<div class="space-y-3">
		<h2 class="text-sm font-medium">{m.templates_items()}</h2>
		{#each items as item, index (item.id)}<div
				id="field-{item.id}"
				class="space-y-3 rounded-md border bg-card p-3"
			>
				<div class="flex items-center justify-between">
					<span class="text-xs text-muted-foreground">{index + 1}</span><RowActions
						{index}
						count={items.length}
						maximum={40}
						onmove={(direction) => patch({ items: moveRow(items, index, direction) })}
						onduplicate={() =>
							patch({
								items: [
									...items.slice(0, index + 1),
									{ ...item, id: crypto.randomUUID() },
									...items.slice(index + 1)
								]
							})}
						onremove={() => patch({ items: items.filter((row) => row.id !== item.id) })}
					/>
				</div>
				<TextField
					label={m.templates_item()}
					value={item.name}
					maxlength={200}
					oninput={(name) => itemPatch(item.id, { name })}
				/>
				<div class="grid grid-cols-2 gap-3">
					<div class="space-y-1.5">
						<Label for="{prefix}-{item.id}-qty">{m.templates_quantity()}</Label><Input
							id="{prefix}-{item.id}-qty"
							type="number"
							min={1}
							max={999}
							step={1}
							value={item.quantity}
							oninput={(e) => {
								const n = e.currentTarget.valueAsNumber;
								if (Number.isFinite(n))
									itemPatch(item.id, { quantity: Math.max(1, Math.min(999, Math.round(n))) });
							}}
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="{prefix}-{item.id}-price">{m.templates_price()}</Label><Input
							id="{prefix}-{item.id}-price"
							type="number"
							min={0}
							max={999999.99}
							step={0.01}
							value={item.amount_cents / 100}
							oninput={(e) => {
								const n = e.currentTarget.valueAsNumber;
								if (Number.isFinite(n))
									itemPatch(item.id, {
										amount_cents: Math.max(0, Math.min(99999999, Math.round(n * 100)))
									});
							}}
						/>
					</div>
				</div>
			</div>{/each}<Button
			variant="outline"
			class="w-full"
			disabled={items.length >= 40}
			onclick={() =>
				patch({
					items: [...items, { id: crypto.randomUUID(), name: '', quantity: 1, amount_cents: 0 }]
				})}><ThemeIcon role="add" class="size-4" />{m.templates_add_item()}</Button
		>
	</div>
	<div class="space-y-1.5">
		<Label for="{prefix}-tax">{m.templates_tax()}</Label><Input
			id="{prefix}-tax"
			type="number"
			min={0}
			max={100}
			step={0.01}
			value={value.tax_percent}
			oninput={(e) => {
				const n = e.currentTarget.valueAsNumber;
				if (Number.isFinite(n)) patch({ tax_percent: Math.max(0, Math.min(100, n)) }, 'tax');
			}}
		/>
	</div>
	<TextField
		label={m.templates_total_override()}
		value={value.custom_total}
		oninput={(custom_total) => patch({ custom_total }, 'custom-total')}
	/>
	<TextField
		label={m.templates_footer()}
		value={value.footer}
		maxlength={500}
		multiline
		oninput={(footer) => patch({ footer }, 'footer')}
	/>
</div>
