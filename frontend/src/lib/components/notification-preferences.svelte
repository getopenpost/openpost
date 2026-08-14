<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import {
		criticalInAppTopics,
		immediateEmailTopics,
		notificationTopicDescription,
		notificationTopicGroups,
		notificationTopicLabel,
		transactionalEmailTopics,
		type NotificationTopic
	} from '$lib/notification-topics';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';

	type ChannelPreference = components['schemas']['ChannelPreference'];
	type Preferences = Record<string, ChannelPreference>;
	type EmailFrequency = 'off' | 'immediate' | 'daily';

	const eventGroups = $derived(notificationTopicGroups());

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let preferences = $state.raw<Preferences>({});
	let savedSnapshot = $state('');
	let emailAvailable = $state(false);
	let emailAddress = $state('');
	let digestTime = $state('09:00');
	let digestTimezone = $state('UTC');
	const dirty = $derived(
		JSON.stringify({ preferences, digest_time: digestTime, digest_timezone: digestTimezone }) !==
			savedSnapshot
	);

	onMount(() => void load());

	async function load() {
		loading = true;
		error = '';
		const { data, error: apiError } = await client.GET('/notifications/preferences');
		if (apiError || !data) {
			error = apiError?.detail || m.notifications_preferences_load_failed();
			loading = false;
			return;
		}
		preferences = data.preferences;
		digestTime = data.digest_configured ? data.digest_time : '09:00';
		digestTimezone = data.digest_configured
			? data.digest_timezone
			: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
		savedSnapshot = JSON.stringify({
			preferences: data.preferences,
			digest_time: digestTime,
			digest_timezone: digestTimezone
		});
		emailAvailable = data.email_available;
		emailAddress = data.email_address;
		loading = false;
	}

	function preferenceFor(eventType: NotificationTopic): ChannelPreference {
		return (
			preferences[eventType] ?? {
				in_app: true,
				email_frequency: immediateEmailTopics.has(eventType) ? 'immediate' : 'off'
			}
		);
	}

	function updateInApp(eventType: NotificationTopic, enabled: boolean) {
		preferences = {
			...preferences,
			[eventType]: { ...preferenceFor(eventType), in_app: enabled }
		};
	}

	function updateEmailFrequency(eventType: NotificationTopic, frequency: string | undefined) {
		if (!frequency) return;
		preferences = {
			...preferences,
			[eventType]: {
				...preferenceFor(eventType),
				email_frequency: frequency as EmailFrequency
			}
		};
	}

	async function save() {
		saving = true;
		const { data, error: apiError } = await client.PUT('/notifications/preferences', {
			body: {
				preferences,
				digest_time: digestTime,
				digest_timezone: digestTimezone
			}
		});
		saving = false;
		if (apiError || !data) {
			showToast(
				apiError?.status === 400
					? m.notifications_preferences_invalid()
					: m.notifications_preferences_save_failed(),
				'error'
			);
			return;
		}
		preferences = data.preferences;
		digestTime = data.digest_time;
		digestTimezone = data.digest_timezone;
		savedSnapshot = JSON.stringify({
			preferences: data.preferences,
			digest_time: data.digest_time,
			digest_timezone: data.digest_timezone
		});
		emailAvailable = data.email_available;
		emailAddress = data.email_address;
		showToast(m.notifications_preferences_saved(), 'success');
	}

	function frequencyLabel(frequency: string) {
		if (frequency === 'daily') return m.notifications_email_frequency_daily();
		if (frequency === 'immediate') return m.notifications_email_frequency_immediate();
		return m.notifications_email_frequency_off();
	}
</script>

{#snippet emailFrequencyControl(
	eventType: NotificationTopic,
	preference: ChannelPreference,
	triggerClass: string
)}
	<Select.Root
		type="single"
		value={preference.email_frequency}
		disabled={!emailAvailable || transactionalEmailTopics.has(eventType)}
		onValueChange={(value) => updateEmailFrequency(eventType, value)}
	>
		<Select.Trigger
			class={triggerClass}
			aria-label={`${notificationTopicLabel(eventType)} · ${m.notifications_email_frequency()}`}
		>
			{frequencyLabel(preference.email_frequency)}
		</Select.Trigger>
		<Select.Content>
			<Select.Item value="off">{m.notifications_email_frequency_off()}</Select.Item>
			<Select.Item value="immediate">{m.notifications_email_frequency_immediate()}</Select.Item>
			<Select.Item value="daily">{m.notifications_email_frequency_daily()}</Select.Item>
		</Select.Content>
	</Select.Root>
{/snippet}

{#if loading}
	<PageLoading layout="list" label={m.common_loading()} items={5} />
{:else if error}
	<InlineNotice tone="error" message={error}>
		{#snippet actions()}
			<Button variant="outline" size="sm" onclick={() => void load()}>{m.common_retry()}</Button>
		{/snippet}
	</InlineNotice>
{:else}
	<div class="space-y-6">
		<SectionHeader
			title={m.notifications_delivery_heading()}
			description={m.notifications_delivery_description()}
			icon={BellRingIcon}
		/>

		{#if emailAvailable}
			<p class="text-sm text-muted-foreground">
				{m.notifications_email_recipient({ email: emailAddress })}
			</p>
		{:else}
			<InlineNotice tone="warning" message={m.notifications_email_unavailable()} />
		{/if}

		<div class="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
			<div class="space-y-2">
				<label class="text-sm font-medium" for="notification-digest-time">
					{m.notifications_digest_time()}
				</label>
				<Input id="notification-digest-time" bind:value={digestTime} type="time" required />
			</div>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="notification-digest-timezone">
					{m.notifications_digest_timezone()}
				</label>
				<Input
					id="notification-digest-timezone"
					bind:value={digestTimezone}
					autocomplete="off"
					required
					placeholder="Europe/Lisbon"
				/>
			</div>
			<p class="text-xs leading-5 text-muted-foreground sm:col-span-2">
				{m.notifications_digest_help()}
			</p>
		</div>

		<div class="hidden overflow-hidden rounded-lg border md:block">
			<table class="w-full table-fixed text-sm">
				<thead class="border-b bg-muted/35 text-left">
					<tr>
						<th class="px-4 py-3 font-medium">{m.notifications_event()}</th>
						<th class="w-28 px-4 py-3 text-center font-medium">
							{m.notifications_in_app()}
						</th>
						<th class="w-44 px-4 py-3 text-center font-medium">
							{m.notifications_email_frequency()}
						</th>
					</tr>
				</thead>
				{#each eventGroups as group (group.id)}
					<tbody class="divide-y border-b last:border-b-0">
						<tr class="bg-muted/20">
							<th colspan="3" scope="rowgroup" class="px-4 py-2 text-left text-xs font-semibold">
								{group.label}
							</th>
						</tr>
						{#each group.events as eventType (eventType)}
							{@const preference = preferenceFor(eventType)}
							<tr>
								<th scope="row" class="px-4 py-3 text-left font-normal">
									<span class="block font-medium">{notificationTopicLabel(eventType)}</span>
									<span class="mt-0.5 block text-xs leading-5 text-muted-foreground">
										{notificationTopicDescription(eventType)}
									</span>
								</th>
								<td class="px-4 py-3 text-center">
									<span class="inline-flex min-h-11 min-w-11 items-center justify-center">
										<Checkbox
											checked={preference.in_app}
											disabled={criticalInAppTopics.has(eventType)}
											aria-label={`${notificationTopicLabel(eventType)} · ${m.notifications_in_app()}`}
											onCheckedChange={(checked) => updateInApp(eventType, checked)}
										/>
									</span>
								</td>
								<td class="px-4 py-3 text-center">
									{@render emailFrequencyControl(eventType, preference, '')}
								</td>
							</tr>
						{/each}
					</tbody>
				{/each}
			</table>
		</div>

		<div class="divide-y rounded-lg border md:hidden">
			{#each eventGroups as group (group.id)}
				<section aria-labelledby={`notification-group-${group.id}`}>
					<h2
						id={`notification-group-${group.id}`}
						class="border-b bg-muted/20 px-4 py-2 text-xs font-semibold"
					>
						{group.label}
					</h2>
					<div class="divide-y">
						{#each group.events as eventType (eventType)}
							{@const preference = preferenceFor(eventType)}
							<div class="space-y-3 px-4 py-4">
								<div>
									<p class="text-sm font-medium">{notificationTopicLabel(eventType)}</p>
									<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
										{notificationTopicDescription(eventType)}
									</p>
								</div>
								<div class="grid grid-cols-2 gap-3">
									<label
										class="flex min-h-11 items-center gap-3 rounded-md bg-muted/30 px-3 text-sm"
									>
										<Checkbox
											checked={preference.in_app}
											disabled={criticalInAppTopics.has(eventType)}
											aria-label={`${notificationTopicLabel(eventType)} · ${m.notifications_in_app()}`}
											onCheckedChange={(checked) => updateInApp(eventType, checked)}
										/>
										{m.notifications_in_app()}
									</label>
									{@render emailFrequencyControl(eventType, preference, 'min-h-11 w-full')}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/each}
		</div>

		<p class="text-xs leading-5 text-muted-foreground">{m.notifications_critical_help()}</p>

		<SettingsFormFooter
			label={m.notifications_save_preferences()}
			savingLabel={m.notifications_saving_preferences()}
			{saving}
			disabled={!dirty}
			onSave={() => void save()}
		/>
	</div>
{/if}
