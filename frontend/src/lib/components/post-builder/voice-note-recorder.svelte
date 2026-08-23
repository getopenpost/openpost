<script lang="ts">
	import { onDestroy } from 'svelte';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import MicIcon from '@lucide/svelte/icons/mic';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		disabled?: boolean;
		onSave: (file: File) => void | Promise<void>;
	}

	const maximumSeconds = 300;
	let { open = $bindable(false), disabled = false, onSave }: Props = $props();
	let recording = $state(false);
	let uploading = $state(false);
	let elapsedSeconds = $state(0);
	let error = $state('');
	let recorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let timer: ReturnType<typeof setInterval> | null = null;
	let saveAfterStop = false;

	const elapsedLabel = $derived(
		`${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
	);

	function preferredMimeType(): string {
		for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
			if (MediaRecorder.isTypeSupported(candidate)) return candidate;
		}
		return '';
	}

	async function start(): Promise<void> {
		if (recording || uploading || disabled) return;
		error = '';
		try {
			if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
				throw new Error(m.post_builder_record_unsupported());
			}
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			chunks = [];
			const mimeType = preferredMimeType();
			recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunks.push(event.data);
			};
			recorder.onerror = () => {
				error = m.post_builder_record_failed();
				cleanup();
			};
			recorder.onstop = finishRecording;
			recorder.start(500);
			recording = true;
			elapsedSeconds = 0;
			timer = setInterval(() => {
				elapsedSeconds += 1;
				if (elapsedSeconds >= maximumSeconds) stop(true);
			}, 1000);
		} catch (cause) {
			cleanup();
			error =
				cause instanceof Error && cause.message
					? cause.message
					: m.post_builder_record_permission();
		}
	}

	function stop(save: boolean): void {
		if (!recorder || recorder.state === 'inactive') return;
		saveAfterStop = save;
		recording = false;
		if (timer) clearInterval(timer);
		timer = null;
		recorder.stop();
	}

	async function finishRecording(): Promise<void> {
		const shouldSave = saveAfterStop;
		saveAfterStop = false;
		const mimeType = recorder?.mimeType || 'audio/webm';
		const captured = new Blob(chunks, { type: mimeType });
		cleanup(false);
		if (!shouldSave) return;
		if (captured.size === 0) {
			error = m.post_builder_record_empty();
			return;
		}
		uploading = true;
		try {
			const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			await onSave(new File([captured], `voice-note-${stamp}.${extension}`, { type: mimeType }));
			open = false;
		} catch (cause) {
			error =
				cause instanceof Error && cause.message ? cause.message : m.post_builder_record_failed();
		} finally {
			uploading = false;
		}
	}

	function cleanup(resetChunks = true): void {
		if (timer) clearInterval(timer);
		timer = null;
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = null;
		recorder = null;
		recording = false;
		if (resetChunks) chunks = [];
	}

	function handleOpenChange(next: boolean): void {
		if (next) {
			error = '';
			elapsedSeconds = 0;
			return;
		}
		if (recording) stop(false);
		else cleanup();
	}

	onDestroy(() => {
		if (recording) stop(false);
		cleanup();
	});
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<MicIcon class="size-4 text-primary" />
				{m.post_builder_record_title()}
			</Dialog.Title>
			<Dialog.Description>{m.post_builder_record_description()}</Dialog.Description>
		</Dialog.Header>

		<div
			class="flex min-h-40 flex-col items-center justify-center rounded-lg border bg-muted/20 p-5 text-center"
		>
			<span class="font-mono text-3xl font-medium tracking-tight tabular-nums" aria-live="polite">
				{elapsedLabel}
			</span>
			<p class="mt-2 text-xs text-muted-foreground">
				{recording ? m.post_builder_record_recording() : m.post_builder_record_limit()}
			</p>
			{#if recording}
				<Button type="button" variant="destructive" class="mt-5" onclick={() => stop(true)}>
					<SquareIcon class="size-3.5 fill-current" />
					{m.post_builder_record_stop()}
				</Button>
			{:else}
				<Button type="button" class="mt-5" disabled={uploading || disabled} onclick={start}>
					{#if uploading}
						<LoaderIcon class="size-4 animate-spin motion-reduce:animate-none" />
						{m.post_builder_record_uploading()}
					{:else}
						<MicIcon class="size-4" />
						{m.post_builder_record_start()}
					{/if}
				</Button>
			{/if}
		</div>

		{#if error}<InlineNotice tone="error" message={error} />{/if}

		<Dialog.Footer>
			<Button
				type="button"
				variant="outline"
				disabled={uploading}
				onclick={() => {
					if (recording) stop(false);
					open = false;
				}}
			>
				{m.common_cancel()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
