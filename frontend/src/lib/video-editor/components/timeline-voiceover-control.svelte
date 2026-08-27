<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Popover from '$lib/components/ui/popover';
	import AppSelect from '$lib/components/app-select.svelte';
	import { voiceoverRecorder } from '$lib/video-editor/recorder/voiceover-recorder.svelte';
	import { toast } from 'svelte-sonner';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import HeadphonesIcon from '@lucide/svelte/icons/headphones';
	import LoaderIcon from '@lucide/svelte/icons/loader-circle';
	import MicIcon from '@lucide/svelte/icons/mic';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SquareIcon from '@lucide/svelte/icons/square';
	import XIcon from '@lucide/svelte/icons/x';

	let {
		projectId,
		oninserted = () => {}
	}: { projectId: string; oninserted?: (itemId: string) => void } = $props();

	let settingsOpen = $state(false);
	const deviceOptions = $derived([
		{ value: '', label: m.video_editor_voiceover_default_mic() },
		...voiceoverRecorder.devices.map((device, index) => ({
			value: device.deviceId,
			label: device.label || m.video_editor_voiceover_mic_number({ number: index + 1 })
		}))
	]);
	const elapsed = $derived.by(() => {
		const seconds = Math.floor(voiceoverRecorder.elapsedMs / 1_000);
		return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	});
	const meterWidth = $derived(
		Math.min(100, Math.round(Math.pow(voiceoverRecorder.level, 0.6) * 130))
	);

	function errorMessage(code: NonNullable<typeof voiceoverRecorder.error>): string {
		return {
			unsupported: m.video_editor_voiceover_error_unsupported(),
			'permission-denied': m.video_editor_voiceover_error_permission(),
			'no-device': m.video_editor_voiceover_error_no_device(),
			'device-busy': m.video_editor_voiceover_error_busy(),
			'start-failed': m.video_editor_voiceover_error_start(),
			'empty-recording': m.video_editor_voiceover_error_empty(),
			'save-failed': m.video_editor_voiceover_error_save()
		}[code];
	}

	$effect(() => {
		const error = voiceoverRecorder.error;
		if (!error) return;
		toast.error(errorMessage(error));
		voiceoverRecorder.clearError();
	});

	$effect(() => {
		if (settingsOpen) {
			void voiceoverRecorder.refreshDevices();
			void voiceoverRecorder.startMonitor();
		} else {
			voiceoverRecorder.stopMonitor();
		}
	});

	onMount(() => {
		const handleDeviceChange = () => void voiceoverRecorder.refreshDevices();
		navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
		void voiceoverRecorder.refreshDevices();
		const unsubscribeInserted = voiceoverRecorder.onInserted(oninserted);
		return () => {
			navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
			unsubscribeInserted();
		};
	});

	onDestroy(() => {
		voiceoverRecorder.stopMonitor();
		if (voiceoverRecorder.sessionOpen) voiceoverRecorder.cancel();
	});

	function start(): void {
		settingsOpen = false;
		void voiceoverRecorder.start(projectId, m.video_editor_voiceover_track());
	}
</script>

{#if voiceoverRecorder.supported}
	{#if voiceoverRecorder.status === 'idle' || voiceoverRecorder.status === 'requesting'}
		<div class="flex shrink-0 items-center gap-0.5" data-voiceover-control>
			<Button
				size="icon-xs"
				variant="ghost"
				disabled={voiceoverRecorder.status === 'requesting'}
				aria-label={m.video_editor_voiceover_record()}
				title={m.video_editor_voiceover_record_hint()}
				onclick={start}
			>
				{#if voiceoverRecorder.status === 'requesting'}
					<LoaderIcon class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
				{:else}
					<MicIcon class="size-3.5 text-red-400" aria-hidden="true" />
				{/if}
			</Button>
			<Popover.Root bind:open={settingsOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							size="icon-xs"
							variant="ghost"
							disabled={voiceoverRecorder.status === 'requesting'}
							aria-label={m.video_editor_voiceover_settings()}
						>
							<ChevronDownIcon class="size-3" aria-hidden="true" />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content side="top" align="start" class="video-editor-theme w-72 space-y-3 p-3">
					<div>
						<p class="text-xs font-semibold">{m.video_editor_voiceover_settings()}</p>
						<p class="mt-0.5 text-[10px] leading-4 text-muted-foreground">
							{m.video_editor_voiceover_settings_hint()}
						</p>
					</div>
					<label class="block space-y-1 text-xs">
						<span>{m.video_editor_voiceover_microphone()}</span>
						<AppSelect
							value={voiceoverRecorder.selectedDeviceId ?? ''}
							options={deviceOptions}
							ariaLabel={m.video_editor_voiceover_microphone()}
							onValueChange={(value) => voiceoverRecorder.setSelectedDeviceId(value || null)}
						/>
					</label>
					<div
						class="h-1.5 overflow-hidden rounded-full bg-[oklch(0.24_0.01_55)]"
						role="meter"
						aria-label={m.video_editor_voiceover_input_level()}
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={meterWidth}
					>
						<div
							class="h-full rounded-full transition-[width] duration-75 {meterWidth > 85
								? 'bg-red-400'
								: 'bg-[oklch(0.72_0.14_45)]'}"
							style:width={`${meterWidth}%`}
						></div>
					</div>
					<div class="space-y-2 text-xs">
						<label class="flex min-h-11 items-center justify-between gap-3">
							<span>{m.video_editor_voiceover_noise_suppression()}</span>
							<Checkbox
								checked={voiceoverRecorder.noiseSuppression}
								aria-label={m.video_editor_voiceover_noise_suppression()}
								onCheckedChange={(checked) =>
									voiceoverRecorder.setNoiseSuppression(checked === true)}
							/>
						</label>
						<label class="flex min-h-11 items-center justify-between gap-3">
							<span>{m.video_editor_voiceover_auto_gain()}</span>
							<Checkbox
								checked={voiceoverRecorder.autoGainControl}
								aria-label={m.video_editor_voiceover_auto_gain()}
								onCheckedChange={(checked) =>
									voiceoverRecorder.setAutoGainControl(checked === true)}
							/>
						</label>
						<label class="flex min-h-11 items-center justify-between gap-3">
							<span>{m.video_editor_voiceover_mute_timeline()}</span>
							<Checkbox
								checked={voiceoverRecorder.muteTimeline}
								aria-label={m.video_editor_voiceover_mute_timeline()}
								onCheckedChange={(checked) => voiceoverRecorder.setMuteTimeline(checked === true)}
							/>
						</label>
					</div>
					<div class="flex min-h-11 items-center justify-between gap-3 text-xs">
						<span>{m.video_editor_voiceover_sync_offset()}</span>
						<div class="flex items-center gap-1">
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={m.video_editor_voiceover_sync_earlier()}
								onclick={() =>
									voiceoverRecorder.setSyncOffsetMs(voiceoverRecorder.syncOffsetMs - 10)}
							>
								<MinusIcon aria-hidden="true" />
							</Button>
							<span class="w-14 text-center font-mono tabular-nums">
								{voiceoverRecorder.syncOffsetMs > 0 ? '+' : ''}{voiceoverRecorder.syncOffsetMs} ms
							</span>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={m.video_editor_voiceover_sync_later()}
								onclick={() =>
									voiceoverRecorder.setSyncOffsetMs(voiceoverRecorder.syncOffsetMs + 10)}
							>
								<PlusIcon aria-hidden="true" />
							</Button>
						</div>
					</div>
					<p class="flex gap-2 text-[10px] leading-4 text-muted-foreground">
						<HeadphonesIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
						<span>{m.video_editor_voiceover_headphones_hint()}</span>
					</p>
				</Popover.Content>
			</Popover.Root>
		</div>
	{:else}
		<div
			class="flex shrink-0 items-center gap-1 rounded-md bg-red-500/10 px-1"
			role="group"
			aria-label={m.video_editor_voiceover_active()}
			data-voiceover-control
		>
			<span
				class="size-2 rounded-full bg-red-400 {voiceoverRecorder.status === 'recording'
					? 'animate-pulse motion-reduce:animate-none'
					: ''}"
				aria-hidden="true"
			></span>
			<span class="min-w-12 text-center font-mono text-xs tabular-nums">{elapsed}</span>
			{#if voiceoverRecorder.status === 'finalizing'}
				<span
					class="flex min-h-11 items-center gap-1 px-1 text-xs text-muted-foreground md:min-h-7"
				>
					<LoaderIcon class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
					{m.video_editor_voiceover_saving()}
				</span>
			{:else}
				<div
					class="hidden h-1.5 w-10 overflow-hidden rounded-full bg-[oklch(0.24_0.01_55)] sm:block"
				>
					<div
						class="h-full rounded-full {meterWidth > 85
							? 'bg-red-400'
							: 'bg-[oklch(0.72_0.14_45)]'}"
						style:width={`${meterWidth}%`}
					></div>
				</div>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={voiceoverRecorder.status === 'paused'
						? m.video_editor_voiceover_resume()
						: m.video_editor_voiceover_pause()}
					onclick={() =>
						voiceoverRecorder.status === 'paused'
							? voiceoverRecorder.resume()
							: voiceoverRecorder.pause()}
				>
					{#if voiceoverRecorder.status === 'paused'}
						<PlayIcon aria-hidden="true" />
					{:else}
						<PauseIcon aria-hidden="true" />
					{/if}
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={m.video_editor_voiceover_stop()}
					onclick={() => void voiceoverRecorder.stop(projectId, m.video_editor_voiceover_track())}
				>
					<SquareIcon class="text-red-400" aria-hidden="true" />
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={m.video_editor_voiceover_cancel()}
					onclick={() => voiceoverRecorder.cancel()}
				>
					<XIcon aria-hidden="true" />
				</Button>
			{/if}
		</div>
	{/if}
{/if}
