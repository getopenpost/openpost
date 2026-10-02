<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Download, FileUp, RotateCcw } from '@lucide/svelte';
	import {
		audioFormats,
		videoFormats,
		type MediaConversionTool,
		type MediaOutputFormat
	} from '@openpost/social-images';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AppSelect from '$lib/components/app-select.svelte';
	import ProgressMeter from '$lib/components/progress-meter.svelte';
	import { ObjectURLSlot } from './local-image';
	import {
		openLocalMedia,
		inspectLocalMedia,
		inspectConvertedMedia,
		convertLocalMedia,
		mediaCodecOptions,
		mediaBytes,
		mediaCodecLabel,
		audioUsesBitrate,
		type MediaInfo,
		type VideoChoice,
		type AudioChoice
	} from './local-media';
	import type { Input as MediaInput, AudioCodec, VideoCodec } from 'mediabunny';

	let { tool }: { tool: MediaConversionTool } = $props();
	const audioOnly = $derived(tool.mode === 'audio' || tool.mode === 'extract');
	const inspectOnly = $derived(tool.mode === 'inspect');
	let picker = $state<HTMLInputElement | null>(null);
	let source: MediaInput | null = null;
	let file = $state<File | null>(null);
	let info = $state<MediaInfo | null>(null);
	let outputInfo = $state<MediaInfo | null>(null);
	const initial = untrack(
		() =>
			({
				format: tool.output ?? 'mp4',
				videoCodec: tool.mode === 'compress' ? 'avc' : 'auto',
				audioCodec:
					tool.mode === 'mute'
						? 'mute'
						: tool.mode === 'audio' || tool.mode === 'extract'
							? tool.output === 'm4a'
								? 'aac'
								: tool.output === 'mp3'
									? 'mp3'
									: 'auto'
							: 'auto'
			}) satisfies { format: MediaOutputFormat; videoCodec: VideoChoice; audioCodec: AudioChoice }
	);
	let format = $state<MediaOutputFormat>(initial.format);
	let videoCodec = $state<VideoChoice>(initial.videoCodec);
	let audioCodec = $state<AudioChoice>(initial.audioCodec);
	let videoBitrate = $state('4');
	let audioBitrate = $state('192');
	let height = $state('original');
	let videoCodecs = $state<VideoCodec[]>([]);
	let audioCodecs = $state<AudioCodec[]>([]);
	let checking = $state(false);
	let busy = $state(false);
	let phase = $state('');
	let progress = $state(0);
	let error = $state('');
	let result = $state<Blob | null>(null);
	let resultURL = $state('');
	const outputURL = new ObjectURLSlot();
	let operation = $state.raw<AbortController | null>(null);
	let running: Promise<void> | null = null;
	let version = 0;
	let destroyed = false;
	const outputName = $derived(`${file?.name.replace(/\.[^.]+$/, '') || 'media'}.${format}`);
	const videoOptions = $derived([
		{ value: 'auto', label: 'Automatic, keep compatible codecs' },
		{ value: 'copy', label: 'Keep source codec' },
		...videoCodecs.map((codec) => ({ value: codec, label: mediaCodecLabel(codec) }))
	]);
	const audioOptions = $derived([
		{ value: 'auto', label: 'Automatic, keep compatible codecs' },
		{ value: 'copy', label: 'Keep source codec' },
		...audioCodecs.map((codec) => ({ value: codec, label: mediaCodecLabel(codec) })),
		...(!audioOnly ? [{ value: 'mute', label: 'Remove audio' }] : [])
	]);

	function clearResult() {
		result = null;
		resultURL = '';
		outputInfo = null;
		outputURL.clear();
	}
	function reset() {
		version++;
		source?.dispose();
		source = null;
		file = null;
		info = null;
		error = '';
		phase = '';
		clearResult();
	}
	async function load(next: File) {
		if (busy) return;
		reset();
		const current = ++version;
		busy = true;
		phase = 'Reading media…';
		let candidate: MediaInput | null = null;
		try {
			candidate = openLocalMedia(next);
			const metadata = await inspectLocalMedia(candidate);
			if (current !== version) {
				candidate.dispose();
				return;
			}
			if (tool.input && tool.input !== 'm4a' && metadata.format.toLowerCase() !== tool.input) {
				throw new Error(
					`Choose a ${tool.input.toUpperCase()} file for this tool. Use the general converter for other formats.`
				);
			}
			if (
				tool.input === 'm4a' &&
				(metadata.format.toLowerCase() !== 'mp4' ||
					metadata.tracks.some((track) => track.type === 'video'))
			) {
				throw new Error('Choose an M4A audio file for this tool.');
			}
			source = candidate;
			info = metadata;
			file = next;
			phase = 'File ready.';
		} catch (reason) {
			candidate?.dispose();
			if (current === version)
				error =
					reason instanceof Error
						? reason.message
						: 'This file could not be read. Try another file.';
		} finally {
			if (current === version) busy = false;
		}
	}
	async function convert() {
		if (!source || busy || checking) return;
		const videoRate = Number(videoBitrate) * 1_000_000;
		const audioRate = Number(audioBitrate) * 1000;
		const videoTranscode =
			!audioOnly && (tool.mode === 'compress' || !['auto', 'copy'].includes(videoCodec));
		const audioTranscode = audioUsesBitrate(audioCodec);
		if (
			videoTranscode &&
			(!Number.isFinite(videoRate) || videoRate < 100_000 || videoRate > 100_000_000)
		) {
			error = 'Use a video bitrate between 0.1 and 100 Mbps.';
			return;
		}
		if (
			audioTranscode &&
			(!Number.isFinite(audioRate) || audioRate < 32_000 || audioRate > 320_000)
		) {
			error = 'Use an audio bitrate between 32 and 320 kbps.';
			return;
		}
		clearResult();
		error = '';
		busy = true;
		progress = 0;
		phase = 'Preparing conversion…';
		const controller = new AbortController();
		operation = controller;
		const input = source;
		running = (async () => {
			try {
				const blob = await convertLocalMedia(
					input,
					{
						format,
						audioOnly,
						videoCodec,
						audioCodec,
						videoBitrate: videoRate,
						audioBitrate: audioRate,
						compress: tool.mode === 'compress',
						height: height === 'original' ? undefined : Number(height)
					},
					controller.signal,
					(value) => {
						progress = value * 100;
						phase = `Converting… ${Math.round(progress)}%`;
					}
				);
				outputInfo = await inspectConvertedMedia(blob);
				controller.signal.throwIfAborted();
				if (destroyed) return;
				result = blob;
				resultURL = outputURL.set(blob).url;
				progress = 100;
				phase = 'Conversion complete. Your download is ready.';
			} catch (reason) {
				if (controller.signal.aborted)
					phase = 'Conversion cancelled. You can change settings and try again.';
				else
					error =
						reason instanceof Error
							? reason.message
							: 'Conversion failed. Try another format or codec.';
			} finally {
				busy = false;
				operation = null;
			}
		})();
		await running;
		running = null;
	}
	function download() {
		if (!result || !resultURL) return;
		const link = document.createElement('a');
		link.href = resultURL;
		link.download = outputName;
		link.click();
		phase = `Downloaded ${outputName}.`;
	}

	$effect(() => {
		const selected = format;
		if (inspectOnly) return;
		checking = true;
		let active = true;
		mediaCodecOptions(selected)
			.then((codecs) => {
				if (!active) return;
				videoCodecs = codecs.video;
				audioCodecs = codecs.audio;
				if (
					!['auto', 'copy'].includes(videoCodec) &&
					!codecs.video.some((codec) => codec === videoCodec)
				)
					videoCodec = 'auto';
				if (
					!['auto', 'copy', 'mute'].includes(audioCodec) &&
					!codecs.audio.some((codec) => codec === audioCodec)
				)
					audioCodec = 'auto';
			})
			.catch(() => {
				if (active) error = 'Codec support could not load. Refresh this page to try again.';
			})
			.finally(() => {
				if (active) checking = false;
			});
		return () => {
			active = false;
		};
	});
	$effect(() => {
		void [format, videoCodec, audioCodec, videoBitrate, audioBitrate, height];
		clearResult();
	});
	onDestroy(() => {
		destroyed = true;
		version++;
		operation?.abort();
		const input = source;
		if (running) void running.finally(() => input?.dispose());
		else input?.dispose();
		outputURL.clear();
	});
</script>

<div class="media-tool" aria-busy={busy}>
	{#if !file}
		<Button
			variant="outline"
			class="media-drop focus-ring"
			disabled={busy}
			onclick={() => picker?.click()}
			ondragover={(event) => event.preventDefault()}
			ondrop={(event) => {
				event.preventDefault();
				const dropped = event.dataTransfer?.files[0];
				if (dropped) void load(dropped);
			}}
		>
			<FileUp size={28} aria-hidden="true" />
			<span
				>Drop or choose {tool.input
					? `a ${tool.input.toUpperCase()} file`
					: audioOnly && tool.mode !== 'extract'
						? 'an audio file'
						: 'a video or audio file'}</span
			>
			<small>Up to 250 MB. Processing stays on your device.</small>
		</Button>
		<Input
			bind:ref={picker}
			type="file"
			class="hidden"
			tabindex={-1}
			aria-label="Choose a media file"
			accept="video/*,audio/*,.mp4,.mkv,.webm,.mov,.mp3,.wav,.m4a,.ogg,.flac"
			disabled={busy}
			onchange={(event) => {
				const next = event.currentTarget.files?.[0];
				if (next) void load(next);
				event.currentTarget.value = '';
			}}
		/>
	{:else if info}
		<div class="file-summary">
			<strong>{file.name}</strong><span
				>{mediaBytes(file.size)} · {info.format} · {info.duration.toFixed(2)} seconds</span
			>
		</div>
		<dl class="tracks" aria-label="Source media information">
			{#each info.tracks as track, i (i)}
				<div>
					<dt>{track.type}</dt>
					<dd>
						{mediaCodecLabel(track.codec)}{track.detail ? ` · ${track.detail}` : ''}
					</dd>
				</div>
			{/each}
		</dl>
		{#if !inspectOnly}
			<fieldset disabled={busy}>
				<div class="settings">
					<div class="field">
						<Label for="media-format">Output format</Label><AppSelect
							id="media-format"
							value={format}
							onValueChange={(value) => {
								format = value as MediaOutputFormat;
							}}
							options={(audioOnly ? audioFormats : videoFormats).map((item) => ({
								value: item.id,
								label: item.name
							}))}
						/>
					</div>
					{#if !audioOnly}
						<div class="field">
							<Label for="video-codec">Video codec</Label><AppSelect
								id="video-codec"
								value={videoCodec}
								disabled={checking || busy}
								onValueChange={(value) => {
									videoCodec = value as VideoChoice;
								}}
								options={videoOptions}
							/>
						</div>
						{#if tool.mode === 'compress' || !['auto', 'copy'].includes(videoCodec)}
							<div class="field">
								<Label for="video-bitrate">Video bitrate, Mbps</Label><Input
									id="video-bitrate"
									type="number"
									min="0.1"
									max="100"
									step="0.1"
									bind:value={videoBitrate}
								/>
							</div>
						{/if}
						{#if tool.mode === 'compress'}
							<div class="field">
								<Label for="video-height">Maximum height</Label><AppSelect
									id="video-height"
									value={height}
									onValueChange={(value) => {
										height = value;
									}}
									options={[
										{ value: 'original', label: 'Original resolution' },
										{ value: '1080', label: '1080p' },
										{ value: '720', label: '720p' },
										{ value: '480', label: '480p' }
									]}
								/>
							</div>
						{/if}
					{/if}
					{#if tool.mode !== 'mute'}
						<div class="field">
							<Label for="audio-codec">Audio codec</Label><AppSelect
								id="audio-codec"
								value={audioCodec}
								disabled={checking || busy}
								onValueChange={(value) => {
									audioCodec = value as AudioChoice;
								}}
								options={audioOptions}
							/>
						</div>
						{#if audioUsesBitrate(audioCodec)}
							<div class="field">
								<Label for="audio-bitrate">Audio bitrate, kbps</Label><Input
									id="audio-bitrate"
									type="number"
									min="32"
									max="320"
									step="16"
									bind:value={audioBitrate}
								/>
							</div>
						{/if}
					{/if}
				</div>
			</fieldset>
			<p class="hint">
				Uses the primary {audioOnly ? 'audio track' : 'video and audio tracks'}. Subtitles,
				attachments and extra tracks are omitted. Output is held in browser memory, up to 500 MB.
			</p>
			{#if checking}<p class="hint" role="status">Checking available encoders…</p>{/if}
			<div class="actions">
				<Button onclick={convert} disabled={busy || checking}
					>{tool.mode === 'mute'
						? 'Remove audio'
						: tool.mode === 'compress'
							? 'Compress video'
							: 'Convert file'}</Button
				>
				{#if operation}<Button variant="outline" onclick={() => operation?.abort()}>Cancel</Button
					>{/if}
				{#if result}<Button variant="outline" onclick={download}
						><Download data-icon="inline-start" />Download {format.toUpperCase()}</Button
					>{/if}
			</div>
			{#if operation}<ProgressMeter fraction={progress / 100} label="Conversion progress" />{/if}
			{#if result && outputInfo}
				<div class="result">
					<strong>{outputName}</strong>
					<p>
						{mediaBytes(result.size)} · {outputInfo.duration.toFixed(2)} seconds{result.size <
						file.size
							? ` · ${Math.round((1 - result.size / file.size) * 100)}% smaller`
							: ''}
					</p>
					<p>
						{outputInfo.tracks.map((track) => mediaCodecLabel(track.codec)).join(' + ')}
					</p>
					{#if audioOnly}<audio controls src={resultURL} aria-label="Converted audio preview"
						></audio>
					{:else if format === 'mp4' || format === 'webm' || format === 'mov'}<video
							controls
							playsinline
							src={resultURL}
							aria-label="Converted video preview"><track kind="captions" /></video
						>{/if}
				</div>
			{/if}
		{/if}
		<Button variant="ghost" onclick={reset} disabled={busy}
			><RotateCcw data-icon="inline-start" />Choose another file</Button
		>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<p class="status" role="status">{phase}</p>
</div>

<style>
	.media-tool {
		display: grid;
		gap: 16px;
		min-width: 0;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
	}
	.media-tool :global(.media-drop) {
		display: flex;
		flex-direction: column;
		height: auto;
		min-height: 180px;
		width: 100%;
		padding: 24px 16px;
		gap: 12px;
		white-space: normal;
		text-align: center;
		border-style: dashed;
	}
	small,
	.hint,
	.status,
	.file-summary span,
	.result p {
		color: var(--muted-foreground);
		font-size: 12px;
		line-height: 1.6;
	}
	.file-summary {
		display: grid;
		gap: 6px;
	}
	strong {
		overflow-wrap: anywhere;
	}
	.tracks {
		display: grid;
		gap: 8px;
		font-size: 13px;
	}
	.tracks > div {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	dt {
		text-transform: capitalize;
		font-weight: 600;
	}
	dd {
		overflow-wrap: anywhere;
	}
	fieldset {
		min-width: 0;
	}
	.settings {
		display: grid;
		gap: 16px;
	}
	.field {
		display: grid;
		min-width: 0;
		gap: 8px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.result {
		display: grid;
		gap: 6px;
		border-top: 1px solid var(--border);
		padding-top: 16px;
	}
	video {
		width: 100%;
		max-height: 360px;
		border-radius: 8px;
	}
	audio {
		width: 100%;
		min-width: 0;
	}
	.error {
		color: var(--destructive);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.status:empty {
		display: none;
	}
	@container tool (min-width: 550px) {
		.settings {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
