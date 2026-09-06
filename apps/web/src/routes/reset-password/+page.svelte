<script lang="ts">
	import { onMount } from 'svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import {
		PASSWORD_MIN_CHARACTERS,
		PASSWORD_MAX_CHARACTERS,
		passwordCharacterCount
	} from '$lib/password-policy';
	import FieldFeedback from '$lib/components/field-feedback.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { client } from '$lib/api/client';
	import { m } from '$lib/paraglide/messages';

	let token = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let error = $state('');
	let loading = $state(false);
	let complete = $state(false);
	let newPasswordTouched = $state(false);
	let confirmPasswordTouched = $state(false);
	let passwordInput = $state<HTMLInputElement | null>(null);
	let confirmationInput = $state<HTMLInputElement | null>(null);
	const newPasswordError = $derived(validatePassword(newPassword));
	const confirmPasswordError = $derived(
		!confirmPassword
			? m.interaction_field_required()
			: newPassword !== confirmPassword
				? m.auth_register_password_mismatch()
				: ''
	);
	function validatePassword(value: string): string {
		const count = passwordCharacterCount(value);
		if (!count) return m.interaction_field_required();
		if (count < PASSWORD_MIN_CHARACTERS) return m.auth_register_password_short();
		if (count > PASSWORD_MAX_CHARACTERS) return m.auth_register_password_long();
		return '';
	}

	onMount(() => {
		const fragment = new URLSearchParams(window.location.hash.slice(1));
		token = fragment.get('token')?.trim() ?? '';
		history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
		if (!token) error = m.auth_reset_invalid_link();
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		newPasswordTouched = true;
		confirmPasswordTouched = true;
		if (!token) {
			error = m.auth_reset_invalid_link();
			return;
		}
		if (newPasswordError) {
			passwordInput?.focus();
			return;
		}
		if (confirmPasswordError) {
			confirmationInput?.focus();
			return;
		}

		loading = true;
		const { error: responseError } = await client.POST('/auth/password-reset/confirm', {
			body: { token, new_password: newPassword }
		});
		loading = false;
		if (responseError) {
			error = responseError.detail ?? m.auth_login_failed();
			return;
		}
		token = '';
		newPassword = '';
		confirmPassword = '';
		complete = true;
	}
</script>

<svelte:head>
	<title>{m.auth_reset_title()}</title>
</svelte:head>

{#if complete}
	{#snippet successIcon()}
		<ProtectedIcon icon="success" class="size-6 text-emerald-600 dark:text-emerald-400" />
	{/snippet}
	<StandaloneShell
		title={m.auth_reset_success_title()}
		description={m.auth_reset_success_description()}
		icon={successIcon}
	>
		<a
			href={resolve('/login')}
			class="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			{m.auth_reset_sign_in()}
		</a>
	</StandaloneShell>
{:else}
	<StandaloneShell
		title={m.auth_reset_heading()}
		description={m.auth_reset_description()}
		logoHref="/"
	>
		{#if error}
			<InlineNotice tone="error" message={error} class="mb-4" />
		{/if}

		<form novalidate onsubmit={submit} class="space-y-4">
			<div class="space-y-2">
				<Label for="new-password">{m.settings_new_password()}</Label>
				<Input
					id="new-password"
					bind:ref={passwordInput}
					type="password"
					bind:value={newPassword}
					minlength={PASSWORD_MIN_CHARACTERS}
					autocomplete="new-password"
					placeholder={m.auth_password_min_placeholder()}
					required
					onblur={() => (newPasswordTouched = true)}
					aria-invalid={Boolean(newPasswordTouched && newPasswordError)}
					aria-describedby="new-password-feedback"
				/>
				<FieldFeedback
					id="new-password-feedback"
					error={newPasswordError}
					touched={newPasswordTouched}
				/>
			</div>
			<div class="space-y-2">
				<Label for="confirm-password">{m.settings_confirm_new_password()}</Label>
				<Input
					id="confirm-password"
					bind:ref={confirmationInput}
					type="password"
					bind:value={confirmPassword}
					minlength={PASSWORD_MIN_CHARACTERS}
					autocomplete="new-password"
					required
					onblur={() => (confirmPasswordTouched = true)}
					aria-invalid={Boolean(confirmPasswordTouched && confirmPasswordError)}
					aria-describedby="confirm-password-feedback"
				/>
				<FieldFeedback
					id="confirm-password-feedback"
					error={confirmPasswordError}
					touched={confirmPasswordTouched}
				/>
			</div>
			<Button type="submit" class="w-full gap-2" disabled={loading || !token}>
				{#if loading}<ProtectedIcon icon="loading" class="size-4 animate-spin" />{/if}
				{loading ? m.auth_reset_loading() : m.auth_reset_submit()}
			</Button>
		</form>

		{#if !token}
			<p class="mt-6 text-center text-sm">
				<a
					href={resolve('/forgot-password')}
					class="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
					>{m.auth_reset_request_new()}</a
				>
			</p>
		{/if}
	</StandaloneShell>
{/if}
