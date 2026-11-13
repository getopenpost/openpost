<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import * as Select from '$lib/components/ui/select';
	import Disclosure from '$lib/components/disclosure.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';
	import type { ThemeIconRole } from '$lib/themes';
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

	const destinationIcons: Partial<Record<SettingsDestinationID, ThemeIconRole>> = {
		profile: 'user',
		notifications: 'notification',
		security: 'security',
		developer: 'code',
		general: 'settings',
		brand: 'image',
		schedule: 'time',
		members: 'users',
		plan: 'billing',
		appearance: 'appearance',
		sso: 'key',
		audit: 'history',
		ownership: 'organization',
		instance: 'storage',
		configuration: 'controls',
		'ai-prompts': 'sparkles',
		users: 'users',
		'instance-audit': 'history'
	};

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
			'flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:min-h-11',
			active === destination.id
				? 'bg-navigation-active font-medium text-navigation-active-foreground'
				: 'text-muted-foreground hover:bg-navigation-hover hover:text-foreground'
		]}
		aria-current={active === destination.id ? 'page' : undefined}
	>
		<ThemeIcon role={destinationIcons[destination.id] ?? 'settings'} class="size-4 shrink-0" />
		<span class="min-w-0 truncate">{destination.label}</span>
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
		{#each visibleGroups as group, index (group.id)}
			<div class={index > 0 ? 'mt-4 border-t pt-4' : ''}>
				{#if group.id === 'advanced'}
					<Disclosure
						summary={group.label}
						open={activeDestination?.group === 'advanced'}
						summaryClass="min-h-8 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-navigation-hover"
					>
						<div class="space-y-0.5">
							{#each group.destinations as destination (destination.id)}
								{@render destinationLink(destination)}
							{/each}
						</div>
					</Disclosure>
				{:else}
					{#if group.destinations.length > 1}
						<p class="mb-1 px-2.5 text-xs font-medium text-muted-foreground/80">{group.label}</p>
					{/if}
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
