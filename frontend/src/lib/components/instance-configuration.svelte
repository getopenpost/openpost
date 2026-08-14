<script lang="ts">
	import type { components } from '$lib/api/types';
	import { client } from '$lib/api/client';
	import AppSelect from '$lib/components/app-select.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import SettingsFormFooter from '$lib/components/settings-form-footer.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { instanceSettingCopy, instanceSettingOptionLabel } from '$lib/instance-setting-copy';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import TrashIcon from '@lucide/svelte/icons/trash';

	type Setting = components['schemas']['InstanceSettingResponse'];
	type SettingUpdate = components['schemas']['InstanceSettingUpdateInput'];
	type SettingsResponse = components['schemas']['InstanceSettingsResponse'];
	type ProviderApp = components['schemas']['ProviderAppResponse'];
	type SectionID =
		| 'accounts'
		| 'billing'
		| 'email'
		| 'authentication'
		| 'features'
		| 'providers'
		| 'provider-apps';

	interface Props {
		active: boolean;
	}

	const providerDefinitions = [
		{ value: 'x', label: 'X' },
		{ value: 'linkedin', label: 'LinkedIn' },
		{ value: 'threads', label: 'Threads' },
		{ value: 'facebook', label: 'Facebook Pages' },
		{ value: 'instagram', label: 'Instagram' },
		{ value: 'youtube', label: 'YouTube' },
		{ value: 'tiktok', label: 'TikTok' },
		{ value: 'mastodon', label: 'Mastodon' }
	];

	let { active }: Props = $props();
	const unsavedChanges = getOptionalUnsavedChanges();
	let loaded = $state(false);
	let loading = $state(false);
	let loadAttempted = $state(false);
	let saving = $state(false);
	let providerSaving = $state(false);
	let error = $state('');
	let activeSection = $state<SectionID>('accounts');
	let response = $state<SettingsResponse | null>(null);
	let settings = $state<Setting[]>([]);
	let providerApps = $state<ProviderApp[]>([]);
	let drafts = $state<Record<string, string>>({});
	let originals = $state<Record<string, string>>({});
	let unsets = $state<Record<string, boolean>>({});

	let provider = $state('x');
	let providerName = $state('');
	let providerClientID = $state('');
	let providerClientSecret = $state('');
	let providerRedirectURI = $state('');
	let providerInstanceURL = $state('');
	let providerActive = $state(true);
	let editingProviderID = $state('');
	let editingProviderHasSecret = $state(false);
	let providerSnapshot = $state('');
	let deleteTarget = $state<ProviderApp | null>(null);
	let deleteDialogOpen = $state(false);

	const sections = $derived([
		{ id: 'accounts' as const, label: m.settings_configuration_accounts() },
		{ id: 'billing' as const, label: m.settings_configuration_billing() },
		{ id: 'email' as const, label: m.settings_configuration_email() },
		{ id: 'authentication' as const, label: m.settings_configuration_authentication() },
		{ id: 'features' as const, label: m.settings_configuration_features() },
		{ id: 'providers' as const, label: m.settings_configuration_provider_behavior() },
		{ id: 'provider-apps' as const, label: m.settings_configuration_provider_apps() }
	]);
	const visibleSettings = $derived(settings.filter((setting) => setting.group === activeSection));
	const settingsDirty = $derived.by(() =>
		settings.some((setting) => {
			if (unsets[setting.key]) return true;
			if (!setting.editable) return false;
			if (setting.secret) return Boolean(drafts[setting.key]?.trim());
			return (drafts[setting.key] ?? '') !== (originals[setting.key] ?? '');
		})
	);
	const providerDirty = $derived(loaded && providerFormSnapshot() !== providerSnapshot);
	const dirty = $derived(active && (settingsDirty || providerDirty));
	const providerOptions = $derived(
		providerDefinitions.map((definition) => ({
			value: definition.value,
			label: definition.label,
			disabled:
				definition.value !== 'mastodon' &&
				providerApps.some(
					(app) => app.provider === definition.value && app.id !== editingProviderID
				)
		}))
	);

	$effect(() => {
		if (active && !loaded && !loading && !loadAttempted) void load();
	});

	$effect(() => {
		unsavedChanges?.set('instance-configuration', dirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('instance-configuration');
	});

	async function load() {
		loading = true;
		loadAttempted = true;
		error = '';
		try {
			const [settingsResult, providersResult] = await Promise.all([
				client.GET('/admin/instance-settings'),
				client.GET('/admin/provider-apps')
			]);
			const loadError = settingsResult.error ?? providersResult.error;
			if (loadError) {
				error = loadError.detail ?? m.settings_configuration_load_failed();
				return;
			}
			applySettingsResponse(settingsResult.data ?? { settings: [], requires_restart: false });
			providerApps = providersResult.data ?? [];
			resetProviderForm();
			loaded = true;
		} catch {
			error = m.settings_configuration_load_failed();
		} finally {
			loading = false;
		}
	}

	function retryLoad() {
		loadAttempted = false;
		void load();
	}

	function applySettingsResponse(next: SettingsResponse) {
		response = next;
		settings = next.settings ?? [];
		const nextDrafts: Record<string, string> = {};
		const nextOriginals: Record<string, string> = {};
		for (const setting of settings) {
			const value = setting.secret ? '' : (setting.value ?? '');
			nextDrafts[setting.key] = value;
			nextOriginals[setting.key] = value;
		}
		drafts = nextDrafts;
		originals = nextOriginals;
		unsets = {};
	}

	function updateDraft(key: string, value: string) {
		drafts = { ...drafts, [key]: value };
		unsets = { ...unsets, [key]: false };
	}

	function markUnset(key: string) {
		unsets = { ...unsets, [key]: true };
		drafts = { ...drafts, [key]: originals[key] ?? '' };
	}

	function undoUnset(key: string) {
		unsets = { ...unsets, [key]: false };
	}

	async function saveSettings() {
		const updates: SettingUpdate[] = [];
		for (const setting of settings) {
			if (unsets[setting.key]) {
				updates.push({ key: setting.key, unset: true });
				continue;
			}
			if (!setting.editable) continue;
			const value = drafts[setting.key] ?? '';
			if (setting.secret && value.trim()) updates.push({ key: setting.key, value });
			if (!setting.secret && value !== (originals[setting.key] ?? '')) {
				updates.push({ key: setting.key, value });
			}
		}
		if (!updates.length) return;
		saving = true;
		error = '';
		try {
			const { data, error: saveError } = await client.PUT('/admin/instance-settings', {
				body: { settings: updates }
			});
			if (saveError || !data) {
				error = saveError?.detail ?? m.settings_configuration_save_failed();
				return;
			}
			applySettingsResponse(data);
			showToast(m.settings_configuration_saved(), 'success');
		} catch {
			error = m.settings_configuration_save_failed();
		} finally {
			saving = false;
		}
	}

	function providerLabel(value: string) {
		return providerDefinitions.find((definition) => definition.value === value)?.label ?? value;
	}

	function providerFormSnapshot() {
		return JSON.stringify({
			provider,
			providerName,
			providerClientID,
			providerClientSecret,
			providerRedirectURI,
			providerInstanceURL,
			providerActive,
			editingProviderID
		});
	}

	function resetProviderForm() {
		provider =
			providerDefinitions.find(
				(definition) =>
					definition.value === 'mastodon' ||
					!providerApps.some((app) => app.provider === definition.value)
			)?.value ?? 'mastodon';
		providerName = '';
		providerClientID = '';
		providerClientSecret = '';
		providerRedirectURI = '';
		providerInstanceURL = '';
		providerActive = true;
		editingProviderID = '';
		editingProviderHasSecret = false;
		providerSnapshot = providerFormSnapshot();
	}

	function editProvider(app: ProviderApp) {
		if (!app.editable) return;
		provider = app.provider;
		providerName = app.name ?? '';
		providerClientID = app.client_id;
		providerClientSecret = '';
		providerRedirectURI = app.redirect_uri ?? '';
		providerInstanceURL = app.instance_url ?? '';
		providerActive = app.is_active;
		editingProviderID = app.id;
		editingProviderHasSecret = app.secret_configured;
		providerSnapshot = providerFormSnapshot();
	}

	async function saveProvider(event: SubmitEvent) {
		event.preventDefault();
		providerSaving = true;
		error = '';
		try {
			const { error: saveError } = await client.POST('/admin/provider-apps', {
				body: {
					provider,
					name: provider === 'mastodon' ? providerName.trim() : undefined,
					client_id: providerClientID.trim(),
					client_secret: providerClientSecret.trim() || undefined,
					redirect_uri: providerRedirectURI.trim() || undefined,
					instance_url: provider === 'mastodon' ? providerInstanceURL.trim() : undefined,
					is_active: providerActive
				}
			});
			if (saveError) {
				error = saveError.detail ?? m.settings_configuration_provider_save_failed();
				return;
			}
			const { data, error: reloadError } = await client.GET('/admin/provider-apps');
			if (reloadError) {
				error = reloadError.detail ?? m.settings_configuration_load_failed();
				return;
			}
			providerApps = data ?? [];
			resetProviderForm();
			showToast(m.settings_configuration_provider_saved(), 'success');
		} catch {
			error = m.settings_configuration_provider_save_failed();
		} finally {
			providerSaving = false;
		}
	}

	async function deleteProvider(): Promise<DestructiveActionOutcome> {
		if (!deleteTarget?.deletable) return { ok: false };
		const deletedID = deleteTarget.id;
		try {
			const { error: deleteError } = await client.DELETE('/admin/provider-apps/{id}', {
				params: { path: { id: deletedID } }
			});
			if (deleteError) {
				return {
					ok: false,
					message: deleteError.detail ?? m.settings_configuration_provider_delete_failed()
				};
			}
			providerApps = providerApps.filter((provider) => provider.id !== deletedID);
			if (editingProviderID === deletedID) resetProviderForm();
			deleteTarget = null;
		} catch {
			return { ok: false, message: m.settings_configuration_provider_delete_failed() };
		}
		try {
			const { data, error: reloadError } = await client.GET('/admin/provider-apps');
			if (reloadError) {
				error = reloadError.detail ?? m.settings_configuration_load_failed();
				return { ok: true, successMessage: m.settings_configuration_provider_deleted() };
			}
			providerApps = data ?? [];
			return { ok: true, successMessage: m.settings_configuration_provider_deleted() };
		} catch {
			error = m.settings_configuration_load_failed();
			return { ok: true, successMessage: m.settings_configuration_provider_deleted() };
		}
	}

	function requestDeleteProvider(app: ProviderApp) {
		deleteTarget = app;
		deleteDialogOpen = true;
	}

	function sourceLabel(setting: Setting) {
		if (setting.source === 'environment') return m.settings_configuration_source_environment();
		if (setting.source === 'database') return m.settings_configuration_source_admin();
		return m.settings_configuration_source_default();
	}

	function hasDraftOverride(setting: Setting) {
		if (unsets[setting.key]) return false;
		if (setting.secret) return Boolean(drafts[setting.key]?.trim());
		return (drafts[setting.key] ?? '') !== (originals[setting.key] ?? '');
	}

	function sectionDescription(section: SectionID) {
		if (section === 'accounts') return m.settings_configuration_accounts_body();
		if (section === 'billing') return m.settings_configuration_billing_body();
		if (section === 'email') return m.settings_configuration_email_body();
		if (section === 'authentication') return m.settings_configuration_authentication_body();
		if (section === 'features') return m.settings_configuration_features_body();
		if (section === 'providers') return m.settings_configuration_provider_behavior_body();
		return m.settings_configuration_provider_apps_body();
	}
</script>

{#if loading}
	<PageLoading layout="list" label={m.common_loading()} items={6} />
{:else if !loaded}
	<div class="space-y-3" data-testid="instance-configuration">
		<InlineNotice tone="error" message={error || m.settings_configuration_load_failed()} />
		<Button variant="outline" onclick={retryLoad}>{m.common_retry()}</Button>
	</div>
{:else}
	<div class="space-y-6" data-testid="instance-configuration">
		<div
			class="flex max-w-full gap-2 overflow-x-auto pb-1"
			aria-label={m.settings_configuration_sections()}
		>
			{#each sections as section (section.id)}
				<Button
					variant={activeSection === section.id ? 'secondary' : 'ghost'}
					size="sm"
					class="shrink-0"
					aria-pressed={activeSection === section.id}
					onclick={() => (activeSection = section.id)}
				>
					{section.label}
				</Button>
			{/each}
		</div>

		{#if error}
			<InlineNotice
				tone="error"
				message={error}
				onDismiss={() => (error = '')}
				dismissLabel={m.common_dismiss()}
			/>
		{/if}
		{#if response?.requires_restart}
			<InlineNotice tone="warning">
				<p class="font-medium">{m.settings_configuration_restart_required()}</p>
				<p class="mt-0.5 text-current/80">{m.settings_configuration_restart_required_body()}</p>
			</InlineNotice>
		{/if}

		{#if activeSection !== 'provider-apps'}
			<section class="space-y-4">
				<SectionHeader
					title={sections.find((section) => section.id === activeSection)?.label ?? ''}
					description={sectionDescription(activeSection)}
					icon={KeyRoundIcon}
				/>
				<div class="divide-y overflow-hidden rounded-xl border bg-background">
					{#each visibleSettings as setting (setting.key)}
						{@const copy = instanceSettingCopy(setting)}
						<div
							class={[
								'grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] sm:items-start',
								unsets[setting.key] ? 'bg-muted/25' : ''
							]}
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<Label for={'instance-setting-' + setting.key} class="font-medium">
										{copy.label}
									</Label>
									<Badge
										class={setting.source === 'environment' ? 'border-border bg-background' : ''}
									>
										{sourceLabel(setting)}
									</Badge>
									{#if setting.managed_by && !unsets[setting.key] && (setting.database_override_configured || hasDraftOverride(setting))}
										<Badge class="bg-amber-500/15 text-amber-900 dark:text-amber-100">
											{setting.database_override_configured && !setting.requires_restart
												? m.settings_configuration_overrides_environment()
												: m.settings_configuration_will_override_environment()}
										</Badge>
									{/if}
									{#if setting.requires_restart}
										<Badge class="bg-amber-500/15 text-amber-900 dark:text-amber-100">
											{m.settings_configuration_pending()}
										</Badge>
									{/if}
								</div>
								<p class="mt-1 max-w-[70ch] text-sm leading-5 text-muted-foreground">
									{copy.description}
								</p>
								<code class="mt-2 block text-xs break-all text-muted-foreground">
									{(setting.environment_variables ?? []).join(' · ')}
								</code>
								{#if setting.managed_by}
									<InlineNotice
										tone={!unsets[setting.key] &&
										(setting.database_override_configured || hasDraftOverride(setting))
											? 'warning'
											: 'info'}
										class="mt-3"
									>
										{#if unsets[setting.key]}
											<p class="font-medium">
												{m.settings_configuration_environment_will_resume()}
											</p>
											<p class="mt-0.5 text-current/80">
												{m.settings_configuration_environment_will_resume_body({
													source: setting.managed_by
												})}
											</p>
										{:else if setting.database_override_configured && setting.requires_restart}
											<p class="font-medium">
												{m.settings_configuration_override_pending_restart()}
											</p>
											<p class="mt-0.5 text-current/80">
												{m.settings_configuration_override_pending_restart_body({
													source: setting.managed_by
												})}
											</p>
										{:else if setting.database_override_configured}
											<p class="font-medium">
												{m.settings_configuration_overriding_environment()}
											</p>
											<p class="mt-0.5 text-current/80">
												{m.settings_configuration_overriding_environment_body({
													source: setting.managed_by
												})}
											</p>
										{:else if hasDraftOverride(setting)}
											<p class="font-medium">
												{m.settings_configuration_will_override_environment_value()}
											</p>
											<p class="mt-0.5 text-current/80">
												{m.settings_configuration_will_override_environment_body({
													source: setting.managed_by
												})}
											</p>
										{:else}
											<p class="font-medium">
												{m.settings_configuration_environment_value_set()}
											</p>
											<p class="mt-0.5 text-current/80">
												{m.settings_configuration_environment_value_set_body({
													source: setting.managed_by
												})}
											</p>
										{/if}
									</InlineNotice>
								{/if}
							</div>

							<div class="min-w-0 space-y-2">
								{#if setting.type === 'boolean'}
									<label
										class="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-muted/15 px-3 text-sm"
									>
										<span>
											{drafts[setting.key] === 'true'
												? m.settings_configuration_enabled()
												: m.settings_configuration_disabled()}
										</span>
										<Checkbox
											id={'instance-setting-' + setting.key}
											checked={drafts[setting.key] === 'true'}
											disabled={!setting.editable || unsets[setting.key]}
											onCheckedChange={(value) =>
												updateDraft(setting.key, value === true ? 'true' : 'false')}
										/>
									</label>
								{:else if setting.type === 'enum'}
									<AppSelect
										id={'instance-setting-' + setting.key}
										value={drafts[setting.key] ?? ''}
										options={(setting.options ?? []).map((option) => ({
											value: option.value,
											label: instanceSettingOptionLabel(setting.key, option.value, option.label)
										}))}
										disabled={!setting.editable || unsets[setting.key]}
										onValueChange={(value) => updateDraft(setting.key, value)}
									/>
								{:else}
									<Input
										id={'instance-setting-' + setting.key}
										type={setting.secret
											? 'password'
											: setting.type === 'integer'
												? 'number'
												: 'text'}
										value={drafts[setting.key] ?? ''}
										placeholder={setting.secret && setting.secret_configured
											? m.settings_configuration_secret_configured()
											: ''}
										disabled={!setting.editable || unsets[setting.key]}
										autocomplete={setting.secret ? 'new-password' : undefined}
										oninput={(event) => updateDraft(setting.key, event.currentTarget.value)}
									/>
								{/if}
								{#if setting.database_override_configured}
									{#if unsets[setting.key]}
										<div
											class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
										>
											<span>
												{setting.managed_by
													? m.settings_configuration_will_use_environment({
															source: setting.managed_by
														})
													: m.settings_configuration_will_use_fallback()}
											</span>
											<Button variant="ghost" size="sm" onclick={() => undoUnset(setting.key)}>
												<RotateCcwIcon class="size-3.5" />
												{m.settings_configuration_undo()}
											</Button>
										</div>
									{:else}
										<Button variant="ghost" size="sm" onclick={() => markUnset(setting.key)}>
											<RotateCcwIcon class="size-3.5" />
											{setting.managed_by
												? m.settings_configuration_use_environment()
												: m.settings_configuration_use_fallback()}
										</Button>
									{/if}
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{:else}
			<section class="space-y-6">
				<SectionHeader
					title={m.settings_configuration_provider_apps()}
					description={m.settings_configuration_provider_apps_body()}
					icon={KeyRoundIcon}
				/>
				<InlineNotice tone="info">
					{m.settings_configuration_provider_restart_note()}
				</InlineNotice>

				<div class="overflow-hidden rounded-xl border bg-background">
					<div class="border-b bg-muted/20 px-4 py-3">
						<h3 class="font-medium">{m.settings_configuration_configured_apps()}</h3>
					</div>
					{#if providerApps.length === 0}
						<p class="p-4 text-sm text-muted-foreground">
							{m.settings_configuration_no_provider_apps()}
						</p>
					{:else}
						<div class="divide-y">
							{#each providerApps as app (app.id)}
								<div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
									<div class="min-w-0">
										<div class="flex flex-wrap items-center gap-2">
											<p class="font-medium">{providerLabel(app.provider)}</p>
											<Badge>
												{app.source === 'environment'
													? m.settings_configuration_source_environment()
													: m.settings_configuration_source_admin()}
											</Badge>
											{#if !app.is_active}
												<Badge class="bg-muted text-muted-foreground">
													{m.settings_configuration_disabled()}
												</Badge>
											{/if}
										</div>
										<p class="mt-1 truncate text-sm text-muted-foreground">{app.client_id}</p>
										{#if app.instance_url}
											<p class="mt-1 truncate text-xs text-muted-foreground">{app.instance_url}</p>
										{/if}
										{#if app.shadowed_by_environment}
											<Badge class="bg-amber-500/15 text-amber-900 dark:text-amber-100">
												{m.settings_configuration_database_fallback()}
											</Badge>
										{/if}
									</div>
									<div class="flex shrink-0 gap-2">
										{#if app.editable}
											<Button variant="outline" size="sm" onclick={() => editProvider(app)}>
												<PencilIcon class="size-3.5" />
												{m.common_edit()}
											</Button>
										{/if}
										{#if app.deletable}
											<Button
												variant="ghost"
												size="sm"
												class="text-destructive hover:text-destructive"
												onclick={() => requestDeleteProvider(app)}
											>
												<TrashIcon class="size-3.5" />
												{m.common_delete()}
											</Button>
										{/if}
										{#if !app.editable && !app.deletable}
											<span class="text-xs text-muted-foreground">
												{m.settings_configuration_environment_locked()}
											</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<form class="space-y-4 rounded-xl border bg-muted/10 p-4" onsubmit={saveProvider}>
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h3 class="font-medium">
								{editingProviderID
									? m.settings_configuration_edit_provider()
									: m.settings_configuration_add_provider()}
							</h3>
							<p class="mt-1 text-sm text-muted-foreground">
								{m.settings_configuration_provider_form_body()}
							</p>
						</div>
						{#if editingProviderID}
							<Button variant="ghost" size="sm" type="button" onclick={resetProviderForm}>
								<PlusIcon class="size-3.5" />
								{m.settings_configuration_add_another()}
							</Button>
						{/if}
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<Label for="provider-app-provider">{m.settings_configuration_provider()}</Label>
							<AppSelect
								id="provider-app-provider"
								bind:value={provider}
								options={providerOptions}
								disabled={Boolean(editingProviderID)}
							/>
						</div>
						<div class="space-y-2">
							<Label for="provider-app-client-id">{m.settings_configuration_client_id()}</Label>
							<Input id="provider-app-client-id" bind:value={providerClientID} required />
						</div>
						<div class="space-y-2">
							<Label for="provider-app-secret">{m.settings_configuration_client_secret()}</Label>
							<Input
								id="provider-app-secret"
								type="password"
								bind:value={providerClientSecret}
								autocomplete="new-password"
								placeholder={editingProviderID && editingProviderHasSecret
									? m.settings_configuration_secret_keep()
									: ''}
							/>
						</div>
						<div class="space-y-2">
							<Label for="provider-app-callback">{m.settings_configuration_callback()}</Label>
							<Input
								id="provider-app-callback"
								bind:value={providerRedirectURI}
								placeholder={m.settings_configuration_callback_auto()}
							/>
						</div>
						{#if provider === 'mastodon'}
							<div class="space-y-2">
								<Label for="provider-app-name">{m.settings_configuration_app_name()}</Label>
								<Input id="provider-app-name" bind:value={providerName} />
							</div>
							<div class="space-y-2">
								<Label for="provider-app-instance">{m.settings_configuration_instance_url()}</Label>
								<Input
									id="provider-app-instance"
									type="url"
									bind:value={providerInstanceURL}
									required
									disabled={Boolean(editingProviderID)}
								/>
							</div>
						{/if}
					</div>
					<label
						class="flex min-h-11 items-center gap-3 rounded-md border bg-background px-3 text-sm"
					>
						<Checkbox bind:checked={providerActive} />
						<span>{m.settings_configuration_provider_active()}</span>
					</label>
					<div class="flex justify-end">
						<Button type="submit" disabled={providerSaving || !providerClientID.trim()}>
							{#if providerSaving}<LoaderIcon class="size-4 animate-spin" />{/if}
							{editingProviderID
								? m.settings_configuration_save_provider()
								: m.settings_configuration_add_provider_action()}
						</Button>
					</div>
				</form>
			</section>
		{/if}

		{#if settingsDirty}
			<SettingsFormFooter
				label={m.settings_configuration_save()}
				savingLabel={m.settings_configuration_saving()}
				{saving}
				onSave={saveSettings}
			/>
		{/if}
	</div>
{/if}

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={m.settings_configuration_delete_provider()}
	description={m.settings_configuration_delete_provider_body({
		provider: deleteTarget ? providerLabel(deleteTarget.provider) : ''
	})}
	confirmLabel={m.common_delete()}
	onConfirm={deleteProvider}
/>
