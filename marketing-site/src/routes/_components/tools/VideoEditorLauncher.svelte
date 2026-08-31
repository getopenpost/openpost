<script lang="ts">
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import {
		ArrowRight,
		Captions,
		Check,
		Clapperboard,
		MonitorUp,
		ShieldCheck
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { appUrl } from '../../_marketing';

	const videoEditorURL = `${appUrl}/video-editor?utm_source=openpost.social&utm_medium=free-tool&utm_campaign=public-video-editor`;
	const formats = [
		{ label: 'Portrait', size: '1080 × 1920', ratio: '9 / 16' },
		{ label: 'Feed portrait', size: '1080 × 1350', ratio: '4 / 5' },
		{ label: 'Square', size: '1080 × 1080', ratio: '1 / 1' },
		{ label: 'Landscape', size: '1920 × 1080', ratio: '16 / 9' }
	];
</script>

<div class="mt-8 overflow-hidden rounded-xl border bg-card">
	<div class="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(30rem,1.1fr)]">
		<section class="flex flex-col p-5 sm:p-8 lg:p-10" aria-labelledby="video-editor-launch-title">
			<div
				class="flex size-11 items-center justify-center rounded-xl border bg-background text-primary"
			>
				<Clapperboard class="size-5" aria-hidden="true" />
			</div>
			<h2 id="video-editor-launch-title" class="mt-5 text-2xl font-semibold">
				Cut fast or build the complete edit
			</h2>
			<p class="mt-3 max-w-xl leading-7 text-muted-foreground">
				Quick Cut removes sections and copies eligible source streams without a video transcode.
				Full editor adds a multitrack timeline, separate recording tracks, transcript editing,
				motion, color, audio tools, effects, and queued export. Projects stay in a folder you
				choose.
			</p>

			<ul class="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
				<li class="flex items-center gap-2">
					<Check class="size-4 text-primary" aria-hidden="true" />
					No account or watermark
				</li>
				<li class="flex items-center gap-2">
					<ShieldCheck class="size-4 text-primary" aria-hidden="true" />
					Projects stay on your disk
				</li>
				<li class="flex items-center gap-2">
					<MonitorUp class="size-4 text-primary" aria-hidden="true" />
					Screen, camera, and mic tracks
				</li>
				<li class="flex items-center gap-2">
					<Captions class="size-4 text-primary" aria-hidden="true" />
					Local captions and cleanup
				</li>
			</ul>

			<Button
				href={videoEditorURL}
				onclick={() =>
					captureTelemetryEvent('public editor opened', {
						editor: 'video',
						source: 'marketing_tool'
					})}
				class="mt-8 inline-flex min-h-11 w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
			>
				Open OpenPost Video Editor
				<ArrowRight class="size-4" aria-hidden="true" />
			</Button>
			<p class="mt-3 text-xs leading-5 text-muted-foreground">
				Requires current Chrome or Edge with WebCodecs, private file storage, and WebGL2. Capture
				and export options vary by device.
			</p>
		</section>

		<section
			class="border-t bg-neutral-950 p-5 text-neutral-100 sm:p-8 lg:border-t-0 lg:border-l"
			aria-label="OpenPost Video Editor export formats"
		>
			<div class="flex items-center justify-between gap-4">
				<div>
					<p class="text-xs font-medium tracking-wide text-orange-300 uppercase">
						OpenPost Video Editor
					</p>
					<h2 class="mt-1 text-lg font-semibold">One timeline, four frames</h2>
				</div>
				<span class="rounded-full border border-white/15 px-2.5 py-1 text-xs text-neutral-300"
					>Disk workspace</span
				>
			</div>
			<div class="mt-6 grid grid-cols-2 gap-3">
				{#each formats as format (format.label)}
					<div class="rounded-lg border border-white/10 bg-white/[0.04] p-3">
						<div class="grid h-28 place-items-center rounded-md bg-neutral-900">
							<div
								class="max-h-20 max-w-28 bg-orange-50 shadow-lg"
								style:aspect-ratio={format.ratio}
								style:height={format.ratio === '9 / 16' ? '5rem' : 'auto'}
								style:width={format.ratio === '9 / 16' ? 'auto' : '7rem'}
							></div>
						</div>
						<p class="mt-3 text-sm font-medium">{format.label}</p>
						<p class="mt-0.5 text-xs text-neutral-400">{format.size}</p>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>
