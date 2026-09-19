<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { voiceoverRecorder } from '$lib/video-editor/recorder/voiceover-recorder.svelte';

	let { projectId }: { projectId: string } = $props();
	let settingsExpanded = $state(false);

	const deviceOptions = $derived([
		{ value: '', label: m.video_editor_voiceover_default_mic() },
		...voiceoverRecorder.devices.map((device, index) => ({
			value: device.deviceId,
			label: device.label || m.video_editor_voiceover_mic_number({ number: index + 1 })
		}))
	]);

	function start(): void {
		void voiceoverRecorder.start(projectId, m.video_editor_voiceover_track());
	}
</script>

{#if voiceoverRecorder.supported && voiceoverRecorder.status === 'idle'}
	<DropdownMenu.Item onclick={start}>
		<ProtectedIcon icon="editor-record" class="text-destructive" />
		{m.video_editor_voiceover_record()}
	</DropdownMenu.Item>
	<DropdownMenu.Item
		closeOnSelect={false}
		aria-expanded={settingsExpanded}
		onSelect={(event) => {
			event.preventDefault();
			settingsExpanded = !settingsExpanded;
		}}
	>
		<ThemeIcon role="audio" />
		{m.video_editor_voiceover_settings()}
		<ThemeIcon
			role="chevron-down"
			class="ml-auto transition-transform {settingsExpanded ? 'rotate-180' : ''}"
		/>
	</DropdownMenu.Item>
	{#if settingsExpanded}
		<div
			class="grid gap-0.5 border-l border-border/60 pl-2"
			role="group"
			aria-label={m.video_editor_voiceover_settings()}
			data-voiceover-menu-settings
		>
			<DropdownMenu.Label>{m.video_editor_voiceover_microphone()}</DropdownMenu.Label>
			{#each deviceOptions as device, index (`${device.value}:${index}`)}
				<DropdownMenu.Item
					onclick={() => voiceoverRecorder.setSelectedDeviceId(device.value || null)}
				>
					<span class="flex-1">{device.label}</span>
					{#if (voiceoverRecorder.selectedDeviceId ?? '') === device.value}
						<ThemeIcon role="check" />
					{/if}
				</DropdownMenu.Item>
			{/each}
			<DropdownMenu.Separator />
			<DropdownMenu.CheckboxItem
				checked={voiceoverRecorder.noiseSuppression}
				onCheckedChange={(checked) => voiceoverRecorder.setNoiseSuppression(checked === true)}
			>
				{m.video_editor_voiceover_noise_suppression()}
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.CheckboxItem
				checked={voiceoverRecorder.autoGainControl}
				onCheckedChange={(checked) => voiceoverRecorder.setAutoGainControl(checked === true)}
			>
				{m.video_editor_voiceover_auto_gain()}
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.CheckboxItem
				checked={voiceoverRecorder.muteTimeline}
				onCheckedChange={(checked) => voiceoverRecorder.setMuteTimeline(checked === true)}
			>
				{m.video_editor_voiceover_mute_timeline()}
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.Separator />
			<DropdownMenu.Label class="flex items-center justify-between gap-3">
				<span>{m.video_editor_voiceover_sync_offset()}</span>
				<span class="font-mono tabular-nums">
					{voiceoverRecorder.syncOffsetMs > 0 ? '+' : ''}{voiceoverRecorder.syncOffsetMs} ms
				</span>
			</DropdownMenu.Label>
			<DropdownMenu.Item
				onclick={() => voiceoverRecorder.setSyncOffsetMs(voiceoverRecorder.syncOffsetMs - 10)}
			>
				<ThemeIcon role="remove" />{m.video_editor_voiceover_sync_earlier()}
			</DropdownMenu.Item>
			<DropdownMenu.Item
				onclick={() => voiceoverRecorder.setSyncOffsetMs(voiceoverRecorder.syncOffsetMs + 10)}
			>
				<ThemeIcon role="add" />{m.video_editor_voiceover_sync_later()}
			</DropdownMenu.Item>
		</div>
	{/if}
	<DropdownMenu.Separator />
{/if}
