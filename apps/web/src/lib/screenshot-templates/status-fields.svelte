<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import AppSelect from '$lib/components/app-select.svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	import TextField from './text-field.svelte';
	import RowActions from './row-actions.svelte';
	import { moveRow, type StatusPage } from './document';
	let {
		value,
		onchange
	}: { value: StatusPage; onchange: (value: StatusPage, key?: string) => void } = $props();
	const prefix = $props.id();
	const updates = $derived(value.updates ?? []);
	function patch(update: Partial<StatusPage>, key?: string) {
		onchange({ ...value, ...update }, key);
	}
	function updatePatch(id: string, update: Partial<NonNullable<StatusPage['updates']>[number]>) {
		patch({ updates: updates.map((row) => (row.id === id ? { ...row, ...update } : row)) }, id);
	}
</script>

<div class="space-y-5">
	<TextField
		label={m.templates_service()}
		value={value.name}
		maxlength={150}
		oninput={(name) => patch({ name }, 'name')}
	/>
	<TextField
		label={m.templates_headline()}
		value={value.headline}
		maxlength={200}
		oninput={(headline) => patch({ headline }, 'headline')}
	/>
	<div class="space-y-1.5">
		<Label for="{prefix}-severity">{m.templates_severity()}</Label><AppSelect
			id="{prefix}-severity"
			value={value.severity}
			options={[
				{ value: 'operational', label: m.templates_operational() },
				{ value: 'degraded', label: m.templates_degraded() },
				{ value: 'outage', label: m.templates_outage() }
			]}
			onValueChange={(severity) => {
				if (severity === 'operational' || severity === 'degraded' || severity === 'outage')
					patch({ severity });
			}}
		/>
	</div>
	<div class="space-y-3">
		<h2 class="text-sm font-medium">{m.templates_updates()}</h2>
		{#each updates as update, index (update.id)}<div
				id="field-{update.id}"
				class="space-y-3 rounded-md border bg-card p-3"
			>
				<div class="flex items-center justify-between">
					<span class="text-xs text-muted-foreground">{index + 1}</span><RowActions
						{index}
						count={updates.length}
						maximum={30}
						onmove={(direction) => patch({ updates: moveRow(updates, index, direction) })}
						onduplicate={() =>
							patch({
								updates: [
									...updates.slice(0, index + 1),
									{ ...update, id: crypto.randomUUID() },
									...updates.slice(index + 1)
								]
							})}
						onremove={() => patch({ updates: updates.filter((row) => row.id !== update.id) })}
					/>
				</div>
				<TextField
					label={m.templates_stage()}
					value={update.stage}
					maxlength={80}
					oninput={(stage) => updatePatch(update.id, { stage })}
				/>
				<TextField
					label={m.templates_update()}
					value={update.text}
					maxlength={2000}
					multiline
					oninput={(text) => updatePatch(update.id, { text })}
				/>
				<TextField
					label={m.templates_timestamp()}
					value={update.timestamp}
					oninput={(timestamp) => updatePatch(update.id, { timestamp })}
				/>
			</div>{/each}<Button
			variant="outline"
			class="w-full"
			disabled={updates.length >= 30}
			onclick={() =>
				patch({
					updates: [
						...updates,
						{ id: crypto.randomUUID(), stage: 'Update', text: '', timestamp: '' }
					]
				})}><ThemeIcon role="add" class="size-4" />{m.templates_add_update()}</Button
		>
	</div>
</div>
