<script lang="ts">
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { m } from '$lib/paraglide/messages';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileAudioIcon from '@lucide/svelte/icons/file-audio';
	import FileVideoIcon from '@lucide/svelte/icons/file-video';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import {
		deleteExportEntry,
		listExportEntries,
		readExportFile,
		workspaceFolderName,
		type ExportEntry
	} from '../workspace-fs/exports';
	import { createLogger } from '../workspace-fs/logger';

	const logger = createLogger('SavedExports');

	interface Props {
		projectId: string;
		refreshKey?: string;
		listFiles?: typeof listExportEntries;
		readFile?: typeof readExportFile;
		deleteEntry?: typeof deleteExportEntry;
		getFolderName?: typeof workspaceFolderName;
	}
	type LoadTrigger = Pick<Props, 'projectId' | 'refreshKey'>;

	let {
		projectId,
		refreshKey = '',
		listFiles = listExportEntries,
		readFile = readExportFile,
		deleteEntry = deleteExportEntry,
		getFolderName = workspaceFolderName
	}: Props = $props();

	let entries = $state<ExportEntry[] | null>(null);
	let loading = $state(false);
	let loadError = $state('');
	let operationError = $state('');
	let busyPath = $state('');
	let deleteDialogOpen = $state(false);
	let pendingDelete = $state<ExportEntry | null>(null);
	let loadGeneration = 0;

	const folderName = $derived(getFolderName());

	function pathKey(entry: ExportEntry): string {
		return entry.path.join('/');
	}

	function asError(cause: unknown): Error {
		return cause instanceof Error ? cause : new Error(String(cause));
	}

	function isAudioFile(name: string): boolean {
		return /\.(aac|m4a|mp3|opus|wav)$/i.test(name);
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let value = bytes / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
		return `${value.toFixed(digits)} ${units[unit]}`;
	}

	function formatDate(timestamp: number): string {
		if (timestamp <= 0) return '';
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(timestamp);
	}

	async function load(trigger: LoadTrigger = { projectId, refreshKey }): Promise<void> {
		const generation = ++loadGeneration;
		loading = true;
		loadError = '';
		try {
			const next = await listFiles(trigger.projectId);
			if (generation === loadGeneration) entries = next;
		} catch (cause) {
			if (generation === loadGeneration) {
				entries = null;
				loadError = m.video_editor_saved_exports_load_failed();
				logger.error('Failed to list saved exports', asError(cause));
			}
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	}

	async function download(entry: ExportEntry): Promise<void> {
		if (entry.kind !== 'file') return;
		const key = pathKey(entry);
		if (busyPath) return;
		busyPath = key;
		operationError = '';
		let url = '';
		try {
			const blob = await readFile(entry.path);
			if (!blob) {
				await load();
				operationError = m.video_editor_saved_exports_missing();
				return;
			}
			url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = entry.name;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
		} catch (cause) {
			logger.error('Failed to download saved export', asError(cause));
			operationError = m.video_editor_saved_exports_download_failed();
		} finally {
			if (url) window.setTimeout(() => URL.revokeObjectURL(url), 0);
			busyPath = '';
		}
	}

	function requestDelete(entry: ExportEntry): void {
		operationError = '';
		pendingDelete = entry;
		deleteDialogOpen = true;
	}

	async function confirmDelete() {
		if (!pendingDelete) return { ok: false, message: m.video_editor_saved_exports_delete_failed() };
		const entry = pendingDelete;
		busyPath = pathKey(entry);
		try {
			await deleteEntry(entry.path, entry.kind === 'directory');
			await load();
			pendingDelete = null;
			return {
				ok: true,
				successMessage: m.video_editor_saved_exports_deleted({ name: entry.name })
			};
		} catch (cause) {
			logger.error('Failed to delete saved export', asError(cause));
			return { ok: false, message: m.video_editor_saved_exports_delete_failed() };
		} finally {
			busyPath = '';
		}
	}

	$effect(() => {
		void load({ projectId, refreshKey });
	});
</script>

<div class="space-y-3" data-testid="saved-exports-panel">
	<div
		class="flex items-start gap-2 rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] px-3 py-2 text-xs text-[var(--video-editor-muted)]"
	>
		<FolderOpenIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
		<span>
			{folderName
				? m.video_editor_saved_exports_location({ folder: folderName })
				: m.video_editor_saved_exports_location_generic()}
		</span>
	</div>

	<div class="flex items-center justify-end">
		<Button
			size="sm"
			variant="ghost"
			disabled={loading}
			onclick={() => void load()}
			aria-label={m.video_editor_saved_exports_refresh()}
		>
			<RefreshIcon
				class={loading ? 'animate-spin motion-reduce:animate-none' : ''}
				aria-hidden="true"
			/>
			{m.common_refresh()}
		</Button>
	</div>

	{#if loadError}
		<InlineNotice tone="error" message={loadError}>
			{#snippet actions()}
				<Button size="sm" variant="outline" onclick={() => void load()}>
					{m.video_editor_saved_exports_retry()}
				</Button>
			{/snippet}
		</InlineNotice>
	{:else if operationError}
		<InlineNotice
			tone="error"
			message={operationError}
			onDismiss={() => (operationError = '')}
			dismissLabel={m.common_dismiss()}
		/>
	{/if}

	<div class="max-h-[50dvh] min-h-0 overflow-y-auto pr-1">
		{#if loading && entries === null}
			<div
				class="flex items-center justify-center gap-2 py-10 text-sm text-[var(--video-editor-muted)]"
				role="status"
			>
				<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
				{m.common_loading()}
			</div>
		{:else if entries?.length === 0}
			<div
				class="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--video-editor-muted)]"
			>
				<FolderOpenIcon class="size-6" aria-hidden="true" />
				<p class="max-w-72">{m.video_editor_saved_exports_empty()}</p>
			</div>
		{:else if entries}
			<ul class="space-y-2">
				{#each entries as entry (pathKey(entry))}
					<li>
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<div
									data-export-path={pathKey(entry)}
									class="flex items-center gap-2.5 rounded-lg border border-[var(--video-editor-border)] bg-[var(--video-editor-control)] p-3"
								>
									{#if entry.kind === 'directory'}
										<FolderOpenIcon
											class="size-4 shrink-0 text-[var(--video-editor-muted)]"
											aria-hidden="true"
										/>
									{:else if isAudioFile(entry.name)}
										<FileAudioIcon
											class="size-4 shrink-0 text-[var(--video-editor-muted)]"
											aria-hidden="true"
										/>
									{:else}
										<FileVideoIcon
											class="size-4 shrink-0 text-[var(--video-editor-muted)]"
											aria-hidden="true"
										/>
									{/if}
									<div class="min-w-0 flex-1">
										<p class="text-sm leading-tight font-medium break-words">{entry.name}</p>
										<p class="mt-0.5 text-[11px] text-[var(--video-editor-muted)] tabular-nums">
											{entry.kind === 'directory'
												? m.video_editor_saved_exports_folder()
												: formatBytes(entry.size)}{#if entry.lastModified > 0}
												· {formatDate(entry.lastModified)}{/if}
										</p>
									</div>
									<div class="flex shrink-0 gap-0.5">
										{#if entry.kind === 'file'}
											<Button
												variant="ghost"
												size="icon-sm"
												disabled={Boolean(busyPath)}
												onclick={() => void download(entry)}
												aria-label={m.video_editor_saved_exports_download_named({
													name: entry.name
												})}
											>
												{#if busyPath === pathKey(entry)}
													<LoaderIcon
														class="animate-spin motion-reduce:animate-none"
														aria-hidden="true"
													/>
												{:else}
													<DownloadIcon aria-hidden="true" />
												{/if}
											</Button>
										{/if}
										<Button
											variant="ghost"
											size="icon-sm"
											disabled={Boolean(busyPath)}
											onclick={() => requestDelete(entry)}
											aria-label={m.video_editor_saved_exports_delete_named({ name: entry.name })}
										>
											<TrashIcon aria-hidden="true" />
										</Button>
									</div>
								</div>
							</ContextMenu.Trigger>
							<ContextMenu.Content class="video-editor-theme w-64">
								{#if entry.kind === 'file'}
									<ContextMenu.Item
										disabled={Boolean(busyPath)}
										onclick={() => void download(entry)}
									>
										{m.video_editor_saved_exports_download_named({ name: entry.name })}
									</ContextMenu.Item>
									<ContextMenu.Separator />
								{/if}
								<ContextMenu.Item
									variant="destructive"
									disabled={Boolean(busyPath)}
									onclick={() => requestDelete(entry)}
								>
									{m.video_editor_saved_exports_delete_named({ name: entry.name })}
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Root>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<DestructiveConfirmDialog
	bind:open={deleteDialogOpen}
	title={pendingDelete
		? m.video_editor_saved_exports_delete_title({ name: pendingDelete.name })
		: ''}
	description={m.video_editor_saved_exports_delete_description()}
	onConfirm={confirmDelete}
/>
