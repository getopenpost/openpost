<script lang="ts">
	import { untrack } from 'svelte';
	import type { QuickCutSource } from '../types';
	import type { AudioSilenceRange } from '$lib/video-editor/audio/audio-silence';
	import CleanupPanel from './CleanupPanel.svelte';
	import StreamSelector from './StreamSelector.svelte';
	let {
		initial,
		onapply,
		onchange
	}: {
		initial: QuickCutSource;
		onapply: (id: string, ranges: AudioSilenceRange[]) => void;
		onchange: (
			patch: Pick<QuickCutSource, 'selectedVideoTrackIndex' | 'selectedAudioTrackIndices'>
		) => void;
	} = $props();
	let source = $state<QuickCutSource>(untrack(() => ({ ...initial })));
</script>

<StreamSelector
	{source}
	onChange={(patch) => {
		source = { ...source, ...patch };
		onchange(patch);
	}}
/>
<CleanupPanel {source} {onapply} onpreview={() => {}} onreview={() => {}} />
