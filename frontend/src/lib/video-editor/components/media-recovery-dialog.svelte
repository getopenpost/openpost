<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import { showToast } from '$lib/toast';
	import { mediaRecovery } from '$lib/video-editor/media/media-recovery.svelte';
	import {
		automaticOrphanMatches,
		compatibleRecoveryMedia,
		type MediaSourceIssue,
		type OrphanedTimelineClip
	} from '$lib/video-editor/media/media-recovery';
	import { formatMediaListSummary } from '$lib/video-editor/media/library-view';
	import {
		relinkMediaSource,
		requestMediaSourceAccess
	} from '$lib/video-editor/media/media-source-recovery';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import type { MediaMetadata } from '$lib/video-editor/media/types';
	import { removeItems } from '$lib/video-editor/timeline/actions/items';
	import {
		relinkOrphanedClip,
		relinkOrphanedClips
	} from '$lib/video-editor/timeline/actions/media-recovery';
	import AlertTriangleIcon from '@lucide/svelte/icons/triangle-alert';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import WandIcon from '@lucide/svelte/icons/wand-sparkles';

	let { onedit = () => undefined }: { onedit?: () => void } = $props();

	let busyId = $state<string | null>(null);
	let error = $state('');
	let replacementFor = $state<OrphanedTimelineClip | null>(null);
	const replacementOptions = $derived(
		replacementFor ? compatibleRecoveryMedia(replacementFor, mediaPool.mediaList) : []
	);
	const automaticMatches = $derived(
		automaticOrphanMatches(mediaRecovery.orphanedClips, mediaPool.mediaList)
	);

	function issueText(issue: MediaSourceIssue): string {
		switch (issue.kind) {
			case 'permission':
				return m.video_editor_media_recovery_permission();
			case 'changed':
				return m.video_editor_media_recovery_changed();
			default:
				return m.video_editor_media_recovery_missing();
		}
	}

	function close(): void {
		mediaRecovery.open = false;
		replacementFor = null;
		error = '';
	}

	async function grantAccess(issue: MediaSourceIssue): Promise<void> {
		const media = mediaPool.get(issue.mediaId);
		if (!media) return;
		busyId = issue.mediaId;
		error = '';
		try {
			if (!(await requestMediaSourceAccess(media))) {
				error = m.video_editor_media_recovery_access_denied();
				return;
			}
			await mediaRecovery.refresh();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : String(reason);
		} finally {
			busyId = null;
		}
	}

	async function locateFile(issue: MediaSourceIssue): Promise<void> {
		const media = mediaPool.get(issue.mediaId);
		if (!media) return;
		busyId = issue.mediaId;
		error = '';
		try {
			const handles = await window.showOpenFilePicker?.({ multiple: false });
			const handle = handles?.[0];
			if (!handle) return;
			const restored = await relinkMediaSource(media, handle);
			await mediaRecovery.refresh();
			showToast(m.video_editor_media_recovery_restored({ name: restored.fileName }), 'success');
		} catch (reason) {
			if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
				error = reason instanceof Error ? reason.message : String(reason);
			}
		} finally {
			busyId = null;
		}
	}

	async function replaceOrphan(orphan: OrphanedTimelineClip, mediaId: string): Promise<void> {
		const replacement = mediaPool.get(mediaId);
		if (!replacement) return;
		busyId = orphan.itemId;
		error = '';
		try {
			const result = relinkOrphanedClip(orphan.itemId, replacement);
			if (!result.ok) {
				error =
					result.reason === 'locked'
						? m.video_editor_media_recovery_locked()
						: m.video_editor_media_recovery_no_replacements();
				return;
			}
			replacementFor = null;
			onedit();
			await mediaRecovery.refresh();
		} finally {
			busyId = null;
		}
	}

	async function autoMatch(): Promise<void> {
		const seenMissingIds = new Set<string>();
		const requests: Array<{ itemId: string; replacement: MediaMetadata }> = [];
		for (const orphan of mediaRecovery.orphanedClips) {
			if (seenMissingIds.has(orphan.mediaId)) continue;
			const mediaId = automaticMatches.get(orphan.itemId);
			const replacement = mediaId ? mediaPool.get(mediaId) : undefined;
			if (!replacement) continue;
			seenMissingIds.add(orphan.mediaId);
			requests.push({ itemId: orphan.itemId, replacement });
		}
		if (requests.length === 0) return;
		busyId = 'auto-match';
		error = '';
		try {
			const result = relinkOrphanedClips(requests);
			if (!result.ok) {
				error =
					result.reason === 'locked'
						? m.video_editor_media_recovery_locked()
						: m.video_editor_media_recovery_no_replacements();
				return;
			}
			onedit();
			await mediaRecovery.refresh();
			showToast(m.video_editor_media_recovery_matched({ count: result.itemIds.length }), 'success');
		} finally {
			busyId = null;
		}
	}

	async function removeOrphans(itemIds: string[]): Promise<void> {
		error = '';
		const removed = removeItems(itemIds, true);
		if (removed.length === 0) {
			error = m.video_editor_media_recovery_locked();
			return;
		}
		replacementFor = null;
		onedit();
		await mediaRecovery.refresh();
	}

	function chooseReplacement(mediaId: string): void {
		const orphan = replacementFor;
		if (orphan) void replaceOrphan(orphan, mediaId);
	}
</script>

<Dialog.Root
	open={mediaRecovery.open}
	onOpenChange={(open) => {
		if (!open && busyId !== null) return;
		mediaRecovery.open = open;
		if (!open) replacementFor = null;
	}}
>
	<Dialog.Content
		class="video-editor-theme max-h-[min(88dvh,46rem)] w-[calc(100%_-_1rem)] max-w-2xl overflow-y-auto border-[oklch(0.31_0.018_55)] bg-[oklch(0.16_0.012_50)] text-[var(--video-editor-text)] sm:max-w-2xl"
		showCloseButton={busyId === null}
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<AlertTriangleIcon class="size-4 text-amber-400" aria-hidden="true" />
				{replacementFor
					? m.video_editor_media_recovery_replacement_title({ name: replacementFor.label })
					: m.video_editor_media_recovery_title()}
			</Dialog.Title>
			<Dialog.Description class="text-xs text-[var(--video-editor-muted)]">
				{replacementFor
					? m.video_editor_media_recovery_orphans_description()
					: m.video_editor_media_recovery_description()}
			</Dialog.Description>
		</Dialog.Header>

		{#if error}
			<p
				class="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
				role="alert"
			>
				{error}
			</p>
		{/if}

		{#if replacementFor}
			<div class="mt-4 space-y-3">
				<Button type="button" variant="ghost" size="sm" onclick={() => (replacementFor = null)}>
					<ArrowLeftIcon class="size-3.5" aria-hidden="true" />
					{m.common_back()}
				</Button>
				{#if replacementOptions.length === 0}
					<p
						class="rounded-md border border-dashed border-[oklch(0.31_0.018_55)] px-3 py-6 text-center text-xs text-[var(--video-editor-muted)]"
					>
						{m.video_editor_media_recovery_no_replacements()}
					</p>
				{:else}
					<ul class="space-y-1.5">
						{#each replacementOptions as media (media.id)}
							<li
								class="flex items-center gap-3 rounded-md border border-[oklch(0.28_0.014_55)] bg-[oklch(0.19_0.01_50)] p-2"
							>
								<div class="min-w-0 flex-1">
									<p class="truncate text-xs font-medium">{media.fileName}</p>
									<p class="text-[10px] text-[var(--video-editor-muted)]">
										{formatMediaListSummary(media)}
									</p>
								</div>
								<Button
									size="sm"
									disabled={busyId !== null}
									onclick={() => chooseReplacement(media.id)}
								>
									{m.video_editor_media_recovery_choose()}
								</Button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{:else}
			<div class="mt-4 space-y-5">
				{#if mediaRecovery.sourceIssues.length > 0}
					<section aria-labelledby="media-recovery-sources">
						<h3 id="media-recovery-sources" class="text-xs font-semibold">
							{m.video_editor_media_recovery_sources()}
						</h3>
						<ul class="mt-2 space-y-1.5">
							{#each mediaRecovery.sourceIssues as issue (issue.mediaId)}
								<li
									class="flex flex-col gap-2 rounded-md border border-[oklch(0.28_0.014_55)] bg-[oklch(0.19_0.01_50)] p-2.5 sm:flex-row sm:items-center"
								>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-medium">{issue.fileName}</p>
										<p class="text-[10px] text-amber-300">{issueText(issue)}</p>
									</div>
									<div class="flex flex-wrap gap-1.5">
										{#if issue.kind === 'permission'}
											<Button
												size="sm"
												disabled={busyId !== null}
												onclick={() => void grantAccess(issue)}
											>
												{#if busyId === issue.mediaId}<LoaderIcon
														class="size-3.5 animate-spin motion-reduce:animate-none"
														aria-hidden="true"
													/>{/if}
												{m.video_editor_media_recovery_grant()}
											</Button>
										{/if}
										<Button
											variant="outline"
											size="sm"
											disabled={busyId !== null}
											onclick={() => void locateFile(issue)}
										>
											<FolderOpenIcon class="size-3.5" aria-hidden="true" />
											{m.video_editor_media_recovery_locate()}
										</Button>
									</div>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if mediaRecovery.orphanedClips.length > 0}
					<section aria-labelledby="media-recovery-orphans">
						<div class="flex flex-wrap items-start justify-between gap-2">
							<div>
								<h3 id="media-recovery-orphans" class="text-xs font-semibold">
									{m.video_editor_media_recovery_orphans()}
								</h3>
								<p class="mt-0.5 text-[10px] text-[var(--video-editor-muted)]">
									{m.video_editor_media_recovery_orphans_description()}
								</p>
							</div>
							{#if automaticMatches.size > 0}
								<Button
									variant="outline"
									size="sm"
									disabled={busyId !== null}
									onclick={() => void autoMatch()}
								>
									{#if busyId === 'auto-match'}<LoaderIcon
											class="size-3.5 animate-spin motion-reduce:animate-none"
											aria-hidden="true"
										/>{:else}<WandIcon class="size-3.5" aria-hidden="true" />{/if}
									{m.video_editor_media_recovery_auto_match()}
								</Button>
							{/if}
						</div>
						<ul class="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
							{#each mediaRecovery.orphanedClips as orphan (orphan.itemId)}
								<li
									class="flex flex-col gap-2 rounded-md border border-[oklch(0.28_0.014_55)] bg-[oklch(0.19_0.01_50)] p-2.5 sm:flex-row sm:items-center"
								>
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-medium">{orphan.label}</p>
										<p class="text-[10px] text-[var(--video-editor-muted)]">{orphan.itemType}</p>
									</div>
									<div class="flex flex-wrap gap-1.5">
										<Button
											variant="outline"
											size="sm"
											disabled={busyId !== null}
											onclick={() => (replacementFor = orphan)}
										>
											<SearchIcon class="size-3.5" aria-hidden="true" />
											{m.video_editor_media_recovery_choose()}
										</Button>
										<Button
											variant="ghost"
											size="sm"
											disabled={busyId !== null}
											onclick={() => void removeOrphans([orphan.itemId])}
										>
											<TrashIcon class="size-3.5" aria-hidden="true" />
											{m.video_editor_media_recovery_remove()}
										</Button>
									</div>
								</li>
							{/each}
						</ul>
						<Button
							class="mt-2"
							variant="ghost"
							size="sm"
							disabled={busyId !== null}
							onclick={() =>
								void removeOrphans(mediaRecovery.orphanedClips.map((orphan) => orphan.itemId))}
						>
							<TrashIcon class="size-3.5" aria-hidden="true" />
							{m.video_editor_media_recovery_remove_all()}
						</Button>
					</section>
				{/if}
			</div>
		{/if}

		<Dialog.Footer class="mt-5">
			<Button
				type="button"
				variant="ghost"
				disabled={busyId !== null}
				onclick={() => mediaRecovery.workOffline()}
			>
				{m.video_editor_media_recovery_work_offline()}
			</Button>
			<Button type="button" variant="outline" disabled={busyId !== null} onclick={close}>
				{m.common_close()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
