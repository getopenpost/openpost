<script lang="ts">
	import {
		ArrowDown,
		ArrowRight,
		AudioLines,
		Camera,
		FileAudio,
		FileImage,
		Film,
		Images,
		Music2,
		Play,
		ScanLine,
		SlidersHorizontal,
		VolumeX
	} from '@lucide/svelte';
	import { imageConversions, imageFormats, mediaConversionTools } from '@openpost/social-images';
	import { ditherSurface } from '@openpost/dither';
	let { slug }: { slug: string } = $props();
	const image = $derived(imageConversions.find((tool) => tool.slug === slug));
	const media = $derived(mediaConversionTools.find((tool) => tool.slug === slug));
	const input = $derived(image?.input ?? media?.input);
	const output = $derived(image?.output ?? media?.output);
	const family = $derived(
		image || slug === 'image-converter' ? 'image' : media?.category === 'Audio' ? 'audio' : 'video'
	);
	const pair = $derived(input && output ? [input, output] : undefined);
	const imageSample = $derived(
		input === 'jpeg' ? '/assets/marketing/studio-cup.webp' : '/assets/marketing/paper-plane.webp'
	);
	const mode = $derived(slug === 'video-codec-converter' ? 'codec' : (media?.mode ?? 'image'));
	const waveform = [
		12, 22, 16, 34, 44, 28, 18, 36, 52, 42, 24, 16, 32, 46, 26, 38, 20, 12, 24, 16, 8
	];
	const CompactIcon = $derived(
		mode === 'mute'
			? VolumeX
			: mode === 'codec'
				? SlidersHorizontal
				: mode === 'inspect'
					? ScanLine
					: family === 'audio'
						? AudioLines
						: family === 'image'
							? Images
							: Film
	);
	function formatName(format: string) {
		return imageFormats.find((item) => item.id === format)?.name ?? format.toUpperCase();
	}
</script>

{#snippet wave()}
	<div class="waveform">
		{#each waveform as height}<i style:height={`${height}px`}></i>{/each}
	</div>
{/snippet}

{#snippet filmStrip()}
	<div class="film-strip"><span><Play size={16} /></span><span></span><span></span></div>
{/snippet}

{#snippet formatPreview(format: string)}
	<div class="format-preview" class:browser={format === 'webm'} class:stacked={format === 'mkv'}>
		<div class="file-heading">
			{#if family === 'image'}<FileImage size={16} />{:else if family === 'audio'}<FileAudio
					size={16}
				/>{:else if format === 'mov'}<Camera size={16} />{:else}<Film size={16} />{/if}
			<strong>{formatName(format)}</strong>
		</div>
		{#if family === 'image'}
			<div class="image-sample" class:alpha={format === 'png'}>
				<img
					src={imageSample}
					alt=""
					width={input === 'jpeg' ? 1536 : 1000}
					height={input === 'jpeg' ? 1024 : 667}
					loading="lazy"
					decoding="async"
				/>
			</div>
			{#if format === 'webp'}<div class="quality"><span>Quality</span><i></i></div>{:else}<div
					class="image-detail"
				>
					{format === 'png' ? 'Transparency' : 'Solid background'}
				</div>{/if}
		{:else if family === 'audio'}
			<div class="audio-sample" class:pcm={format === 'wav'}>
				{#if format === 'mp3' || format === 'm4a'}<Music2 size={28} />{:else}<AudioLines
						size={28}
					/>{/if}
				{@render wave()}
			</div>
		{:else}
			{#if format === 'webm'}<div class="browser-bar"><i></i><i></i><i></i><span></span></div>{/if}
			<div class="video-sample" class:recording={format === 'mov'}><Play size={24} /></div>
			{#if format === 'mkv'}<div class="track-line"></div>
				<div class="track-line short"></div>{:else}<div class="playback">
					<span></span><i></i>
				</div>{/if}
		{/if}
	</div>
{/snippet}

<div class="composition" data-dither-panel use:ditherSurface aria-hidden="true">
	{#if pair}
		<div class="pair large">
			{@render formatPreview(pair[0])}<ArrowRight
				class="flow-arrow"
				size={24}
			/>{@render formatPreview(pair[1])}
		</div>
	{:else if mode === 'codec'}
		<div class="codec large">
			<div class="codec-heading"><SlidersHorizontal size={20} /><span>Codecs</span></div>
			<div><Film size={18} /><span>Video</span><strong>H.264</strong></div>
			<div><AudioLines size={18} /><span>Audio</span><strong>AAC</strong></div>
			<div class="codec-options"><span>H.265</span><span>VP9</span><span>AV1</span></div>
		</div>
	{:else if mode === 'compress'}
		<div class="compress large">
			<div class="resize-preview">
				<div><Play size={26} /><span>1080p</span></div>
				<ArrowDown size={22} />
				<div><Play size={18} /><span>720p</span></div>
			</div>
			<div class="size-preview">
				<span>File size</span><i></i><ArrowDown size={18} /><i class="smaller"></i>
			</div>
		</div>
	{:else if mode === 'mute'}
		<div class="timeline large">
			<div class="timeline-heading"><VolumeX size={20} /><span>Silent video</span></div>
			{@render filmStrip()}
			<div class="muted-track">
				<AudioLines size={18} />
				<div class="muted-wave">{@render wave()}</div>
				<VolumeX size={18} />
			</div>
		</div>
	{:else if mode === 'extract'}
		<div class="extract large">
			<div class="source-video"><Film size={18} />{@render filmStrip()}</div>
			<ArrowRight size={24} />
			<div class="soundtrack"><Music2 size={24} />{@render wave()}<span>MP3 · WAV · M4A</span></div>
		</div>
	{:else if mode === 'inspect'}
		<div class="inspect large">
			<div class="file-outline"><Film size={36} /><span>Media info</span></div>
			<div class="metadata">
				<div><span>Video</span><strong>H.264</strong></div>
				<div><span>Size</span><strong>1920 × 1080</strong></div>
				<div><span>Audio</span><strong>AAC</strong></div>
				<div><span>Duration</span><strong>00:42</strong></div>
			</div>
		</div>
	{:else if family === 'image'}
		<div class="image-converter large">
			<div class="image-library">
				<Images size={22} /><img
					src="/assets/marketing/studio-cup.webp"
					alt=""
					width="1536"
					height="1024"
					loading="lazy"
					decoding="async"
				/>
			</div>
			<div class="exports">
				<span><FileImage size={16} />PNG</span><span><FileImage size={16} />JPEG</span><span
					><FileImage size={16} />WebP</span
				>
			</div>
		</div>
	{:else if family === 'audio'}
		<div class="audio-converter large">
			<div class="audio-heading"><Play size={18} /><AudioLines size={18} /><span>Audio</span></div>
			{@render wave()}
			<div class="format-dock">
				<span>MP3</span><span>WAV</span><span>M4A</span><span>FLAC</span>
			</div>
		</div>
	{:else}
		<div class="video-converter large">
			<div class="player">
				<div class="player-heading"><Film size={16} /><span>Video</span></div>
				<Play size={32} />
				<div class="playback"><span></span><i></i></div>
			</div>
			<div class="exports"><span>MP4</span><span>MKV</span><span>WebM</span><span>MOV</span></div>
		</div>
	{/if}
	<div class="compact">
		{#if pair}<span>{formatName(pair[0])}</span><ArrowDown size={14} /><span
				>{formatName(pair[1])}</span
			>{:else}<CompactIcon size={28} strokeWidth={1.5} />{/if}
	</div>
</div>

<style>
	.composition {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.large {
		width: min(100%, 290px);
	}
	.compact {
		display: none;
	}
	.pair {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
	}
	.format-preview {
		width: 112px;
		min-width: 0;
		border: 1px solid color-mix(in oklch, currentColor 25%, transparent);
		border-radius: 8px;
		padding: 10px;
		background: color-mix(in oklch, var(--background) 86%, transparent);
	}
	.file-heading {
		display: flex;
		gap: 6px;
		align-items: center;
		margin-bottom: 8px;
		font-size: 14px;
		white-space: nowrap;
	}
	.file-heading strong {
		font-weight: 600;
	}
	.pair :global(.flow-arrow) {
		flex: 0 0 auto;
	}
	.image-sample {
		height: 54px;
		overflow: hidden;
		border-radius: 3px;
	}
	.image-sample img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.alpha {
		padding: 4px;
		background-color: var(--background);
		background-image: conic-gradient(
			var(--marketing-section) 25%,
			transparent 0 50%,
			var(--marketing-section) 0 75%,
			transparent 0
		);
		background-size: 12px 12px;
	}
	.image-detail,
	.quality {
		font-size: 9px;
		margin-top: 6px;
		white-space: nowrap;
	}
	.quality {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.quality i {
		height: 3px;
		flex: 1;
		background: currentColor;
		opacity: 0.5;
	}
	.video-sample {
		height: 54px;
		display: grid;
		place-items: center;
		background: color-mix(in oklch, currentColor 9%, transparent);
		border-radius: 3px;
	}
	.recording {
		border: 1px dashed currentColor;
		margin: 4px;
		height: 46px;
	}
	.browser-bar {
		display: flex;
		align-items: center;
		gap: 3px;
		height: 10px;
		margin-top: -4px;
	}
	.browser-bar i {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: currentColor;
	}
	.browser-bar span {
		height: 3px;
		width: 44px;
		background: currentColor;
		opacity: 0.15;
		margin-left: 5px;
	}
	.browser .video-sample {
		height: 48px;
	}
	.stacked {
		border-bottom-width: 4px;
	}
	.playback {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 9px;
	}
	.playback span {
		width: 75%;
		height: 3px;
		background: currentColor;
		opacity: 0.4;
	}
	.playback i {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: currentColor;
	}
	.track-line {
		height: 3px;
		background: currentColor;
		opacity: 0.3;
		margin-top: 5px;
	}
	.track-line.short {
		width: 65%;
	}
	.waveform {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		height: 54px;
		overflow: hidden;
	}
	.waveform i {
		width: 3px;
		min-width: 2px;
		background: currentColor;
		border-radius: 2px;
	}
	.audio-sample {
		display: grid;
		place-items: center;
		height: 65px;
		position: relative;
	}
	.audio-sample :global(svg) {
		position: absolute;
		z-index: 1;
		padding: 3px;
		box-sizing: content-box;
		background: var(--background);
	}
	.audio-sample .waveform {
		opacity: 0.35;
		width: 100%;
	}
	.pcm .waveform i {
		border-radius: 0;
		width: 2px;
	}
	.codec {
		padding: 14px;
		background: color-mix(in oklch, var(--background) 80%, transparent);
		border-radius: 8px;
	}
	.codec-heading,
	.timeline-heading,
	.audio-heading {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
	}
	.codec > div:not(:first-child):not(:last-child) {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		font-size: 12px;
	}
	.codec strong {
		margin-left: auto;
		font-weight: 600;
		border-bottom: 1px solid currentColor;
		padding: 0 6px 2px;
	}
	.codec-options {
		display: flex;
		gap: 16px;
		font-size: 10px;
		margin: 12px 0 0 26px;
	}
	.compress {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 32px;
	}
	.resize-preview {
		display: grid;
		justify-items: center;
		gap: 5px;
	}
	.resize-preview > div {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 132px;
		height: 52px;
		border: 1px solid currentColor;
		border-radius: 5px;
		font-size: 11px;
	}
	.resize-preview > div:last-child {
		width: 94px;
		height: 38px;
		background: color-mix(in oklch, var(--background) 70%, transparent);
	}
	.size-preview {
		display: grid;
		gap: 10px;
		justify-items: start;
		width: 64px;
		font-size: 11px;
	}
	.size-preview i {
		display: block;
		width: 64px;
		height: 16px;
		background: currentColor;
		opacity: 0.25;
		border-radius: 2px;
	}
	.size-preview .smaller {
		width: 28px;
		opacity: 0.65;
	}
	.timeline {
		display: grid;
		gap: 12px;
	}
	.film-strip {
		display: flex;
		gap: 4px;
		height: 44px;
	}
	.film-strip span {
		flex: 1;
		border: 1px solid currentColor;
		border-radius: 3px;
		background: color-mix(in oklch, var(--background) 70%, transparent);
		display: grid;
		place-items: center;
	}
	.muted-track {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.muted-wave {
		flex: 1;
		height: 24px;
		overflow: hidden;
		position: relative;
		opacity: 0.45;
	}
	.muted-wave .waveform {
		height: 24px;
	}
	.muted-wave::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		border-top: 2px solid currentColor;
	}
	.extract {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
	}
	.source-video {
		width: 112px;
		display: grid;
		gap: 10px;
	}
	.soundtrack {
		width: 112px;
		display: grid;
		justify-items: center;
		padding: 10px;
		background: color-mix(in oklch, var(--background) 80%, transparent);
		border-radius: 6px;
	}
	.soundtrack .waveform {
		width: 100%;
		height: 38px;
	}
	.soundtrack span {
		font-size: 9px;
		white-space: nowrap;
	}
	.inspect {
		display: flex;
		align-items: center;
		gap: 20px;
	}
	.file-outline {
		width: 94px;
		height: 120px;
		border: 1px solid currentColor;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		font-size: 11px;
	}
	.metadata {
		flex: 1;
		font-size: 11px;
	}
	.metadata > div {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding-block: 8px;
		border-bottom: 1px solid color-mix(in oklch, currentColor 20%, transparent);
	}
	.metadata strong {
		font-weight: 550;
		white-space: nowrap;
	}
	.image-converter,
	.video-converter {
		display: flex;
		align-items: center;
		gap: 24px;
	}
	.image-library {
		width: 164px;
		position: relative;
	}
	.image-library > :global(svg) {
		position: absolute;
		left: -10px;
		top: -10px;
		padding: 6px;
		box-sizing: content-box;
		background: var(--background);
		border-radius: 5px;
	}
	.image-library img {
		width: 100%;
		height: 110px;
		object-fit: cover;
		border-radius: 5px;
	}
	.exports {
		display: grid;
		gap: 12px;
		font-size: 12px;
		font-weight: 600;
	}
	.exports > span {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.audio-converter {
		padding: 14px 20px;
		background: color-mix(in oklch, var(--background) 65%, transparent);
		border-radius: 8px;
	}
	.audio-converter .waveform {
		margin-block: 6px;
	}
	.format-dock {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		font-size: 10px;
	}
	.player {
		width: 192px;
		height: 128px;
		padding: 10px;
		border: 1px solid color-mix(in oklch, currentColor 30%, transparent);
		border-radius: 6px;
		display: grid;
		justify-items: center;
		align-content: space-between;
		background: color-mix(in oklch, var(--background) 65%, transparent);
	}
	.player-heading {
		justify-self: stretch;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
	}
	.player .playback {
		justify-self: stretch;
	}
	@container (max-width: 100px) {
		.composition {
			padding: 4px;
		}
		.large {
			display: none;
		}
		.compact {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 1px;
			font-size: 11px;
			font-weight: 600;
			line-height: 1.2;
		}
	}
</style>
