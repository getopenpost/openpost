<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import CameraCapture from '$lib/components/camera-capture.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import { getToken } from '$lib/api/client';
	import { formatBytes } from '$lib/video/constraints';
	import CameraIcon from 'lucide-svelte/icons/camera';
	import ImageIcon from 'lucide-svelte/icons/image';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import UploadIcon from 'lucide-svelte/icons/upload';
	import { m } from '$lib/paraglide/messages';

	let {
		open = $bindable(false),
		onComplete,
		onError
	}: {
		open: boolean;
		onComplete?: (avatarURL: string) => void;
		onError?: (message: string) => void;
	} = $props();

	let mode = $state<'device' | 'camera'>('device');
	let fileInput = $state<HTMLInputElement | null>(null);
	let file = $state.raw<File | null>(null);
	let previewURL = $state('');
	let zoom = $state(1);
	let horizontal = $state(0);
	let vertical = $state(0);
	let uploading = $state(false);
	let progress = $state(0);
	let error = $state('');
	let controller: AbortController | null = null;

	function handleOpenChange(nextOpen: boolean): void {
		if (nextOpen) {
			mode = 'device';
			clearFile();
			error = '';
			progress = 0;
		} else {
			controller?.abort();
			clearFile();
		}
	}

	function chooseFile(): void {
		const selected = fileInput?.files?.[0];
		if (selected) setFile(selected);
		if (fileInput) fileInput.value = '';
	}

	function setFile(candidate: File): void {
		error = validate(candidate);
		if (error) {
			onError?.(error);
			return;
		}
		clearFile();
		file = candidate;
		previewURL = URL.createObjectURL(candidate);
		zoom = 1;
		horizontal = 0;
		vertical = 0;
		mode = 'device';
	}

	function validate(candidate: File): string {
		if (candidate.size <= 0) return m.avatar_upload_empty();
		if (candidate.size > 4 * 1024 * 1024) return m.avatar_upload_too_large();
		if (!candidate.type.startsWith('image/')) return m.avatar_upload_type();
		return '';
	}

	function clearFile(): void {
		if (previewURL) URL.revokeObjectURL(previewURL);
		previewURL = '';
		file = null;
	}

	async function upload(): Promise<void> {
		if (!file || uploading) return;
		uploading = true;
		error = '';
		progress = 0;
		controller = new AbortController();
		try {
			const prepared = file.type === 'image/gif' ? file : await cropAvatar(file);
			const body = new FormData();
			body.append('file', prepared);
			const response = await uploadAvatar(body, controller.signal, (value) => (progress = value));
			if (!response.avatar_url) throw new Error(m.avatar_upload_missing_url());
			onComplete?.(response.avatar_url);
			open = false;
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			error = cause instanceof Error ? cause.message : m.avatar_upload_failed();
			onError?.(error);
		} finally {
			uploading = false;
			controller = null;
		}
	}

	async function cropAvatar(candidate: File): Promise<File> {
		const image = await loadImage(candidate);
		const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
		const travelX = Math.max(0, image.naturalWidth - sourceSize) / 2;
		const travelY = Math.max(0, image.naturalHeight - sourceSize) / 2;
		const sourceX = image.naturalWidth / 2 - sourceSize / 2 + (horizontal / 100) * travelX;
		const sourceY = image.naturalHeight / 2 - sourceSize / 2 + (vertical / 100) * travelY;
		const canvas = document.createElement('canvas');
		canvas.width = 1024;
		canvas.height = 1024;
		const context = canvas.getContext('2d');
		if (!context) throw new Error(m.avatar_upload_prepare_failed());
		context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 1024, 1024);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/webp', 0.92)
		);
		if (!blob) throw new Error(m.avatar_upload_prepare_failed());
		return new File([blob], 'profile-avatar.webp', {
			type: 'image/webp',
			lastModified: Date.now()
		});
	}

	function loadImage(candidate: File): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const url = URL.createObjectURL(candidate);
			const image = new Image();
			image.onload = () => {
				URL.revokeObjectURL(url);
				resolve(image);
			};
			image.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error(m.avatar_upload_prepare_failed()));
			};
			image.src = url;
		});
	}

	function uploadAvatar(
		body: FormData,
		signal: AbortSignal,
		onProgress: (value: number) => void
	): Promise<{ avatar_url?: string }> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('POST', `${getApiBase()}/auth/profile/avatar`);
			xhr.withCredentials = true;
			const token = getToken();
			if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
			const abort = () => xhr.abort();
			signal.addEventListener('abort', abort, { once: true });
			const cleanup = () => signal.removeEventListener('abort', abort);
			xhr.upload.onprogress = (event) => {
				if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
			};
			xhr.onload = () => {
				cleanup();
				if (xhr.status < 200 || xhr.status >= 300) {
					reject(avatarUploadResponseError(xhr));
					return;
				}
				try {
					onProgress(1);
					resolve(JSON.parse(xhr.responseText) as { avatar_url?: string });
				} catch {
					reject(new Error(m.avatar_upload_invalid_response()));
				}
			};
			xhr.onerror = () => {
				cleanup();
				reject(new Error(m.avatar_upload_network_error()));
			};
			xhr.onabort = () => {
				cleanup();
				reject(new DOMException('Aborted', 'AbortError'));
			};
			xhr.send(body);
		});
	}

	function avatarUploadResponseError(xhr: XMLHttpRequest): Error {
		const fallback = m.avatar_upload_http_error({ status: xhr.status || 0 });
		try {
			const response = JSON.parse(xhr.responseText) as {
				detail?: unknown;
				error?: unknown;
				title?: unknown;
			};
			for (const value of [response.detail, response.error, response.title]) {
				if (typeof value === 'string' && value.trim()) return new Error(value.trim());
			}
		} catch {
			// The translated fallback includes the status without exposing an HTML proxy response.
		}
		return new Error(fallback);
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[min(760px,calc(100dvh-2rem))] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
	>
		<Dialog.Header class="border-b px-5 py-4 pr-14">
			<Dialog.Title>{m.avatar_upload_title()}</Dialog.Title>
			<Dialog.Description>{m.avatar_upload_description()}</Dialog.Description>
		</Dialog.Header>

		<div class="flex gap-1 border-b px-4 py-2">
			<Button
				variant={mode === 'device' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 sm:min-h-9"
				onclick={() => (mode = 'device')}
			>
				<UploadIcon />
				{m.media_upload_device()}
			</Button>
			<Button
				variant={mode === 'camera' ? 'secondary' : 'ghost'}
				size="sm"
				class="min-h-11 sm:min-h-9"
				onclick={() => (mode = 'camera')}
			>
				<CameraIcon />
				{m.media_camera()}
			</Button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
			{#if mode === 'camera'}
				<CameraCapture onCapture={setFile} />
			{:else if file && previewURL}
				<div class="grid gap-5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-start">
					<div class="mx-auto size-60 overflow-hidden rounded-full bg-muted ring-1 ring-border">
						<img
							src={previewURL}
							alt={m.avatar_upload_preview()}
							class="size-full object-cover"
							style:transform={`scale(${zoom})`}
							style:transform-origin={`${50 + horizontal / 2}% ${50 + vertical / 2}%`}
						/>
					</div>
					<div class="space-y-4">
						<div>
							<p class="truncate text-sm font-medium">{file.name}</p>
							<p class="mt-1 font-mono text-xs text-muted-foreground">{formatBytes(file.size)}</p>
						</div>
						{#if file.type !== 'image/gif'}
							<label class="grid gap-2 text-sm">
								<span>{m.avatar_upload_zoom()}</span>
								<Slider
									bind:value={zoom}
									min={1}
									max={3}
									step={0.05}
									ariaLabel={m.avatar_upload_zoom()}
								/>
							</label>
							<label class="grid gap-2 text-sm">
								<span>{m.avatar_upload_horizontal()}</span>
								<Slider
									bind:value={horizontal}
									min={-100}
									max={100}
									step={1}
									ariaLabel={m.avatar_upload_horizontal()}
								/>
							</label>
							<label class="grid gap-2 text-sm">
								<span>{m.avatar_upload_vertical()}</span>
								<Slider
									bind:value={vertical}
									min={-100}
									max={100}
									step={1}
									ariaLabel={m.avatar_upload_vertical()}
								/>
							</label>
						{:else}
							<p class="text-xs text-muted-foreground">{m.avatar_upload_gif_preserved()}</p>
						{/if}
						<Button variant="outline" onclick={() => fileInput?.click()} disabled={uploading}>
							<ImageIcon />
							{m.avatar_upload_choose_another()}
						</Button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="flex min-h-52 w-full flex-col items-center justify-center rounded-xl border border-dashed bg-muted/15 px-5 text-center hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
					onclick={() => fileInput?.click()}
				>
					<span
						class="mb-3 flex size-11 items-center justify-center rounded-lg bg-background ring-1 ring-border"
						><ImageIcon class="size-5 text-primary" /></span
					>
					<span class="font-medium">{m.avatar_upload_choose()}</span>
					<span class="mt-1 text-sm text-muted-foreground">{m.avatar_upload_limits()}</span>
				</button>
			{/if}
			<Input
				bind:ref={fileInput}
				type="file"
				accept="image/png,image/jpeg,image/gif,image/webp"
				class="sr-only"
				onchange={chooseFile}
			/>

			{#if error}
				<div class="mt-4"><InlineNotice tone="error" message={error} /></div>
			{/if}
			{#if uploading}
				<div class="mt-4" aria-live="polite">
					<div class="flex items-center justify-between gap-3 text-sm">
						<span>{m.avatar_upload_progress({ percent: Math.round(progress * 100) })}</span>
						<Button variant="ghost" size="sm" onclick={() => controller?.abort()}
							>{m.video_upload_cancel()}</Button
						>
					</div>
					<div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-primary transition-[width]"
							style:width={`${Math.round(progress * 100)}%`}
						></div>
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="border-t px-4 py-3 sm:px-5">
			<Button variant="ghost" onclick={() => (open = false)} disabled={uploading}
				>{m.common_cancel()}</Button
			>
			<Button onclick={upload} disabled={!file || uploading}>
				{#if uploading}<LoaderIcon class="animate-spin" />{:else}<UploadIcon />{/if}
				{m.avatar_upload_action()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
