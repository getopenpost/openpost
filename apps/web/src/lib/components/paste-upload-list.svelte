<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { ComposerSessionMediaQueue, type PasteMediaUploadItem } from '$lib/composer/media-queue';
	import type { MediaUploadResult } from '$lib/media-upload-client';

	interface Props {
		uploads: PasteMediaUploadItem[];
		mediaCount: number;
		baseCount: number;
		queue: ComposerSessionMediaQueue<MediaUploadResult>;
	}

	let { uploads, mediaCount, baseCount, queue }: Props = $props();
</script>

{#each uploads as upload, uploadIndex (upload.id)}
	{@const mediaIndex = baseCount + uploadIndex}
	<div
		class="relative overflow-hidden rounded-lg {mediaCount === 3 && mediaIndex === 0
			? 'col-span-2'
			: ''}"
		data-testid="composer-paste-upload"
		data-status={upload.status}
		role="group"
		aria-label={upload.file.name}
		aria-busy={upload.status === 'queued' || upload.status === 'uploading'}
	>
		<img
			src={upload.previewURL}
			alt=""
			class="{mediaCount === 1 ? 'aspect-video' : 'aspect-square'} w-full object-cover"
		/>
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 p-3 text-center text-white"
		>
			<p class="max-w-full truncate text-xs font-semibold" title={upload.file.name}>
				{upload.file.name}
			</p>
			{#if upload.status === 'uploading'}
				<ProtectedIcon icon="loading" class="size-5 animate-spin" />
				<p class="text-xs font-medium">
					{upload.file.name}: {m.media_upload_action()}
					{#if upload.progress !== null}
						{Math.round(upload.progress * 100)}%
					{/if}
				</p>
				{#if upload.progress !== null}
					<div
						class="h-1.5 w-full max-w-36 overflow-hidden rounded-full bg-white/25"
						role="progressbar"
						aria-label={`${m.media_upload_action()}: ${upload.file.name}`}
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={Math.round(upload.progress * 100)}
					>
						<div
							class="h-full rounded-full bg-white transition-[width]"
							style:width={`${Math.round(upload.progress * 100)}%`}
						></div>
					</div>
				{/if}
				<button
					type="button"
					class="rounded-md bg-black/65 px-3 py-1.5 text-xs font-medium hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
					onclick={() => queue.cancel(upload.id)}
					aria-label={`${m.common_cancel()}: ${upload.file.name}`}
				>
					{m.common_cancel()}
				</button>
			{:else if upload.status === 'queued'}
				<ProtectedIcon icon="loading" class="size-5 animate-spin" />
				<p class="text-xs font-medium">
					{upload.file.name}: {m.media_upload_ready()}
				</p>
				<button
					type="button"
					class="rounded-md bg-black/65 px-3 py-1.5 text-xs font-medium hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
					onclick={() => queue.remove(upload.id)}
					aria-label={`${m.common_cancel()}: ${upload.file.name}`}
				>
					{m.common_cancel()}
				</button>
			{:else}
				<p
					class="line-clamp-3 text-xs font-medium"
					role={upload.status === 'failed' ? 'alert' : 'status'}
				>
					{upload.file.name}: {upload.status === 'failed'
						? upload.error || m.compose_upload_failed()
						: m.media_upload_ready()}
				</p>
				<div class="flex flex-wrap justify-center gap-2">
					<button
						type="button"
						class="flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:outline-none"
						onclick={() => queue.retry(upload.id)}
						aria-label={`${m.common_retry()}: ${upload.file.name}`}
					>
						<ThemeIcon role="refresh" class="size-3.5" />
						{m.common_retry()}
					</button>
					<button
						type="button"
						class="rounded-md bg-black/65 px-3 py-1.5 text-xs font-medium hover:bg-black/85 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
						onclick={() => queue.remove(upload.id)}
						aria-label={m.media_upload_remove({ name: upload.file.name })}
					>
						{m.compose_remove_media()}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/each}
