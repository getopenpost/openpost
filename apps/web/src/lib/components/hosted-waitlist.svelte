<script lang="ts">
	import { resolveAppPath } from '$lib/app-path';
	import { client } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import StandaloneShell from '$lib/components/standalone-shell.svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';

	let { privacyURL, loginHref }: { privacyURL?: string; loginHref: string } = $props();
	let email = $state('');
	let submitting = $state(false);
	let joined = $state(false);
	let error = $state('');

	async function join(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		submitting = true;
		error = '';
		try {
			const result = await client.POST('/auth/waitlist', { body: { email: email.trim() } });
			if (result.error || !result.data?.joined) {
				error = result.response.status === 429 ? m.waitlist_rate_limited() : m.waitlist_failed();
				return;
			}
			joined = true;
		} catch {
			error = m.waitlist_failed();
		} finally {
			submitting = false;
		}
	}
</script>

<StandaloneShell title={m.waitlist_heading()} description={m.waitlist_description()} logoHref="/">
	{#if joined}
		<InlineNotice tone="success" message={m.waitlist_success()} />
	{:else}
		<form onsubmit={join} class="space-y-4" aria-busy={submitting}>
			{#if error}
				<InlineNotice tone="error" message={error} />
			{/if}
			<div class="space-y-2">
				<Label for="waitlist-email">{m.common_email()}</Label>
				<Input
					id="waitlist-email"
					type="email"
					bind:value={email}
					required
					maxlength={254}
					autocomplete="email"
					placeholder={m.auth_email_placeholder()}
					disabled={submitting}
					aria-describedby="waitlist-purpose"
				/>
			</div>
			<p id="waitlist-purpose" class="text-sm/relaxed text-muted-foreground">
				{m.waitlist_email_purpose()}
				<a
					href={privacyURL || 'https://openpo.st/privacy'}
					class="font-medium text-primary underline underline-offset-4"
					target="_blank"
					rel="noreferrer">{m.auth_register_privacy()}</a
				>
			</p>
			<Button type="submit" class="w-full gap-2" disabled={submitting}>
				{#if submitting}
					<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
					{m.waitlist_submitting()}
				{:else}
					{m.waitlist_submit()}
				{/if}
			</Button>
		</form>
	{/if}
	<p class="mt-6 text-center text-sm text-muted-foreground">
		{m.auth_register_have_account()}
		<a
			href={resolveAppPath(loginHref)}
			class="inline-flex min-h-11 items-center rounded-sm px-1 font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			>{m.auth_register_sign_in()}</a
		>
	</p>
</StandaloneShell>
