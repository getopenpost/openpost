<script lang="ts">
	import youtube from '../../../../../assets/logos/youtube.svg?raw';
	// The official asset includes triangle-width clear space. At these dimensions
	// the painted icon is over 100px high, the current digital minimum.
	const svg = youtube.replace(
		'<svg ',
		'<svg style="width:218px;height:187px;min-width:218px;min-height:187px;max-width:none;flex-shrink:0" '
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
