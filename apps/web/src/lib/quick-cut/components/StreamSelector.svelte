<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import type { QuickCutSource } from '../types';

	let {
		source,
		onChange
	}: {
		source: QuickCutSource;
		onChange: (
			patch: Pick<QuickCutSource, 'selectedVideoTrackIndex' | 'selectedAudioTrackIndices'>
		) => void;
	} = $props();

	const videoOptions = $derived.by(() => {
		const opts: Array<{ value: string; label: string }> = [];
		opts.push({ value: '__off__', label: m.quick_cut_stream_video_off() });
		for (const vs of source.videoStreams ?? []) {
			const label = `${vs.codec ?? 'video'} ${vs.width}x${vs.height}${vs.fps ? ` ${vs.fps}fps` : ''}`;
			opts.push({
				value: String(vs.index),
				label: `${m.quick_cut_stream_video_track({ index: vs.index + 1 })} · ${label}`
			});
		}
		if ((source.videoStreams ?? []).length === 0) {
			opts.length = 0;
			opts.push({ value: '__off__', label: m.quick_cut_stream_no_video() });
		}
		return opts;
	});

	const selectedAudioSet = $derived(
		new Set(
			source.selectedAudioTrackIndices ??
				(source.audioStreams?.[0] ? [source.audioStreams[0].index] : [])
		)
	);
	const hasAudioTracks = $derived((source.audioStreams?.length ?? 0) > 0);

	const videoValue = $derived.by(() => {
		if (source.selectedVideoTrackIndex === null) return '__off__';
		if (source.selectedVideoTrackIndex !== undefined) return String(source.selectedVideoTrackIndex);
		const first = source.videoStreams?.[0];
		return first ? String(first.index) : '__off__';
	});

	function onVideoChange(value: string): void {
		if (value === '__off__')
			onChange({
				selectedVideoTrackIndex: null,
				selectedAudioTrackIndices: source.selectedAudioTrackIndices
			});
		else
			onChange({
				selectedVideoTrackIndex: Number(value),
				selectedAudioTrackIndices: source.selectedAudioTrackIndices
			});
	}

	function toggleAudioTrack(index: number, checked: boolean): void {
		const current = new Set(
			source.selectedAudioTrackIndices ??
				(source.audioStreams?.[0] ? [source.audioStreams[0].index] : [])
		);
		if (checked) current.add(index);
		else current.delete(index);
		onChange({
			selectedVideoTrackIndex: source.selectedVideoTrackIndex,
			selectedAudioTrackIndices: [...current].sort((a, b) => a - b)
		});
	}
</script>

<div class="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm">
	<div class="min-w-0">
		<p class="truncate text-xs font-semibold">{source.name}</p>
		<p class="text-xs text-muted-foreground">
			{m.quick_cut_stream_summary({
				video: String(source.videoStreams?.length ?? 0),
				audio: String(source.audioStreams?.length ?? 0)
			})}
		</p>
	</div>
	<div class="grid min-w-0 gap-2 sm:grid-cols-2">
		<label class="flex min-w-0 flex-col gap-1 text-xs">
			<span class="font-medium text-muted-foreground">{m.quick_cut_stream_video_label()}</span>
			<AppSelect
				value={videoValue}
				ariaLabel={`${m.quick_cut_stream_video_label()} ${source.name}`}
				options={videoOptions}
				onValueChange={onVideoChange}
				class="h-11 min-h-11 w-full min-w-0 text-xs md:h-9 md:min-h-9"
			/>
		</label>
		<fieldset class="flex min-w-0 flex-col gap-1 text-xs">
			<legend class="font-medium text-muted-foreground">{m.quick_cut_stream_audio_label()}</legend>
			{#if hasAudioTracks}
				<div class="flex flex-col gap-1">
					{#each source.audioStreams ?? [] as aud (aud.index)}
						{@const checked = selectedAudioSet.has(aud.index)}
						<Label
							class="flex min-h-11 items-center gap-2 rounded-md border px-2 py-1 text-xs font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 md:min-h-9"
						>
							<Checkbox
								{checked}
								onCheckedChange={(c) => toggleAudioTrack(aud.index, c === true)}
								aria-label={`${m.quick_cut_stream_audio_track({ index: aud.index + 1 })} ${source.name}`}
							/>
							<span class="min-w-0 truncate"
								>{m.quick_cut_stream_audio_track({ index: aud.index + 1 })} · {aud.codec ??
									'audio'}{aud.sampleRate ? ` ${aud.sampleRate}Hz` : ''}{aud.channels
									? ` ${aud.channels}ch`
									: ''}</span
							>
						</Label>
					{/each}
				</div>
			{:else}
				<span class="rounded-md border bg-muted px-2 py-2 text-xs text-muted-foreground"
					>{m.quick_cut_stream_no_audio()}</span
				>
			{/if}
		</fieldset>
	</div>
</div>
