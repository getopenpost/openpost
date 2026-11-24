<script lang="ts">
	import type { SocialAccount } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import SocialAccountIdentity from '../social-account-identity.svelte';
	import type { ComposerDestinationAction } from './destination-action.svelte';

	interface Props {
		action: ComposerDestinationAction;
		accounts: SocialAccount[];
		/** The account whose version is the source; it is not offered as a target. */
		activeAccountId: string | null;
		uploadsPending: boolean;
		accountLabel: (account: SocialAccount) => string;
	}

	let { action, accounts, activeAccountId, uploadsPending, accountLabel }: Props = $props();
</script>

<Dialog.Root bind:open={action.destinationActionOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{action.destinationAction === 'copy' ? m.compose_copy_rendition() : m.compose_apply_media()}
			</Dialog.Title>
			<Dialog.Description>
				{action.destinationAction === 'copy'
					? m.compose_copy_rendition_description()
					: m.compose_apply_media_description()}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2 py-2">
			{#each accounts.filter((account) => account.id !== activeAccountId) as account (account.id)}
				<label class="flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-sm">
					<Checkbox
						checked={action.destinationActionTargetIds.includes(account.id)}
						disabled={uploadsPending}
						onCheckedChange={() => action.toggleDestinationActionTarget(account.id)}
					/>
					<SocialAccountIdentity
						class="min-w-0 flex-1"
						name={accountLabel(account)}
						platform={account.platform}
						avatarUrl={account.account_avatar_url}
					/>
				</label>
			{/each}
		</div>
		<Dialog.Footer>
			{#if action.destinationCopyError}<p role="alert" class="text-sm text-destructive">
					{action.destinationCopyError}
				</p>{/if}
			<Button
				type="button"
				variant="outline"
				onclick={() => (action.destinationActionOpen = false)}
			>
				{m.common_cancel()}
			</Button>
			<Button
				type="button"
				disabled={uploadsPending || action.destinationActionTargetIds.length === 0}
				onclick={action.applyDestinationAction}
			>
				{m.compose_apply_changes()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
