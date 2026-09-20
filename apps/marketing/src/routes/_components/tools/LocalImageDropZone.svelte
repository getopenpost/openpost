<script lang="ts">
	import { ImageUp } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input';
	import {
		firstClipboardImage,
		LOCAL_IMAGE_MAX_BYTES,
		LocalImageError,
		localImageMessage,
		validateLocalImage
	} from './local-image';

	let {
		onfile,
		disabled = false,
		label = 'Drop an image here, paste it, or choose a file',
		maxBytes = LOCAL_IMAGE_MAX_BYTES,
		hint = 'PNG, JPEG, or WebP, up to 50 MB',
		acceptTypes = 'image/png,image/jpeg,image/webp',
		helpText,
		onerror
	}: {
		onfile: (file: File) => void | Promise<void>;
		disabled?: boolean;
		label?: string;
		maxBytes?: number;
		hint?: string;
		acceptTypes?: string;
		helpText?: string;
		onerror?: (message: string) => void;
	} = $props();

	let input = $state<HTMLInputElement | null>(null);
	let dragging = $state(false);

	async function accept(file: File | null): Promise<void> {
		if (!file || disabled) return;
		try {
			validateLocalImage(file, maxBytes);
			await onfile(file);
		} catch (error) {
			onerror?.(
				error instanceof LocalImageError && error.code === 'too_large'
					? `Choose an image smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`
					: localImageMessage(error)
			);
		}
	}
</script>

<svelte:window
	onpaste={(event) => {
		if (
			event.defaultPrevented ||
			disabled ||
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target instanceof HTMLElement && event.target.isContentEditable)
		)
			return;
		const file = firstClipboardImage(event);
		if (!file) return;
		event.preventDefault();
		void accept(file);
	}}
/>

<button
	type="button"
	class:dragging
	class="drop-zone focus-ring"
	{disabled}
	onclick={() => input?.click()}
	ondragenter={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragover={(event) => event.preventDefault()}
	ondragleave={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dragging = false;
	}}
	ondrop={(event) => {
		event.preventDefault();
		dragging = false;
		void accept(event.dataTransfer?.files[0] ?? null);
	}}
>
	<ImageUp size={28} aria-hidden="true" />
	<span>{label}</span>
	<small>{helpText ?? hint}</small>
</button>
<Input
	bind:ref={input}
	class="hidden"
	type="file"
	tabindex={-1}
	aria-label="Choose an image"
	accept={acceptTypes}
	{disabled}
	onchange={(event) => {
		void accept(event.currentTarget.files?.[0] ?? null);
		event.currentTarget.value = '';
	}}
/>

<style>
	.drop-zone {
		display: grid;
		min-height: 180px;
		width: 100%;
		place-items: center;
		align-content: center;
		gap: 10px;
		border: 1px dashed var(--border);
		border-radius: 14px;
		background: var(--card);
		color: var(--foreground);
		padding: 24px;
		text-align: center;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}
	.drop-zone:hover,
	.drop-zone.dragging {
		border-color: var(--primary);
		background: var(--accent);
	}
	.drop-zone:disabled {
		cursor: wait;
		opacity: 0.65;
	}
	span {
		font-size: 14px;
		font-weight: 550;
	}
	small {
		color: var(--muted-foreground);
		font-size: 11px;
	}
	@media (prefers-reduced-motion: reduce) {
		.drop-zone {
			transition: none;
		}
	}
</style>
