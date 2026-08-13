<script lang="ts">
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { m } from '$lib/paraglide/messages';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import {
		normalizeOrganizationAPITokenMode,
		type OrganizationAPITokenMode
	} from '$lib/components/organization-sso-policy';

	type Provider = components['schemas']['OIDCProviderAdminResponse'];
	type Policy = components['schemas']['Policy'];
	type Domain = components['schemas']['IdentityProviderDomain'];
	type AuditEvent = components['schemas']['IdentityAuditEvent'];

	interface Props {
		organizationID: string;
		active: boolean;
	}

	let { organizationID, active }: Props = $props();
	let providers = $state<Provider[]>([]);
	let domains = $state<Domain[]>([]);
	let auditEvents = $state<AuditEvent[]>([]);
	let policy = $state<Policy | null>(null);
	let loading = $state(false);
	let busy = $state('');
	let error = $state('');
	let notice = $state('');
	let loadedKey = $state('');

	let providerID = $state('');
	let providerName = $state('');
	let issuer = $state('');
	let clientID = $state('');
	let clientSecret = $state('');
	let scopes = $state('openid profile email');
	let emailClaim = $state('email');
	let nameClaim = $state('name');
	let pictureClaim = $state('picture');
	let useUserInfo = $state(false);
	let requireVerifiedEmail = $state(true);
	let jitEnabled = $state(false);
	let providerActive = $state(true);

	let policyMode = $state<'disabled' | 'optional' | 'required'>('disabled');
	let acceptedProviderIDs = $state<string[]>([]);
	let assuranceHours = $state(12);
	let passwordLoginAllowed = $state(true);
	let apiTokenMode = $state<OrganizationAPITokenMode>('scoped');
	let maxTokenDays = $state(30);
	let requireTokenReauth = $state(true);

	let domainName = $state('');
	let domainProviderID = $state('');
	let pendingDNS = $state<{ name: string; value: string } | null>(null);
	let savedPolicySnapshot = $state('');
	let savedProviderSnapshot = $state('');
	const unsavedChanges = getOptionalUnsavedChanges();
	const policySnapshot = $derived(
		JSON.stringify({
			policyMode,
			acceptedProviderIDs,
			assuranceHours,
			passwordLoginAllowed,
			apiTokenMode,
			maxTokenDays,
			requireTokenReauth
		})
	);
	const providerDraftDirty = $derived(
		providerID
			? providerFormSnapshot() !== savedProviderSnapshot
			: Boolean(
					providerName ||
					issuer ||
					clientID ||
					clientSecret ||
					scopes !== 'openid email profile' ||
					emailClaim !== 'email' ||
					nameClaim !== 'name' ||
					pictureClaim !== 'picture' ||
					!useUserInfo ||
					!requireVerifiedEmail ||
					!jitEnabled ||
					!providerActive
				)
	);
	const dirty = $derived(
		active &&
			(providerDraftDirty ||
				Boolean(domainName.trim()) ||
				(Boolean(savedPolicySnapshot) && policySnapshot !== savedPolicySnapshot))
	);

	$effect(() => {
		const key = active ? organizationID : '';
		if (key && key !== loadedKey) void load(key);
	});

	$effect(() => {
		unsavedChanges?.set('organization-sso', dirty, m.settings_unsaved_changes());
		return () => unsavedChanges?.clear('organization-sso');
	});

	async function load(targetOrganizationID = organizationID) {
		if (!targetOrganizationID) return;
		loading = true;
		error = '';
		const params = { path: { organization_id: targetOrganizationID } };
		const [providerResult, policyResult, domainResult, auditResult] = await Promise.all([
			client.GET('/organizations/{organization_id}/identity-providers', { params }),
			client.GET('/organizations/{organization_id}/sso-policy', { params }),
			client.GET('/organizations/{organization_id}/sso-domains', { params }),
			client.GET('/organizations/{organization_id}/identity-audit-events', {
				params: { ...params, query: { limit: 20 } }
			})
		]);
		const loadError =
			providerResult.error ?? policyResult.error ?? domainResult.error ?? auditResult.error;
		if (loadError) {
			error = loadError.detail ?? m.settings_sso_load_failed();
			loading = false;
			return;
		}
		providers = providerResult.data ?? [];
		domains = domainResult.data ?? [];
		auditEvents = auditResult.data ?? [];
		policy = policyResult.data ?? null;
		if (policy) {
			policyMode = policy.mode as typeof policyMode;
			acceptedProviderIDs = policy.provider_ids ?? [];
			assuranceHours = Math.max(1, Math.round(policy.assurance_max_age_seconds / 3600));
			passwordLoginAllowed = policy.password_login_allowed;
			apiTokenMode = normalizeOrganizationAPITokenMode(policy.api_token_mode);
			maxTokenDays = Math.max(1, Math.round(policy.max_token_lifetime_seconds / 86400));
			requireTokenReauth = policy.require_token_reauth;
		}
		savedPolicySnapshot = policySnapshot;
		if (!domainProviderID && providers[0]) domainProviderID = providers[0].id;
		loadedKey = targetOrganizationID;
		loading = false;
	}

	function resetProviderForm() {
		providerID = '';
		providerName = '';
		issuer = '';
		clientID = '';
		clientSecret = '';
		scopes = 'openid profile email';
		emailClaim = 'email';
		nameClaim = 'name';
		pictureClaim = 'picture';
		useUserInfo = false;
		requireVerifiedEmail = true;
		jitEnabled = false;
		providerActive = true;
		savedProviderSnapshot = '';
	}

	function providerFormSnapshot() {
		return JSON.stringify({
			providerID,
			providerName,
			issuer,
			clientID,
			clientSecret,
			scopes,
			emailClaim,
			nameClaim,
			pictureClaim,
			useUserInfo,
			requireVerifiedEmail,
			jitEnabled,
			providerActive
		});
	}

	function editProvider(provider: Provider) {
		providerID = provider.id;
		providerName = provider.name;
		issuer = provider.issuer;
		clientID = provider.client_id;
		clientSecret = '';
		scopes = (provider.scopes ?? []).join(' ');
		emailClaim = provider.email_claim;
		nameClaim = provider.name_claim;
		pictureClaim = provider.picture_claim;
		useUserInfo = provider.use_userinfo;
		requireVerifiedEmail = provider.require_verified_email;
		jitEnabled = provider.jit_enabled;
		providerActive = provider.is_active;
		savedProviderSnapshot = providerFormSnapshot();
	}

	async function saveProvider(event: SubmitEvent) {
		event.preventDefault();
		busy = 'provider';
		error = '';
		notice = '';
		const { error: saveError } = await client.POST(
			'/organizations/{organization_id}/identity-providers',
			{
				params: { path: { organization_id: organizationID } },
				body: {
					id: providerID || undefined,
					name: providerName.trim(),
					issuer: issuer.trim(),
					client_id: clientID.trim(),
					client_secret: clientSecret.trim() || undefined,
					scopes: scopes.split(/\s+/).filter(Boolean),
					email_claim: emailClaim.trim() || 'email',
					name_claim: nameClaim.trim() || 'name',
					picture_claim: pictureClaim.trim() || 'picture',
					use_userinfo: useUserInfo,
					require_verified_email: requireVerifiedEmail,
					jit_enabled: jitEnabled,
					is_active: providerActive
				}
			}
		);
		if (saveError) {
			error = saveError.detail ?? m.settings_sso_provider_save_failed();
		} else {
			notice = m.settings_sso_provider_saved();
			resetProviderForm();
			loadedKey = '';
			await load();
		}
		busy = '';
	}

	async function setProviderActive(provider: Provider) {
		busy = `provider-${provider.id}`;
		error = '';
		const { error: updateError } = await client.PATCH(
			'/organizations/{organization_id}/identity-providers/{provider_id}',
			{
				params: {
					path: { organization_id: organizationID, provider_id: provider.id }
				},
				body: { active: !provider.is_active }
			}
		);
		if (updateError) error = updateError.detail ?? m.settings_sso_provider_save_failed();
		loadedKey = '';
		await load();
		busy = '';
	}

	function toggleAcceptedProvider(providerIDToToggle: string) {
		acceptedProviderIDs = acceptedProviderIDs.includes(providerIDToToggle)
			? acceptedProviderIDs.filter((id) => id !== providerIDToToggle)
			: [...acceptedProviderIDs, providerIDToToggle];
	}

	async function savePolicy(event: SubmitEvent) {
		event.preventDefault();
		busy = 'policy';
		error = '';
		notice = '';
		const { error: saveError } = await client.PUT('/organizations/{organization_id}/sso-policy', {
			params: { path: { organization_id: organizationID } },
			body: {
				mode: policyMode,
				provider_ids: acceptedProviderIDs,
				assurance_max_age_seconds: assuranceHours * 3600,
				password_login_allowed: passwordLoginAllowed,
				api_token_mode: apiTokenMode,
				max_token_lifetime_seconds: maxTokenDays * 86400,
				require_token_reauth: requireTokenReauth
			}
		});
		if (saveError) error = saveError.detail ?? m.settings_sso_policy_save_failed();
		else {
			notice = m.settings_sso_policy_saved();
			savedPolicySnapshot = policySnapshot;
		}
		busy = '';
	}

	async function createDomain(event: SubmitEvent) {
		event.preventDefault();
		busy = 'domain';
		error = '';
		notice = '';
		const { data, error: createError } = await client.POST(
			'/organizations/{organization_id}/sso-domains',
			{
				params: { path: { organization_id: organizationID } },
				body: { provider_id: domainProviderID, domain: domainName.trim() }
			}
		);
		if (createError || !data) {
			error = createError?.detail ?? m.settings_sso_domain_create_failed();
		} else {
			pendingDNS = { name: data.dns_name, value: data.dns_value };
			domainName = '';
			loadedKey = '';
			await load();
		}
		busy = '';
	}

	async function verifyDomain(domain: Domain) {
		busy = `domain-${domain.id}`;
		error = '';
		const { error: verifyError } = await client.POST(
			'/organizations/{organization_id}/sso-domains/{domain_id}/verify',
			{
				params: {
					path: { organization_id: organizationID, domain_id: domain.id }
				}
			}
		);
		if (verifyError) error = verifyError.detail ?? m.settings_sso_domain_verify_failed();
		else notice = m.settings_sso_domain_verified();
		loadedKey = '';
		await load();
		busy = '';
	}
</script>

{#if loading}
	<PageLoading layout="settings" label={m.common_loading()} items={6} />
{:else}
	<div class="space-y-10">
		{#if error}
			<InlineNotice tone="error" message={error} />
		{/if}
		{#if notice}
			<InlineNotice tone="success" message={notice} />
		{/if}

		<section>
			<SectionHeader
				title={m.settings_sso_providers()}
				description={m.settings_sso_providers_description()}
				icon={BuildingIcon}
				class="mb-4"
			/>
			<div class="mb-5 space-y-3">
				{#each providers as provider (provider.id)}
					<div class="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
						<div class="min-w-0 flex-1">
							<p class="font-medium">{provider.name}</p>
							<p class="truncate text-sm text-muted-foreground">{provider.issuer}</p>
							<dl class="mt-2 space-y-1 text-xs text-muted-foreground">
								<div>
									<dt class="font-medium text-foreground">{m.settings_sso_callback_url()}</dt>
									<dd class="break-all">{provider.callback_url}</dd>
								</div>
								<div>
									<dt class="font-medium text-foreground">
										{m.settings_sso_backchannel_url()}
									</dt>
									<dd class="break-all">{provider.backchannel_logout_url}</dd>
								</div>
							</dl>
							<p class="mt-1 text-xs text-muted-foreground">
								{provider.health_status}
								{#if provider.health_message}
									· {provider.health_message}{/if}
							</p>
						</div>
						<div class="flex gap-2">
							<Button
								type="button"
								size="sm"
								variant="outline"
								onclick={() => editProvider(provider)}
							>
								{m.common_edit()}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={busy === `provider-${provider.id}`}
								onclick={() => void setProviderActive(provider)}
							>
								{provider.is_active ? m.common_disable() : m.common_enable()}
							</Button>
						</div>
					</div>
				{:else}
					<p class="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
						{m.settings_sso_no_providers()}
					</p>
				{/each}
			</div>

			<form onsubmit={saveProvider} class="space-y-4 rounded-xl border bg-muted/10 p-4 sm:p-5">
				<div class="flex items-center justify-between gap-3">
					<h3 class="font-semibold">
						{providerID ? m.settings_sso_edit_provider() : m.settings_sso_add_provider()}
					</h3>
					{#if providerID}
						<Button type="button" variant="ghost" size="sm" onclick={resetProviderForm}>
							{m.common_cancel()}
						</Button>
					{/if}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="sso-provider-name">{m.settings_sso_provider_name()}</Label>
						<Input id="sso-provider-name" bind:value={providerName} required />
					</div>
					<div class="space-y-2">
						<Label for="sso-issuer">{m.settings_sso_issuer()}</Label>
						<Input id="sso-issuer" type="url" bind:value={issuer} required />
					</div>
					<div class="space-y-2">
						<Label for="sso-client-id">{m.settings_sso_client_id()}</Label>
						<Input id="sso-client-id" bind:value={clientID} required />
					</div>
					<div class="space-y-2">
						<Label for="sso-client-secret">{m.settings_sso_client_secret()}</Label>
						<Input
							id="sso-client-secret"
							type="password"
							bind:value={clientSecret}
							required={!providerID}
							placeholder={providerID ? m.settings_sso_secret_unchanged() : ''}
							autocomplete="new-password"
						/>
					</div>
					<div class="space-y-2 sm:col-span-2">
						<Label for="sso-scopes">{m.settings_sso_scopes()}</Label>
						<Input id="sso-scopes" bind:value={scopes} />
					</div>
					<div class="space-y-2">
						<Label for="sso-email-claim">{m.settings_sso_email_claim()}</Label>
						<Input id="sso-email-claim" bind:value={emailClaim} />
					</div>
					<div class="space-y-2">
						<Label for="sso-name-claim">{m.settings_sso_name_claim()}</Label>
						<Input id="sso-name-claim" bind:value={nameClaim} />
					</div>
					<div class="space-y-2">
						<Label for="sso-picture-claim">{m.settings_sso_picture_claim()}</Label>
						<Input id="sso-picture-claim" bind:value={pictureClaim} />
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-3">
					<label
						class="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 text-sm"
					>
						<Checkbox
							checked={jitEnabled}
							onCheckedChange={(value) => (jitEnabled = value === true)}
						/>
						{m.settings_sso_jit()}
					</label>
					<label
						class="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 text-sm"
					>
						<Checkbox
							checked={requireVerifiedEmail}
							onCheckedChange={(value) => (requireVerifiedEmail = value === true)}
						/>
						{m.settings_sso_verified_email()}
					</label>
					<label
						class="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 text-sm"
					>
						<Checkbox
							checked={useUserInfo}
							onCheckedChange={(value) => (useUserInfo = value === true)}
						/>
						{m.settings_sso_userinfo()}
					</label>
				</div>
				<Button type="submit" disabled={busy === 'provider'} class="gap-2">
					{#if busy === 'provider'}<LoaderIcon class="size-4 animate-spin" />{:else}<PlusIcon
							class="size-4"
						/>{/if}
					{m.common_save()}
				</Button>
			</form>
		</section>

		<section>
			<SectionHeader
				title={m.settings_sso_policy()}
				description={m.settings_sso_policy_description()}
				icon={ShieldCheckIcon}
				class="mb-4"
			/>
			<form onsubmit={savePolicy} class="space-y-5">
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="sso-mode">{m.settings_sso_mode()}</Label>
						<AppSelect
							id="sso-mode"
							value={policyMode}
							options={[
								{ value: 'disabled', label: m.settings_sso_mode_disabled() },
								{ value: 'optional', label: m.settings_sso_mode_optional() },
								{ value: 'required', label: m.settings_sso_mode_required() }
							]}
							class="w-full"
							ariaLabel={m.settings_sso_mode()}
							onValueChange={(value) => (policyMode = value as typeof policyMode)}
						/>
					</div>
					<div class="space-y-2">
						<Label for="sso-token-mode">{m.settings_sso_token_mode()}</Label>
						<AppSelect
							id="sso-token-mode"
							value={apiTokenMode}
							options={[
								{ value: 'scoped', label: m.settings_sso_tokens_scoped() },
								{ value: 'deny', label: m.settings_sso_tokens_deny() }
							]}
							class="w-full"
							ariaLabel={m.settings_sso_token_mode()}
							onValueChange={(value) => (apiTokenMode = value as typeof apiTokenMode)}
						/>
					</div>
					<div class="space-y-2">
						<Label for="sso-assurance-hours">{m.settings_sso_assurance_hours()}</Label>
						<Input
							id="sso-assurance-hours"
							type="number"
							min="1"
							max="720"
							bind:value={assuranceHours}
						/>
					</div>
					<div class="space-y-2">
						<Label for="sso-token-days">{m.settings_sso_token_days()}</Label>
						<Input id="sso-token-days" type="number" min="1" max="365" bind:value={maxTokenDays} />
					</div>
				</div>
				<fieldset class="space-y-2">
					<legend class="text-sm font-medium">{m.settings_sso_accepted_providers()}</legend>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each providers as provider (provider.id)}
							<label class="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
								<Checkbox
									checked={acceptedProviderIDs.includes(provider.id)}
									onCheckedChange={() => toggleAcceptedProvider(provider.id)}
								/>
								{provider.name}
							</label>
						{/each}
					</div>
				</fieldset>
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
						<Checkbox
							checked={passwordLoginAllowed}
							onCheckedChange={(value) => (passwordLoginAllowed = value === true)}
						/>
						{m.settings_sso_password_allowed()}
					</label>
					<label class="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm">
						<Checkbox
							checked={requireTokenReauth}
							onCheckedChange={(value) => (requireTokenReauth = value === true)}
						/>
						{m.settings_sso_token_reauth()}
					</label>
				</div>
				{#if policyMode === 'required'}
					<InlineNotice tone="warning" message={m.settings_sso_required_warning()} />
				{/if}
				<Button type="submit" disabled={busy === 'policy'} class="gap-2">
					{#if busy === 'policy'}<LoaderIcon class="size-4 animate-spin" />{/if}
					{m.common_save()}
				</Button>
			</form>
		</section>

		<section>
			<SectionHeader
				title={m.settings_sso_domains()}
				description={m.settings_sso_domains_description()}
				class="mb-4"
			/>
			<form onsubmit={createDomain} class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
				<div class="space-y-2">
					<Label for="sso-domain">{m.settings_sso_domain()}</Label>
					<Input id="sso-domain" bind:value={domainName} placeholder="example.com" required />
				</div>
				<div class="space-y-2">
					<Label for="sso-domain-provider">{m.settings_sso_provider()}</Label>
					<AppSelect
						id="sso-domain-provider"
						bind:value={domainProviderID}
						options={providers.map((provider) => ({
							value: provider.id,
							label: provider.name
						}))}
						class="w-full"
						ariaLabel={m.settings_sso_provider()}
						disabled={providers.length === 0}
					/>
				</div>
				<div class="flex items-end">
					<Button type="submit" disabled={busy === 'domain' || providers.length === 0}>
						{m.settings_sso_add_domain()}
					</Button>
				</div>
			</form>
			{#if pendingDNS}
				<div class="mt-4 rounded-xl border bg-muted/20 p-4 text-sm">
					<p class="font-medium">{m.settings_sso_dns_instruction()}</p>
					<dl class="mt-2 grid gap-2 break-all">
						<div>
							<dt class="text-muted-foreground">{m.settings_sso_dns_name()}</dt>
							<dd>{pendingDNS.name}</dd>
						</div>
						<div>
							<dt class="text-muted-foreground">{m.settings_sso_dns_value()}</dt>
							<dd>{pendingDNS.value}</dd>
						</div>
					</dl>
				</div>
			{/if}
			<div class="mt-4 space-y-2">
				{#each domains as domain (domain.id)}
					<div class="flex items-center justify-between gap-3 rounded-md border px-3 py-3">
						<div>
							<p class="text-sm font-medium">{domain.domain}</p>
							<p class="text-xs text-muted-foreground">
								{domain.verified_at ? m.settings_sso_verified() : m.settings_sso_unverified()}
							</p>
						</div>
						{#if !domain.verified_at}
							<Button
								type="button"
								size="sm"
								variant="outline"
								onclick={() => void verifyDomain(domain)}
								disabled={busy === `domain-${domain.id}`}
							>
								{m.settings_sso_verify()}
							</Button>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		<section>
			<SectionHeader
				title={m.settings_sso_audit()}
				description={m.settings_sso_audit_description()}
				class="mb-4"
			/>
			<div class="divide-y rounded-xl border">
				{#each auditEvents as event (event.id)}
					<div class="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="text-sm font-medium">{event.action}</p>
							{#if event.detail}<p class="text-xs text-muted-foreground">{event.detail}</p>{/if}
						</div>
						<time class="text-xs text-muted-foreground" datetime={event.created_at}>
							{new Date(event.created_at).toLocaleString()}
						</time>
					</div>
				{:else}
					<p class="p-4 text-sm text-muted-foreground">{m.settings_sso_no_audit()}</p>
				{/each}
			</div>
		</section>
	</div>
{/if}
