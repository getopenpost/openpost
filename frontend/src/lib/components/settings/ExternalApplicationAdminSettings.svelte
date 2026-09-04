<script lang="ts">
	import { onMount } from 'svelte';
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { components } from '$lib/api/types';

	type Application = components['schemas']['ExternalApplicationResponse'];
	const scopeOptions = [
		'workspace:read',
		'accounts:read',
		'publications:read',
		'drafts:write',
		'media:read',
		'media:write',
		'publications:schedule',
		'publications:publish',
		'publications:cancel',
		'events:subscribe'
	];

	let applications = $state<Application[]>([]);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');
	let name = $state('');
	let clientType = $state('public');
	let redirectURIs = $state('');
	let selectedScopes = $state<string[]>([...scopeOptions]);
	let createdClientID = $state('');
	let revealedSecret = $state('');
	let pendingRevokeID = $state('');
	let revokeOpen = $state(false);

	async function load() {
		loading = true;
		error = '';
		const { data, error: apiError } = await client.GET('/admin/external-applications');
		if (apiError) error = apiError.detail ?? m.settings_external_apps_load_failed();
		else applications = data ?? [];
		loading = false;
	}

	function toggleScope(scope: string) {
		selectedScopes = selectedScopes.includes(scope)
			? selectedScopes.filter((value) => value !== scope)
			: [...selectedScopes, scope];
	}

	async function registerApplication() {
		busy = true;
		error = '';
		createdClientID = '';
		revealedSecret = '';
		const redirects = redirectURIs
			.split(/\s+/)
			.map((value) => value.trim())
			.filter(Boolean);
		const { data, error: apiError } = await client.POST('/admin/external-applications', {
			body: {
				name: name.trim(),
				client_type: clientType,
				redirect_uris: redirects,
				allowed_scopes: selectedScopes
			}
		});
		if (apiError || !data) {
			error = apiError?.detail ?? m.settings_external_apps_create_failed();
		} else {
			createdClientID = data.application.client_id;
			revealedSecret = data.client_secret ?? '';
			name = '';
			redirectURIs = '';
			await load();
		}
		busy = false;
	}

	async function rotateSecret(applicationID: string) {
		busy = true;
		error = '';
		const { data, error: apiError } = await client.POST(
			'/admin/external-applications/{id}/rotate-secret',
			{ params: { path: { id: applicationID } } }
		);
		if (apiError || !data?.client_secret) {
			error = apiError?.detail ?? m.settings_external_apps_rotate_failed();
		} else {
			createdClientID = applications.find((app) => app.id === applicationID)?.client_id ?? '';
			revealedSecret = data.client_secret;
		}
		busy = false;
	}

	function requestRevoke(applicationID: string) {
		pendingRevokeID = applicationID;
		revokeOpen = true;
	}

	async function confirmRevoke() {
		const { error: apiError } = await client.DELETE('/admin/external-applications/{id}', {
			params: { path: { id: pendingRevokeID } }
		});
		if (apiError) return { ok: false, message: apiError.detail ?? m.settings_action_failed() };
		await load();
		pendingRevokeID = '';
		return { ok: true };
	}

	onMount(load);
</script>

<div class="border-t pt-6">
	<SectionHeader
		title={m.settings_external_apps()}
		description={m.settings_external_apps_body()}
		themeIconRole="link"
		class="mb-4"
	/>

	{#if error}<InlineNotice tone="error" message={error} class="mb-4" />{/if}
	{#if revealedSecret}
		<InlineNotice tone="warning" class="mb-4">
			<p class="font-medium">{m.settings_external_apps_copy_secret()}</p>
			<p class="mt-2 font-mono text-xs break-all">{createdClientID}</p>
			<p class="mt-1 font-mono text-xs break-all">{revealedSecret}</p>
		</InlineNotice>
	{/if}

	<div class="grid gap-4 rounded-md border p-4 lg:grid-cols-2">
		<div class="space-y-2">
			<Label for="external-app-name">{m.settings_external_app_name()}</Label>
			<Input id="external-app-name" bind:value={name} placeholder="Content workflow" />
		</div>
		<div class="space-y-2">
			<Label for="external-app-type">{m.settings_external_app_type()}</Label>
			<Select.Root type="single" bind:value={clientType}>
				<Select.Trigger id="external-app-type" class="w-full">
					{clientType === 'public'
						? m.settings_external_app_public()
						: m.settings_external_app_confidential()}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="public">{m.settings_external_app_public()}</Select.Item>
					<Select.Item value="confidential">{m.settings_external_app_confidential()}</Select.Item>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="space-y-2 lg:col-span-2">
			<Label for="external-app-redirects">{m.settings_external_app_redirects()}</Label>
			<Textarea
				id="external-app-redirects"
				bind:value={redirectURIs}
				placeholder="https://app.example.com/oauth/callback"
				rows={3}
			/>
			<p class="text-xs text-muted-foreground">{m.settings_external_app_redirects_body()}</p>
		</div>
		<fieldset class="space-y-2 lg:col-span-2">
			<legend class="text-sm font-medium">{m.settings_external_app_scopes()}</legend>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each scopeOptions as scope (scope)}
					<Label class="flex min-h-9 items-center gap-2 rounded-md border px-3 font-mono text-xs">
						<Checkbox
							checked={selectedScopes.includes(scope)}
							onCheckedChange={() => toggleScope(scope)}
						/>
						{scope}
					</Label>
				{/each}
			</div>
		</fieldset>
		<div class="lg:col-span-2">
			<Button
				onclick={registerApplication}
				disabled={busy || !name.trim() || !redirectURIs.trim() || selectedScopes.length === 0}
			>
				{m.settings_external_app_register()}
			</Button>
		</div>
	</div>

	<div class="mt-4">
		{#if loading}
			<PageLoading layout="list" label={m.common_loading()} items={2} />
		{:else if applications.length === 0}
			<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
				{m.settings_external_apps_empty()}
			</p>
		{:else}
			<div class="space-y-2">
				{#each applications as application (application.id)}
					<div
						class="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
					>
						<div class="min-w-0">
							<p class="font-medium">{application.name}</p>
							<p class="mt-1 font-mono text-xs break-all text-muted-foreground">
								{application.client_id}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">{application.client_type}</p>
						</div>
						{#if !application.revoked_at}
							<div class="flex gap-2">
								{#if application.client_type === 'confidential'}
									<Button
										variant="outline"
										size="sm"
										disabled={busy}
										onclick={() => rotateSecret(application.id)}
									>
										{m.settings_external_app_rotate()}
									</Button>
								{/if}
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive"
									onclick={() => requestRevoke(application.id)}
								>
									{m.settings_revoke()}
								</Button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<DestructiveConfirmDialog
	bind:open={revokeOpen}
	title={m.settings_external_app_revoke_title()}
	description={m.settings_external_app_revoke_body()}
	confirmLabel={m.settings_revoke()}
	onConfirm={confirmRevoke}
/>
