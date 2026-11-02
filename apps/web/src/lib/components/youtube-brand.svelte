<script lang="ts">
	import youtube from '../../../../../assets/logos/youtube.svg?raw';
	// The official asset includes triangle-width clear space. At
	// 56×48, the painted icon is about 26px high, above the audit’s 20dp minimum.
	const svg = youtube.replace(
		'<svg ',
		'<svg style="width:56px;height:48px;min-width:56px;min-height:48px;max-width:none;flex-shrink:0" '
	);
</script>

<a
	href="https://www.youtube.com/"
	target="_blank"
	rel="noreferrer"
	aria-label="YouTube"
	class="inline-flex shrink-0"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html svg}
</a>
