<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { m } from '$lib/paraglide/messages';

	let { planIDs }: { planIDs: string[] | null } = $props();

	function planName(planID: string) {
		if (planID === 'starter') return m.settings_plan_starter();
		if (planID === 'founder') return m.settings_plan_founder();
		if (planID === 'pro') return m.settings_plan_pro();
		if (planID === 'team') return m.settings_plan_team();
		if (planID === 'agency') return m.settings_plan_agency();
		if (planID === 'selfhost') return m.settings_instance_plan_self_hosted();
		return planID;
	}
</script>

{#if planIDs?.length}
	<div class="flex max-w-48 flex-wrap gap-1">
		{#each planIDs as planID (planID)}
			<Badge class="border-primary/15 bg-primary/10 text-primary">{planName(planID)}</Badge>
		{/each}
	</div>
{:else}
	<span class="text-xs text-muted-foreground">{m.settings_no_active_plan()}</span>
{/if}
