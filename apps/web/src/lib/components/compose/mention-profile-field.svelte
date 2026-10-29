<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import type { SocialAccount } from '$lib/api/client';
	import {
		nativeMentionTarget,
		type MentionCandidate,
		type MentionProfile
	} from '@openpost/platform-text/mentions';
	import { lookupComposerMentions } from '$lib/query/mentions';
	import { m } from '$lib/paraglide/messages';

	let {
		workspaceId,
		account,
		label,
		value,
		onchange
	}: {
		workspaceId: string;
		account?: SocialAccount;
		label: string;
		value: MentionProfile;
		onchange: (value: MentionProfile) => void;
	} = $props();
	const id = $props.id();
	let matches = $state<MentionCandidate[]>([]);
	let loading = $state(false);
	let error = $state('');
	let query = $state<string | null>(null);
	let request: AbortController | undefined;
	const native = $derived(
		account && ['bluesky', 'mastodon', 'linkedin'].includes(account.platform)
	);
	$effect(() => {
		const text = query;
		const destination = account;
		const workspace = workspaceId;
		request?.abort();
		matches = [];
		error = '';
		if (!native || !destination || text === null || text.trim().replace(/^@/, '').length < 2) {
			loading = false;
			return;
		}
		const controller = new AbortController();
		request = controller;
		loading = true;
		const timer = setTimeout(async () => {
			try {
				const found = await lookupComposerMentions(
					workspace,
					destination.id,
					text.trim().replace(/^@/, ''),
					controller.signal
				);
				if (!controller.signal.aborted) matches = found;
			} catch {
				if (!controller.signal.aborted) error = m.editor_lookup_failed();
			} finally {
				if (!controller.signal.aborted) loading = false;
			}
		}, 180);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	onDestroy(() => request?.abort());
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between gap-2">
		<Label for={id}>{label}</Label>
		{#if value.target}<span class="text-xs text-muted-foreground">{m.saved_mentions_native()}</span
			>{/if}
	</div>
	<Input
		{id}
		value={value.text}
		placeholder={m.saved_mentions_text()}
		oninput={(event) => {
			query = event.currentTarget.value;
			onchange({ ...value, text: query, target: undefined });
		}}
	/>
	{#if native}<p class="text-xs text-muted-foreground">{m.saved_mentions_native_hint()}</p>{/if}
	{#if loading}<p class="text-xs text-muted-foreground" role="status">
			{m.editor_searching()}
		</p>{/if}
	{#if error}<p class="text-xs text-destructive" role="status">{error}</p>{/if}
	{#if matches.length}
		<div class="space-y-1" aria-label={m.editor_mentions()}>
			{#each matches as candidate (candidate.target.id)}
				<Button
					multiline
					variant="ghost"
					class="h-auto min-h-11 w-full justify-start text-left"
					onclick={() => {
						const target = nativeMentionTarget(candidate.target);
						if (!target) return;
						onchange({ ...value, text: candidate.label, target });
						query = null;
						matches = [];
					}}
					><span class="min-w-0 truncate"
						>{candidate.label}{#if candidate.detail}<span class="ml-2 text-muted-foreground"
								>{candidate.detail}</span
							>{/if}</span
					></Button
				>
			{/each}
		</div>
	{/if}
</div>
