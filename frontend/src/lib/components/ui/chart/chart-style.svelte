<script lang="ts">
	import { THEMES, type ChartConfig } from './chart-utils.js';

	let { id, config }: { id: string; config: ChartConfig } = $props();

	const colorConfig = $derived(
		config ? Object.entries(config).filter(([, item]) => item.theme || item.color) : null
	);

	const themeContents = $derived.by(() => {
		if (!colorConfig?.length) return;

		const contents = [];
		for (const [themeName, prefix] of Object.entries(THEMES)) {
			let content = `${prefix} [data-chart=${id}] {\n`;
			const colors = colorConfig.map(([key, item]) => {
				const theme = themeName as keyof typeof item.theme;
				const color = item.theme?.[theme] || item.color;
				return color ? `\t--color-${key}: ${color};` : null;
			});

			content += colors.join('\n') + '\n}';
			contents.push(content);
		}

		return contents.join('\n');
	});
</script>

{#if themeContents}
	{#key id}
		<svelte:element this={'style'}>
			{themeContents}
		</svelte:element>
	{/key}
{/if}
