<script lang="ts">
	interface Props {
		class?: string;
		width?: number;
		height?: number;
		showText?: boolean;
	}

	let { class: className = '', width = 100, height = 28, showText = false }: Props = $props();
</script>

<div class="flex items-center gap-2 {className}">
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 450 350"
		{width}
		{height}
		aria-label="OpenPost"
		class="h-auto max-w-full"
	>
		<defs>
			<mask id="nib-cutout">
				<rect x="-50" y="-20" width="100" height="150" fill="white" />
				<circle cx="0" cy="35" r="5" fill="black" />
				<rect x="-1.5" y="35" width="3" height="70" fill="black" />
			</mask>
		</defs>

		<g transform="translate(160, 180) rotate(-40)" class="fill-foreground">
			<path
				d="M -30 -170 
             A 30 30 0 0 1 30 -170 
             L 22 -10 
             L -22 -10 Z"
			/>

			<path
				d="M -20 0 
             L 20 0 
             L 28 35 
             L 0 100 
             L -28 35 Z"
				mask="url(#nib-cutout)"
			/>
		</g>

		<path
			d="M 235 280
           C 250 290, 265 230, 275 230
           C 285 230, 290 275, 300 275
           C 310 275, 325 160, 340 160
           C 355 160, 365 290, 380 290
           C 395 290, 400 170, 415 170"
			fill="none"
			class="stroke-foreground"
			stroke-width="18"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
	{#if showText}
		<span class="font-bold whitespace-nowrap text-sidebar-foreground">OpenPost</span>
	{/if}
</div>
