<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';

	type ChannelPreference = components['schemas']['ChannelPreference'];
	type Preferences = Record<string, ChannelPreference>;
	type Channel = keyof ChannelPreference;

	const criticalTypes = new Set([
		'publish_failed',
		'account_needs_attention',
		'reply_failed',
		'workspace_invite'
	]);
	const defaultEmailTypes = new Set(['publish_failed', 'reply_failed', 'workspace_invite']);
	const transactionalEmailTypes = new Set(['workspace_invite']);
	const eventGroups = $derived([
		{
			id: 'publishing',
			label: m.notifications_group_publishing(),
			events: ['post_published', 'publish_failed', 'account_needs_attention']
		},
		{
			id: 'conversations',
			label: m.notifications_group_conversations(),
			events: ['new_engagement', 'new_message', 'reply_failed']
		},
		{
			id: 'workspace',
			label: m.notifications_group_workspace(),
			events: ['workspace_invite']
		}
	]);

	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');
	let preferences = $state.raw<Preferences>({});
	let savedSnapshot = $state('');
	let emailAvailable = $state(false);
	let emailAddress = $state('');
	const dirty = $derived(JSON.stringify(preferences) !== savedSnapshot);

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
		savedSnapshot = JSON.stringify(data.preferences);
		emailAvailable = data.email_available;
		emailAddress = data.email_address;
		loading = false;
	}

	function preferenceFor(eventType: string): ChannelPreference {
		return (
			preferences[eventType] ?? {
				in_app: true,
				email: defaultEmailTypes.has(eventType)
			}
		);
	}

	function updatePreference(eventType: string, channel: Channel, enabled: boolean) {
		preferences = {
			...preferences,
			[eventType]: { ...preferenceFor(eventType), [channel]: enabled }
		};
	}

	async function save() {
		saving = true;
		const { data, error: apiError } = await client.PUT('/notifications/preferences', {
			body: preferences
		});
		saving = false;
		if (apiError || !data) {
			showToast(apiError?.detail || m.notifications_preferences_save_failed(), 'error');
			return;
		}
		preferences = data.preferences;
		savedSnapshot = JSON.stringify(data.preferences);
		emailAvailable = data.email_available;
		emailAddress = data.email_address;
		showToast(m.notifications_preferences_saved(), 'success');
	}

	function eventLabel(eventType: string) {
		switch (eventType) {
			case 'post_published':
				return m.notifications_event_post_published();
			case 'publish_failed':
				return m.notifications_event_publish_failed();
			case 'account_needs_attention':
				return m.notifications_event_account_needs_attention();
			case 'new_engagement':
				return m.notifications_event_new_engagement();
			case 'new_message':
				return m.notifications_event_new_message();
			case 'reply_failed':
				return m.notifications_event_reply_failed();
			default:
				return m.notifications_event_workspace_invite();
		}
	}

	function eventDescription(eventType: string) {
		switch (eventType) {
			case 'post_published':
				return m.notifications_event_post_published_description();
			case 'publish_failed':
				return m.notifications_event_publish_failed_description();
			case 'account_needs_attention':
				return m.notifications_event_account_needs_attention_description();
			case 'new_engagement':
				return m.notifications_event_new_engagement_description();
			case 'new_message':
				return m.notifications_event_new_message_description();
			case 'reply_failed':
				return m.notifications_event_reply_failed_description();
			default:
				return m.notifications_event_workspace_invite_description();
		}
	}
</script>

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

		<div class="hidden overflow-hidden rounded-lg border md:block">
			<table class="w-full table-fixed text-sm">
				<thead class="border-b bg-muted/35 text-left">
					<tr>
						<th class="px-4 py-3 font-medium">{m.notifications_event()}</th>
						<th class="w-28 px-4 py-3 text-center font-medium">
							{m.notifications_in_app()}
						</th>
						<th class="w-28 px-4 py-3 text-center font-medium">{m.notifications_email()}</th>
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
									<span class="block font-medium">{eventLabel(eventType)}</span>
									<span class="mt-0.5 block text-xs leading-5 text-muted-foreground">
										{eventDescription(eventType)}
									</span>
								</th>
								<td class="px-4 py-3 text-center">
									<span class="inline-flex min-h-11 min-w-11 items-center justify-center">
										<Checkbox
											checked={preference.in_app}
											disabled={criticalTypes.has(eventType)}
											aria-label={`${eventLabel(eventType)} · ${m.notifications_in_app()}`}
											onCheckedChange={(checked) => updatePreference(eventType, 'in_app', checked)}
										/>
									</span>
								</td>
								<td class="px-4 py-3 text-center">
									<span class="inline-flex min-h-11 min-w-11 items-center justify-center">
										<Checkbox
											checked={preference.email}
											disabled={!emailAvailable || transactionalEmailTypes.has(eventType)}
											aria-label={`${eventLabel(eventType)} · ${m.notifications_email()}`}
											onCheckedChange={(checked) => updatePreference(eventType, 'email', checked)}
										/>
									</span>
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
									<p class="text-sm font-medium">{eventLabel(eventType)}</p>
									<p class="mt-0.5 text-xs leading-5 text-muted-foreground">
										{eventDescription(eventType)}
									</p>
								</div>
								<div class="grid grid-cols-2 gap-3">
									<label
										class="flex min-h-11 items-center gap-3 rounded-md bg-muted/30 px-3 text-sm"
									>
										<Checkbox
											checked={preference.in_app}
											disabled={criticalTypes.has(eventType)}
											aria-label={`${eventLabel(eventType)} · ${m.notifications_in_app()}`}
											onCheckedChange={(checked) => updatePreference(eventType, 'in_app', checked)}
										/>
										{m.notifications_in_app()}
									</label>
									<label
										class="flex min-h-11 items-center gap-3 rounded-md bg-muted/30 px-3 text-sm"
									>
										<Checkbox
											checked={preference.email}
											disabled={!emailAvailable || transactionalEmailTypes.has(eventType)}
											aria-label={`${eventLabel(eventType)} · ${m.notifications_email()}`}
											onCheckedChange={(checked) => updatePreference(eventType, 'email', checked)}
										/>
										{m.notifications_email()}
									</label>
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
