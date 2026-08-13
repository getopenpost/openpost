<script lang="ts">
	import type { VariantID, VideoProjectDocumentV1 } from '@openpost/video-project';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import AppSelect from '$lib/components/app-select.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { formatBytes } from '$lib/video-editor/project';
	import CheckIcon from '@lucide/svelte/icons/check';
	import DownloadIcon from '@lucide/svelte/icons/download';

	let {
		open = $bindable(),
		project,
		exportVariantIDs,
		requiredVariantIDs,
		returnToken,
		exportBusy,
		exportPickerOpen,
		returningToComposer,
		exportError,
		exportFormat,
		exportCapabilityState,
		exportCapabilityError,
		exportProgress,
		exportFile,
		exportURL,
		exportedFiles,
		onSetVariant,
		onSetFormat,
		onSaveFile,
		onCancel,
		onReturnToComposer,
		onStart
	}: {
		open: boolean;
		project: VideoProjectDocumentV1;
		exportVariantIDs: VariantID[];
		requiredVariantIDs: VariantID[];
		returnToken: string;
		exportBusy: boolean;
		exportPickerOpen: boolean;
		returningToComposer: boolean;
		exportError: string;
		exportFormat: 'mp4' | 'webm';
		exportCapabilityState: 'idle' | 'checking' | 'ready' | 'unsupported';
		exportCapabilityError: string;
		exportProgress: number;
		exportFile: File | null;
		exportURL: string;
		exportedFiles: Partial<Record<VariantID, File>>;
		onSetVariant: (target: VariantID, checked: boolean) => void;
		onSetFormat: (value: string) => void;
		onSaveFile: (file: File) => Promise<void>;
		onCancel: () => void;
		onReturnToComposer: () => Promise<void>;
		onStart: () => Promise<unknown>;
	} = $props();

	const variantOptions = [
		{ value: 'portrait', label: m.video_editor_variant_portrait() },
		{ value: 'feed-portrait', label: m.video_editor_variant_feed() },
		{ value: 'square', label: m.video_editor_variant_square() },
		{ value: 'landscape', label: m.video_editor_variant_landscape() }
	] satisfies Array<{ value: VariantID; label: string }>;
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.video_editor_export_title()}</Dialog.Title>
			<Dialog.Description>{m.video_editor_export_description()}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-2">
			{#if project.primary_sequence.length === 0}
				<InlineNotice tone="warning" message={m.video_editor_export_no_video()} />
			{/if}
			{#if exportError}
				<InlineNotice tone="error" message={exportError} />
			{/if}
			<fieldset class="grid gap-2">
				<legend class="mb-1 text-sm font-medium">{m.video_editor_export_formats()}</legend>
				{#each variantOptions as option (option.value)}
					{@const variant = project.variants.find((item) => item.id === option.value)}
					<label
						class="flex min-h-11 items-center gap-3 rounded-md border bg-muted/20 px-3 text-sm"
					>
						<Checkbox
							checked={exportVariantIDs.includes(option.value)}
							disabled={Boolean(returnToken) || exportBusy || exportPickerOpen}
							onCheckedChange={(checked) => onSetVariant(option.value, checked)}
						/>
						<span class="min-w-0 flex-1">
							<span class="block font-medium">{option.label}</span>
							<span class="block text-xs text-muted-foreground">
								{variant?.width}×{variant?.height} · {project.timebase.fps_numerator} fps
							</span>
						</span>
						{#if returnToken && requiredVariantIDs.includes(option.value)}
							<span class="text-xs text-muted-foreground">{m.video_editor_export_required()}</span>
						{/if}
					</label>
				{/each}
			</fieldset>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{m.video_editor_export_format()}</span>
				<AppSelect
					value={returnToken ? 'mp4' : exportFormat}
					onValueChange={onSetFormat}
					disabled={exportBusy || exportPickerOpen || Boolean(returnToken)}
					options={[
						{ value: 'mp4', label: m.video_editor_export_mp4() },
						{ value: 'webm', label: m.video_editor_export_webm() }
					]}
				/>
			</label>
			{#if exportCapabilityState === 'checking'}
				<InlineNotice tone="info" message={m.video_editor_export_checking()} />
			{:else if exportCapabilityState === 'ready'}
				<InlineNotice tone="success" message={m.video_editor_export_supported()} />
			{:else if exportCapabilityState === 'unsupported'}
				<InlineNotice tone="error" message={exportCapabilityError} />
			{/if}
			{#if exportPickerOpen}
				<InlineNotice tone="info" message={m.video_editor_export_picker()} />
			{:else if exportBusy || returningToComposer}
				<div class="space-y-2" aria-live="polite">
					<div class="h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full bg-primary transition-[width]"
							style:width={`${Math.round(exportProgress * 100)}%`}
						></div>
					</div>
					<p class="text-xs text-muted-foreground">
						{m.video_editor_export_progress({ progress: Math.round(exportProgress * 100) })}
					</p>
				</div>
			{:else if exportFile && exportURL}
				<InlineNotice
					tone="success"
					message={`${m.video_editor_export_ready()} · ${formatBytes(exportFile.size)}`}
				/>
				{#if !returnToken && Object.keys(exportedFiles).length > 1}
					<div class="grid gap-2">
						{#each variantOptions as option (option.value)}
							{@const completedFile = exportedFiles[option.value]}
							{#if completedFile}
								<div class="flex min-h-11 items-center gap-3 rounded-md border px-3">
									<span class="min-w-0 flex-1">
										<span class="block text-sm font-medium">{option.label}</span>
										<span class="block text-xs text-muted-foreground">
											{formatBytes(completedFile.size)}
										</span>
									</span>
									<Button
										variant="outline"
										size="sm"
										onclick={() => void onSaveFile(completedFile)}
									>
										<DownloadIcon class="size-4" />
										{m.video_editor_export_download()}
									</Button>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{/if}
		</div>
		<Dialog.Footer>
			{#if exportBusy || returningToComposer}
				<Button variant="outline" onclick={onCancel}>
					{m.video_editor_export_cancel()}
				</Button>
			{:else}
				<Button variant="outline" onclick={() => (open = false)}>
					{m.video_editor_close()}
				</Button>
				{#if returnToken && Object.keys(exportedFiles).length > 0}
					<Button onclick={() => void onReturnToComposer()}>
						<CheckIcon class="size-4" />
						{m.video_editor_use_in_post()}
					</Button>
				{:else if exportFile && exportURL && Object.keys(exportedFiles).length === 1}
					<Button onclick={() => void onSaveFile(exportFile)}>
						<DownloadIcon class="size-4" />
						{m.video_editor_export_download()}
					</Button>
				{:else}
					<Button
						disabled={exportPickerOpen ||
							project.primary_sequence.length === 0 ||
							exportVariantIDs.length === 0 ||
							exportCapabilityState !== 'ready'}
						onclick={() => void onStart()}
					>
						<DownloadIcon class="size-4" />
						{returnToken ? m.video_editor_export_for_post() : m.video_editor_export_start()}
					</Button>
				{/if}
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
