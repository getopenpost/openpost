<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { VoiceProfile, VoiceProfilesCopy } from '$lib/voice-profiles';

	interface Props {
		profiles: VoiceProfile[];
		assignments?: Record<string, string>;
		selectedProfileId?: string;
		copy: VoiceProfilesCopy;
		disabled?: boolean;
		createDisabled?: boolean;
		onSelect: (profile: VoiceProfile) => void;
		onCreate: () => void;
	}

	let {
		profiles,
		assignments = {},
		selectedProfileId = '',
		copy,
		disabled = false,
		createDisabled = false,
		onSelect,
		onCreate
	}: Props = $props();
</script>

<aside class="overflow-hidden rounded-lg border bg-card" aria-label={copy.profilesLabel}>
	<div class="flex items-center justify-between gap-2 border-b px-3 py-2.5">
		<h2 class="text-sm font-semibold">{copy.profilesHeading}</h2>
		<Button type="button" variant="ghost" size="sm" disabled={createDisabled} onclick={onCreate}>
			<PlusIcon class="size-3.5" />{copy.newProfile}
		</Button>
	</div>
	{#if profiles.length === 0}
		<div class="p-4 text-sm leading-6 text-muted-foreground">
			<p class="font-medium text-foreground">{copy.emptyTitle}</p>
			<p class="mt-1">{copy.emptyDescription}</p>
		</div>
	{:else}
		<div class="divide-y">
			{#each profiles as profile (profile.id)}
				{@const selected = profile.id === selectedProfileId}
				<button
					type="button"
					class={`flex min-h-16 w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 ${selected ? 'bg-primary/[0.06]' : ''}`}
					{disabled}
					onclick={() => onSelect(profile)}
					aria-current={selected ? 'true' : undefined}
				>
					<span
						class={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
					>
						{#if selected}<CheckIcon class="size-3.5" />{:else}{profile.name
								.slice(0, 1)
								.toUpperCase()}{/if}
					</span>
					<span class="min-w-0 flex-1">
						<span class="flex flex-wrap items-center gap-1.5">
							<span class="truncate text-sm font-medium">{profile.name}</span>
							{#if profile.isDefault}<Badge class="shadow-none">{copy.defaultBadge}</Badge>{/if}
						</span>
						<span class="mt-1 block text-xs text-muted-foreground">
							{copy.assignedCount(
								Object.values(assignments).filter((profileId) => profileId === profile.id).length
							)}
						</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</aside>
