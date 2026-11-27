<script lang="ts">
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import MentionProfileField from './mention-profile-field.svelte';
	import {
		querySavedMentions,
		saveSavedMention,
		deleteSavedMention
	} from '$lib/query/saved-mentions';
	import type { SavedMention } from '@openpost/query-catalog';
	import type { MentionProfile } from '@openpost/platform-text/mentions';
	import type { SocialAccount } from '$lib/api/client';
	import { getPlatformName } from '$lib/utils';
	import { m } from '$lib/paraglide/messages';

	let {
		dialogId,
		workspaceId,
		accounts,
		initialName,
		onclose,
		oninsert
	}: {
		dialogId: number;
		workspaceId: string;
		accounts: SocialAccount[];
		initialName: string;
		onclose: () => void;
		oninsert: (entry: SavedMention, origin: number) => void;
	} = $props();
	const nameID = $props.id();
	let name = $state(untrack(() => `@${initialName.replace(/^@/, '')}`));
	let editingID = $state<string | undefined>();
	let profiles = $state<MentionProfile[]>([]);
	let entries = $state<SavedMention[]>([]);
	let busy = $state(false);
	let error = $state('');
	let loading = $state(true);
	const rows = $derived.by(() => {
		const result = new Map<
			string,
			{ key: string; provider: string; authority?: string; account?: SocialAccount; label: string }
		>();
		for (const account of accounts) {
			const authority =
				account.platform === 'mastodon'
					? account.instance_url?.replace(/\/$/, '').toLowerCase()
					: undefined;
			const key = `${account.platform}:${authority ?? ''}`;
			if (!result.has(key))
				result.set(key, {
					key,
					provider: account.platform,
					authority,
					account,
					label: `${getPlatformName(account.platform)}${authority ? ` (${authority.replace('https://', '')})` : ''}`
				});
		}
		for (const provider of ['x', 'bluesky', 'linkedin', 'instagram', 'threads']) {
			const key = `${provider}:`;
			if (!result.has(key)) result.set(key, { key, provider, label: getPlatformName(provider) });
		}
		for (const profile of profiles) {
			const key = `${profile.provider}:${profile.authority ?? ''}`;
			if (!result.has(key))
				result.set(key, {
					key,
					provider: profile.provider,
					authority: profile.authority,
					label: `${getPlatformName(profile.provider)}${profile.authority ? ` (${profile.authority})` : ''}`
				});
		}
		return [...result.values()];
	});
	const normalizedName = $derived(`@${name.trim().replace(/^@/, '').replace(/\s+/g, '-')}`);
	const canSave = $derived(
		/^@[\p{L}\p{N}_.-]{1,79}$/u.test(normalizedName) &&
			profiles.some((profile) => profile.text.trim())
	);
	$effect(() => {
		const workspace = workspaceId;
		const controller = new AbortController();
		void querySavedMentions(workspace, controller.signal)
			.then((list) => {
				if (!controller.signal.aborted) entries = list;
			})
			.catch(() => {
				if (!controller.signal.aborted) error = m.saved_mentions_load_failed();
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
	function edit(entry?: SavedMention) {
		editingID = entry?.id;
		name = entry?.name ?? '@';
		profiles = structuredClone($state.snapshot(entry?.profiles ?? []));
		error = '';
	}
	async function save() {
		const origin = dialogId;
		busy = true;
		error = '';
		try {
			oninsert(
				await saveSavedMention(
					workspaceId,
					normalizedName,
					profiles.filter((profile) => profile.text.trim()),
					editingID
				),
				origin
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.saved_mentions_save_failed();
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (!editingID) return;
		busy = true;
		error = '';
		const id = editingID;
		try {
			await deleteSavedMention(workspaceId, id);
			entries = entries.filter((entry) => entry.id !== id);
			edit();
		} catch {
			error = m.saved_mentions_save_failed();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root
	open
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Dialog.Content class="flex max-h-[85dvh] max-w-lg flex-col">
		<Dialog.Header
			><Dialog.Title>{m.saved_mentions_title()}</Dialog.Title><Dialog.Description
				>{m.saved_mentions_description()}</Dialog.Description
			></Dialog.Header
		>
		<div class="min-h-0 space-y-5 overflow-y-auto pe-1">
			{#if loading}<p class="text-sm text-muted-foreground" role="status">
					{m.editor_searching()}
				</p>{/if}
			{#if entries.length}
				<div class="flex flex-wrap gap-1" aria-label={m.saved_mentions_title()}>
					{#each entries as entry (entry.id)}<Button
							variant={editingID === entry.id ? 'secondary' : 'ghost'}
							size="sm"
							disabled={busy}
							onclick={() => edit(entry)}>{entry.name}</Button
						>{/each}
					<Button variant="ghost" size="sm" disabled={busy} onclick={() => edit()}
						>{m.saved_mentions_new()}</Button
					>
				</div>
			{/if}
			<div class="space-y-2">
				<Label for={nameID}>{m.saved_mentions_name()}</Label><Input
					id={nameID}
					bind:value={name}
					placeholder="@alice"
					disabled={busy}
				/>
			</div>
			<fieldset disabled={busy} class="space-y-5">
				{#each rows as row (row.key)}
					<MentionProfileField
						{workspaceId}
						account={row.account}
						label={row.label}
						value={profiles.find(
							(profile) =>
								profile.provider === row.provider &&
								(profile.authority ?? '') === (row.authority ?? '')
						) ?? { provider: row.provider, authority: row.authority, text: '' }}
						onchange={(value) => {
							profiles = [
								...profiles.filter(
									(profile) =>
										profile.provider !== row.provider ||
										(profile.authority ?? '') !== (row.authority ?? '')
								),
								value
							];
						}}
					/>
				{/each}
			</fieldset>
			{#if error}<InlineNotice tone="error" message={error} />{/if}
			{#if editingID}<p class="text-xs text-muted-foreground">
					{m.saved_mentions_delete_hint()}
				</p>{/if}
		</div>
		<Dialog.Footer class="shrink-0">
			{#if editingID}<Button variant="destructive" disabled={busy} onclick={remove}
					>{m.common_delete()}</Button
				>{/if}
			<Button variant="outline" disabled={busy} onclick={onclose}>{m.common_cancel()}</Button>
			<Button disabled={busy || !canSave} onclick={save}>{m.saved_mentions_save_insert()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
