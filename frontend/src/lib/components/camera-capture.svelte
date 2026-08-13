<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import AppSelect from '$lib/components/app-select.svelte';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SwitchCameraIcon from '@lucide/svelte/icons/switch-camera';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';

	let {
		onCapture,
		onCancel,
		jpegQuality = 0.92
	}: {
		onCapture: (file: File) => void | Promise<void>;
		onCancel?: () => void;
		jpegQuality?: number;
	} = $props();

	let video = $state<HTMLVideoElement>();
	let stream = $state<MediaStream | null>(null);
	let devices = $state<MediaDeviceInfo[]>([]);
	let selectedDeviceID = $state('');
	let facingMode = $state<'user' | 'environment'>('environment');
	let loading = $state(true);
	let error = $state('');
	let capturedURL = $state('');
	let capturedBlob = $state<Blob | null>(null);
	let countdown = $state<0 | 3 | 10>(0);
	let countdownRemaining = $state(0);
	let usingPhoto = $state(false);
	let cameraRequestToken = 0;

	function attachVideo(node: HTMLVideoElement) {
		video = node;
		return () => {
			if (video === node) video = undefined;
		};
	}

	onMount(() => {
		void startCamera();
		return stopCamera;
	});

	async function startCamera(): Promise<void> {
		stopCamera();
		const requestToken = ++cameraRequestToken;
		capturedBlob = null;
		revokeCapturedURL();
		error = '';
		loading = true;
		if (!window.isSecureContext) {
			error = m.camera_secure_required();
			loading = false;
			return;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			error = m.camera_unavailable();
			loading = false;
			return;
		}
		try {
			const videoElement = video;
			if (!videoElement) throw new Error(m.camera_preview_not_ready());
			const mediaRequest = navigator.mediaDevices.getUserMedia({
				video: selectedDeviceID
					? { deviceId: { exact: selectedDeviceID } }
					: { facingMode: { ideal: facingMode } },
				audio: false
			});
			void mediaRequest.then(
				(lateStream) => {
					if (requestToken !== cameraRequestToken) {
						lateStream.getTracks().forEach((track) => track.stop());
					}
				},
				() => undefined
			);
			stream = await Promise.race([
				mediaRequest,
				new Promise<never>((_, reject) => {
					setTimeout(
						() => reject(new DOMException('Camera permission timed out.', 'TimeoutError')),
						12_000
					);
				})
			]);
			if (requestToken !== cameraRequestToken) {
				stream.getTracks().forEach((track) => track.stop());
				stream = null;
				return;
			}
			videoElement.srcObject = stream;
			await videoElement.play();
			devices = (await navigator.mediaDevices.enumerateDevices()).filter(
				(device) => device.kind === 'videoinput'
			);
			const activeDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
			if (activeDevice) selectedDeviceID = activeDevice;
		} catch (cause) {
			if (requestToken === cameraRequestToken && cause instanceof DOMException) {
				if (cause.name === 'TimeoutError') cameraRequestToken++;
			}
			error = cameraErrorMessage(cause);
		} finally {
			if (requestToken === cameraRequestToken || error) loading = false;
		}
	}

	function stopCamera(): void {
		cameraRequestToken++;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		if (video) video.srcObject = null;
	}

	async function capture(): Promise<void> {
		if (!video || !stream) return;
		if (countdown > 0) {
			countdownRemaining = countdown;
			while (countdownRemaining > 0) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				countdownRemaining--;
			}
		}
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!width || !height) {
			error = m.camera_not_ready();
			return;
		}
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');
		if (!context) {
			error = m.camera_capture_failed();
			return;
		}
		context.drawImage(video, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', jpegQuality)
		);
		if (!blob) {
			error = m.camera_capture_failed();
			return;
		}
		capturedBlob = blob;
		revokeCapturedURL();
		capturedURL = URL.createObjectURL(blob);
		stopCamera();
	}

	async function usePhoto(): Promise<void> {
		if (!capturedBlob || usingPhoto) return;
		usingPhoto = true;
		try {
			await onCapture(
				new File([capturedBlob], `camera-${new Date().toISOString().replaceAll(':', '-')}.jpg`, {
					type: 'image/jpeg'
				})
			);
		} finally {
			usingPhoto = false;
		}
	}

	function retake(): void {
		void startCamera();
	}

	function switchFacingMode(): void {
		facingMode = facingMode === 'environment' ? 'user' : 'environment';
		selectedDeviceID = '';
		void startCamera();
	}

	function revokeCapturedURL(): void {
		if (capturedURL) URL.revokeObjectURL(capturedURL);
		capturedURL = '';
	}

	function cameraErrorMessage(cause: unknown): string {
		if (!(cause instanceof DOMException)) return m.camera_open_failed();
		switch (cause.name) {
			case 'NotAllowedError':
				return m.camera_permission_denied();
			case 'NotFoundError':
				return m.camera_not_found();
			case 'NotReadableError':
				return m.camera_busy();
			case 'TimeoutError':
				return m.camera_permission_waiting();
			default:
				return m.camera_open_failed();
		}
	}
</script>

<div class="space-y-3">
	<div
		class="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-neutral-950 text-white"
		aria-live="polite"
	>
		{#if capturedURL}
			<img
				src={capturedURL}
				alt={m.camera_captured_preview()}
				class="h-full w-full object-contain"
			/>
		{:else}
			<video
				{@attach attachVideo}
				playsinline
				muted
				class="h-full w-full object-contain"
				aria-label={m.camera_live_preview()}
			></video>
		{/if}
		{#if loading}
			<div class="absolute inset-0 flex items-center justify-center bg-neutral-950/80">
				<LoaderIcon class="size-6 animate-spin" />
				<span class="sr-only">{m.camera_opening()}</span>
			</div>
		{/if}
		{#if countdownRemaining > 0}
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/45 text-7xl font-semibold"
			>
				{countdownRemaining}
			</div>
		{/if}
	</div>

	{#if error}
		<div
			class="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
		>
			<p>{error}</p>
			<Button variant="outline" size="sm" class="mt-2" onclick={() => startCamera()}>
				<RefreshCwIcon />
				{m.common_retry()}
			</Button>
		</div>
	{/if}

	{#if !capturedURL}
		<div class="grid grid-cols-[1fr_auto] gap-2">
			<label class="grid gap-1 text-xs text-muted-foreground">
				<span>{m.image_editor_camera()}</span>
				<AppSelect
					bind:value={selectedDeviceID}
					onValueChange={() => void startCamera()}
					disabled={devices.length < 2}
					options={devices.map((device, index) => ({
						value: device.deviceId,
						label: device.label || m.camera_number({ number: index + 1 })
					}))}
					class="h-11 w-full"
				/>
			</label>
			<Button
				variant="outline"
				size="icon"
				class="self-end"
				onclick={switchFacingMode}
				aria-label={m.camera_switch()}
				disabled={loading}
			>
				<SwitchCameraIcon />
			</Button>
		</div>
		<label class="grid gap-1 text-xs text-muted-foreground">
			<span>{m.camera_countdown()}</span>
			<AppSelect
				value={String(countdown)}
				onValueChange={(value) => (countdown = Number(value) as 0 | 3 | 10)}
				options={[
					{ value: '0', label: m.camera_off() },
					{ value: '3', label: m.camera_seconds({ count: 3 }) },
					{ value: '10', label: m.camera_seconds({ count: 10 }) }
				]}
				class="h-11 w-full"
			/>
		</label>
	{/if}

	<div class="flex flex-wrap justify-end gap-2">
		{#if onCancel}
			<Button variant="ghost" onclick={onCancel}>{m.common_cancel()}</Button>
		{/if}
		{#if capturedURL}
			<Button variant="outline" onclick={retake}>{m.camera_retake()}</Button>
			<Button onclick={usePhoto} disabled={usingPhoto}>
				{#if usingPhoto}<LoaderIcon class="animate-spin" />{/if}
				{m.camera_use_photo()}
			</Button>
		{:else}
			<Button onclick={capture} disabled={loading || !stream || countdownRemaining > 0}>
				<CameraIcon />
				{m.camera_take_photo()}
			</Button>
		{/if}
	</div>
</div>
