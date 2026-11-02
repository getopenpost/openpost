<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import * as Select from '$lib/components/ui/select';
	import Disclosure from '$lib/components/disclosure.svelte';
	import { m } from '$lib/paraglide/messages';
	import {
		getSettingsDestinations,
		type SettingsDestination,
		type SettingsDestinationID,
		type SettingsDestinationGroup
	} from '$lib/settings-navigation';

	interface Props {
		active: SettingsDestinationID;
		showInstance?: boolean;
		showHostedBilling?: boolean;
	}

	let { active, showInstance = false, showHostedBilling = true }: Props = $props();

	const allDestinations = $derived(getSettingsDestinations(showInstance, {}, showHostedBilling));
	const activeDestination = $derived(
		allDestinations.find((destination) => destination.id === active) ?? allDestinations[0]
	);
	const activeLabel = $derived(activeDestination?.label ?? m.settings_general());
	const visibleGroups = $derived(
		(
			[
				{ id: 'you', label: m.settings_group_you() },
				{ id: 'workspace', label: m.settings_workspace() },
				{ id: 'plan', label: m.settings_group_plan() },
				{ id: 'advanced', label: m.settings_group_advanced() }
			] as const
		)
			.map((group) => ({
				...group,
				destinations: destinationsInGroup(group.id)
			}))
			.filter((group) => group.destinations.length > 0)
	);

	function destinationsInGroup(group: SettingsDestinationGroup) {
		return allDestinations.filter((destination) => destination.group === group);
	}

	function destinationHref(destination: SettingsDestinationID): string {
		return `/settings?tab=${destination}`;
	}

	function openDestination(destination: SettingsDestinationID) {
		void goto(resolveAppPath(destinationHref(destination)));
	}
</script>

{#snippet destinationLink(destination: SettingsDestination)}
	<a
		href={resolveAppPath(destinationHref(destination.id))}
		data-settings-tab={destination.id}
		data-cuelume-toggle="toggle"
		class={[
			'flex min-h-10 items-center rounded-md px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:min-h-11',
			active === destination.id
				? 'bg-navigation-active text-navigation-active-foreground'
				: 'text-muted-foreground hover:bg-navigation-hover hover:text-foreground'
		]}
		aria-current={active === destination.id ? 'page' : undefined}
	>
		{destination.label}
	</a>
{/snippet}

<div class="min-w-0" data-testid="settings-navigation">
	<div class="lg:hidden">
		<Select.Root
			type="single"
			value={active}
			onValueChange={(value) => value && openDestination(value as SettingsDestinationID)}
		>
			<Select.Trigger class="min-h-11 w-full" aria-label={m.settings_nav_label()}>
				{activeLabel}
			</Select.Trigger>
			<Select.Content>
				{#each visibleGroups as group, index (group.id)}
					{#if index > 0}<Select.Separator />{/if}
					<Select.Group>
						<Select.GroupHeading>{group.label}</Select.GroupHeading>
						{#each group.destinations as destination (destination.id)}
							<Select.Item value={destination.id}>{destination.label}</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<nav class="hidden lg:block" aria-label={m.settings_groups_label()}>
		{#each visibleGroups as group (group.id)}
			<div class="mb-5 last:mb-0">
				{#if group.id === 'advanced'}
					<Disclosure
						summary={group.label}
						open={activeDestination?.group === 'advanced'}
						summaryClass="mb-1 min-h-9 rounded-md px-3 text-xs text-muted-foreground hover:bg-navigation-hover"
					>
						<div class="space-y-0.5">
							{#each group.destinations as destination (destination.id)}
								{@render destinationLink(destination)}
							{/each}
						</div>
					</Disclosure>
				{:else}
					<p class="mb-1 px-3 text-xs font-medium text-muted-foreground">{group.label}</p>
					<div class="space-y-0.5">
						{#each group.destinations as destination (destination.id)}
							{@render destinationLink(destination)}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</nav>
</div>
