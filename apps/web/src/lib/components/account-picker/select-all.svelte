<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { m } from '$lib/paraglide/messages';

	/**
	 * One select-all header for account pickers whose contract supports
	 * all/subset/none (e.g. the composer destination list, repost targets).
	 * Pickers where an empty list means "any" keep their own any-source
	 * checkbox; they adopt the row only.
	 */
	interface Props {
		selectedCount: number;
		totalCount: number;
		onSelectAll: () => void;
		onClearAll: () => void;
		disabled?: boolean;
		checkboxLabel?: string;
	}

	let {
		selectedCount,
		totalCount,
		onSelectAll,
		onClearAll,
		disabled = false,
		checkboxLabel = m.media_select_all()
	}: Props = $props();

	const selectionDisabled = $derived(disabled || totalCount === 0);
	const allSelected = $derived(totalCount > 0 && selectedCount >= totalCount);
	const partiallySelected = $derived(selectedCount > 0 && selectedCount < totalCount);

	function toggle() {
		if (allSelected) onClearAll();
		else onSelectAll();
	}
</script>

<label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
	<Checkbox
		checked={allSelected}
		indeterminate={partiallySelected}
		disabled={selectionDisabled}
		aria-label={checkboxLabel}
		onCheckedChange={toggle}
	/>
	<span>{checkboxLabel}</span>
</label>
