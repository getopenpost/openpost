<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import {
		BACKUP_EXPORT_URL,
		InstanceBackupError,
		RESTORE_CONFIRMATION_WORD,
		cancelRestore,
		confirmRestore,
		deleteRestorePoint,
		fetchBackupStatus,
		uploadBackup,
		waitForRestart,
		type BackupErrorCode,
		type BackupStatus,
		type BackupSummary
	} from '$lib/instance-backup';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';

	type Phase = 'idle' | 'uploading' | 'confirming' | 'restarting' | 'restarted' | 'timeout';

	let status = $state<BackupStatus | null>(null);
	let loadError = $state('');
	let actionError = $state('');
	let phase = $state<Phase>('idle');
	let progress = $state(0);
	let confirmOpen = $state(false);
	let confirmText = $state('');
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploadAbort: AbortController | null = null;
	let restartAbort: AbortController | null = null;

	const pending = $derived<BackupSummary | null>(status?.pending ?? null);
	const busy = $derived(phase === 'uploading' || phase === 'confirming' || phase === 'restarting');
	const confirmMatches = $derived(confirmText.trim().toLowerCase() === RESTORE_CONFIRMATION_WORD);

	async function refresh() {
		try {
			status = await fetchBackupStatus();
			loadError = '';
		} catch {
			loadError = m.settings_backup_load_failed();
		}
	}

	$effect(() => {
		void refresh();
	});

	onDestroy(() => {
		uploadAbort?.abort();
		restartAbort?.abort();
	});

	function formatBytes(value: number) {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let size = value;
		let unit = 0;
		while (size >= 1024 && unit < units.length - 1) {
			size /= 1024;
			unit += 1;
		}
		return `${new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(size)} ${units[unit]}`;
	}

	function formatDateTime(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function failureMessage(code: BackupErrorCode) {
		switch (code) {
			case 'invalid_backup':
				return m.settings_backup_error_invalid();
			case 'incompatible_backup':
				return m.settings_backup_error_incompatible();
			case 'backup_too_new':
				return m.settings_backup_error_too_new();
			case 'key_mismatch':
				return m.settings_backup_error_key_mismatch();
			case 'busy':
				return m.settings_backup_error_busy();
			case 'restart_unavailable':
				return m.settings_backup_error_restart_unavailable();
			default:
				return m.settings_backup_error_generic();
		}
	}

	function unsupportedMessage(reason: BackupStatus['unsupported_reason']) {
		if (reason === 'storage') return m.settings_backup_unsupported_storage();
		if (reason === 'process_role') return m.settings_backup_unsupported_process_role();
		return m.settings_backup_unsupported_database();
	}

	function chooseFile() {
		fileInput?.click();
	}

	async function onFileChosen() {
		const file = fileInput?.files?.[0];
		if (fileInput) fileInput.value = '';
		if (!file) return;
		actionError = '';
		phase = 'uploading';
		progress = 0;
		uploadAbort = new AbortController();
		try {
			await uploadBackup(file, (fraction) => (progress = fraction), uploadAbort.signal);
			await refresh();
			phase = 'idle';
		} catch (cause) {
			phase = 'idle';
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			actionError = failureMessage(cause instanceof InstanceBackupError ? cause.code : 'unknown');
			await refresh();
		} finally {
			uploadAbort = null;
		}
	}

	async function discardPending() {
		actionError = '';
		try {
			await cancelRestore();
			await refresh();
		} catch (cause) {
			actionError = failureMessage(cause instanceof InstanceBackupError ? cause.code : 'unknown');
		}
	}

	async function startRestore() {
		if (!confirmMatches || phase === 'confirming') return;
		actionError = '';
		phase = 'confirming';
		try {
			await confirmRestore();
		} catch (cause) {
			phase = 'idle';
			confirmOpen = false;
			actionError = failureMessage(cause instanceof InstanceBackupError ? cause.code : 'unknown');
			return;
		}
		confirmOpen = false;
		phase = 'restarting';
		restartAbort = new AbortController();
		const ready = await waitForRestart(restartAbort.signal);
		phase = ready && (await restoreWasApplied(restartAbort.signal)) ? 'restarted' : 'timeout';
	}

	async function restoreWasApplied(signal: AbortSignal) {
		try {
			const current = await fetchBackupStatus(signal);
			status = current;
			return current.pending === undefined;
		} catch (cause) {
			return cause instanceof InstanceBackupError && cause.status === 401;
		}
	}

	async function removeRestorePoint(name: string) {
		actionError = '';
		try {
			await deleteRestorePoint(name);
			await refresh();
		} catch (cause) {
			actionError = failureMessage(cause instanceof InstanceBackupError ? cause.code : 'unknown');
		}
	}

	function reloadApp() {
		window.location.reload();
	}
</script>

<div class="space-y-4" data-testid="instance-backup">
	<SectionHeader
		title={m.settings_backup_title()}
		description={m.settings_backup_description()}
		themeIconRole="settings"
	/>

	{#if loadError}
		<InlineNotice tone="error" message={loadError} />
	{:else if !status}
		<PageLoading layout="list" label={m.common_loading()} items={2} />
	{:else if !status.supported}
		<InlineNotice tone="info" message={unsupportedMessage(status.unsupported_reason)} />
	{:else}
		{#if actionError}
			<InlineNotice tone="error" message={actionError} onDismiss={() => (actionError = '')} />
		{/if}

		<div class="grid gap-4 lg:grid-cols-2">
			<section class="space-y-3 rounded-lg border bg-muted/20 p-4">
				<h3 class="font-medium">{m.settings_backup_export_title()}</h3>
				<p class="text-sm text-muted-foreground">{m.settings_backup_export_body()}</p>
				<p class="text-sm text-muted-foreground">{m.settings_backup_key_note()}</p>
				<Button href={BACKUP_EXPORT_URL} download disabled={busy}>
					{m.settings_backup_export_button()}
				</Button>
			</section>

			<section class="space-y-3 rounded-lg border bg-muted/20 p-4">
				<h3 class="font-medium">{m.settings_backup_restore_title()}</h3>
				<p class="text-sm text-muted-foreground">{m.settings_backup_restore_body()}</p>
				<Input
					bind:ref={fileInput}
					type="file"
					accept=".zip,application/zip"
					class="sr-only"
					tabindex={-1}
					onchange={onFileChosen}
				/>
				{#if phase === 'uploading'}
					<div class="space-y-2" role="status" aria-live="polite">
						<p class="text-sm">
							{m.settings_backup_uploading({ percent: Math.round(progress * 100) })}
						</p>
						<progress class="h-2 w-full" max="1" value={progress}></progress>
						<Button variant="outline" size="sm" onclick={() => uploadAbort?.abort()}>
							{m.common_cancel()}
						</Button>
					</div>
				{:else if pending}
					<InlineNotice tone="warning">
						<p class="font-medium">{m.settings_backup_ready_title()}</p>
						<p class="mt-1">
							{m.settings_backup_ready_body({
								date: formatDateTime(pending.created_at),
								files: pending.media_files,
								size: formatBytes(pending.database_bytes + pending.media_bytes)
							})}
						</p>
					</InlineNotice>
					<div class="flex flex-wrap gap-2">
						<Button variant="destructive" disabled={busy} onclick={() => (confirmOpen = true)}>
							{m.settings_backup_restore_button()}
						</Button>
						<Button variant="outline" disabled={busy} onclick={discardPending}>
							{m.settings_backup_discard()}
						</Button>
					</div>
				{:else}
					<Button variant="outline" disabled={busy} onclick={chooseFile}>
						{m.settings_backup_choose_file()}
					</Button>
				{/if}
			</section>
		</div>

		{#if phase === 'restarting'}
			<InlineNotice tone="info" message={m.settings_backup_restarting()} />
		{:else if phase === 'restarted'}
			<InlineNotice tone="success">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p>{m.settings_backup_restarted()}</p>
					<Button size="sm" onclick={reloadApp}>{m.settings_backup_reload()}</Button>
				</div>
			</InlineNotice>
		{:else if phase === 'timeout'}
			<InlineNotice tone="warning" message={m.settings_backup_restart_timeout()} />
		{/if}

		{#if status.restore_points.length > 0}
			<section class="space-y-3 rounded-lg border p-4">
				<h3 class="font-medium">{m.settings_backup_points_title()}</h3>
				<p class="text-sm text-muted-foreground">{m.settings_backup_points_body()}</p>
				<ul class="divide-y">
					{#each status.restore_points as point (point.name)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="min-w-0 text-sm">
								{formatDateTime(point.created_at)}
								<span class="text-muted-foreground">· {formatBytes(point.bytes)}</span>
							</span>
							<Button variant="outline" size="sm" onclick={() => removeRestorePoint(point.name)}>
								{m.settings_backup_points_delete()}
							</Button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<Dialog.Root bind:open={confirmOpen}>
	<Dialog.Content aria-busy={phase === 'confirming'} showCloseButton={false} class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.settings_backup_confirm_title()}</Dialog.Title>
			<Dialog.Description>{m.settings_backup_confirm_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2">
			<Label for="backup-restore-confirmation">
				{m.settings_backup_confirm_prompt({ word: RESTORE_CONFIRMATION_WORD })}
			</Label>
			<Input
				id="backup-restore-confirmation"
				bind:value={confirmText}
				autocomplete="off"
				onkeydown={(event) => {
					if (event.key === 'Enter') void startRestore();
				}}
			/>
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				class="w-full sm:w-auto"
				disabled={phase === 'confirming'}
				onclick={() => (confirmOpen = false)}
			>
				{m.common_cancel()}
			</Button>
			<Button
				variant="destructive"
				class="w-full sm:w-auto"
				disabled={!confirmMatches || phase === 'confirming'}
				onclick={startRestore}
			>
				{#if phase === 'confirming'}<ProtectedIcon
						icon="loading"
						class="size-4 animate-spin motion-reduce:animate-none"
					/>{/if}
				{m.settings_backup_confirm_button()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
