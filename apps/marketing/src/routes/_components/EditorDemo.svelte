<script lang="ts">
	let {
		src,
		poster,
		label,
		description,
		captions
	}: { src: string; poster: string; label: string; description: string; captions: string } =
		$props();
	let open = $state(false);
</script>

<details ontoggle={(event) => (open = event.currentTarget.open)}>
	<summary class="focus-ring">Watch {label} in action</summary>
	{#if open}
		<figure>
			<video
				{src}
				{poster}
				controls
				muted
				playsinline
				preload="metadata"
				aria-label={`${label} demonstration`}
				><track kind="captions" src={captions} srclang="en" label="Demo steps" /></video
			>
			<figcaption>{description}</figcaption>
		</figure>
	{:else}
		<p class="fallback"><a href={src} class="focus-ring">Open the {label} recording</a></p>
	{/if}
</details>

<style>
	details {
		margin-top: 8px;
	}
	summary {
		min-height: 44px;
		padding-block: 12px;
		font-size: 14px;
		font-weight: 550;
		cursor: pointer;
		border-radius: 4px;
	}
	.fallback a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-size: 14px;
		text-decoration: underline;
		text-underline-offset: 4px;
		border-radius: 4px;
	}
	video {
		display: block;
		width: 100%;
		aspect-ratio: 8 / 5;
		background: var(--muted);
		border-radius: 9px;
	}
	figcaption {
		margin-block: 12px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
</style>
