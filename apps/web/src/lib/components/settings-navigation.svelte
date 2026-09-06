<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import * as Select from '$lib/components/ui/select';
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
	}

	let { active, showInstance = false }: Props = $props();

	const allDestinations = $derived(getSettingsDestinations(showInstance));
	const activeDestination = $derived(
		allDestinations.find((destination) => destination.id === active) ?? allDestinations[0]
	);
	const activeGroup = $derived(activeDestination?.group ?? 'workspace');
	const activeLabel = $derived(activeDestination?.label ?? m.settings_general());
	const visibleGroups = $derived(
		(
			[
				{ id: 'personal', label: m.settings_personal() },
				{ id: 'workspace', label: m.settings_workspace() },
				{ id: 'organization', label: m.settings_organization() },
				...(showInstance ? [{ id: 'instance', label: m.settings_instance() } as const] : [])
			] as const
		).map((group) => ({
			...group,
			destinations: destinationsInGroup(group.id)
		}))
	);
	const activeGroupDestinations = $derived(destinationsInGroup(activeGroup));

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
			'flex min-h-10 items-center rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			active === destination.id
				? 'bg-accent text-foreground'
				: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
		]}
		aria-current={active === destination.id ? 'page' : undefined}
	>
		{destination.label}
	</a>
{/snippet}

<div class="min-w-0" data-testid="settings-navigation">
	<div class="md:hidden">
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

	<div class="hidden md:block">
		<nav class="flex min-h-11 gap-1 border-b" aria-label={m.settings_groups_label()}>
			{#each visibleGroups as group (group.id)}
				<a
					href={resolveAppPath(destinationHref(group.destinations[0].id))}
					data-cuelume-toggle="toggle"
					class={[
						'relative flex min-h-11 items-center px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
						activeGroup === group.id
							? 'text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
							: 'text-muted-foreground hover:text-foreground'
					]}
					aria-current={activeGroup === group.id ? 'true' : undefined}
				>
					{group.label}
				</a>
			{/each}
		</nav>
		<nav class="flex flex-wrap gap-1 pt-3" aria-label={m.settings_pages_label()}>
			{#each activeGroupDestinations as destination (destination.id)}
				{@render destinationLink(destination)}
			{/each}
		</nav>
	</div>
</div>
