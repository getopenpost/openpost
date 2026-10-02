<script lang="ts">
	import { useNodesInitialized, useSvelteFlow, useViewportInitialized } from '@xyflow/svelte';
	import { untrack } from 'svelte';
	let {
		id,
		canvas,
		onreveal
	}: {
		id: string;
		canvas: HTMLDivElement | undefined;
		onreveal: (id: string) => void;
	} = $props();
	const flow = useSvelteFlow();
	const nodesReady = useNodesInitialized();
	const viewportReady = useViewportInitialized();
	const VIEW_PADDING = 16;

	$effect(() => {
		const target = id;
		const element = canvas;
		if (!target || !element || !nodesReady.current || !viewportReady.current) return;
		untrack(() => {
			const node = element.querySelector<HTMLElement>(
				`.svelte-flow__node[data-id="${CSS.escape(target)}"]`
			);
			if (!node) return;
			const rectangles = [node, ...node.querySelectorAll('button')].map((control) =>
				control.getBoundingClientRect()
			);
			const left = Math.min(...rectangles.map((rect) => rect.left));
			const top = Math.min(...rectangles.map((rect) => rect.top));
			const right = Math.max(...rectangles.map((rect) => rect.right));
			const bottom = Math.max(...rectangles.map((rect) => rect.bottom));
			const bounds = element.getBoundingClientRect();
			if (right <= left || bottom <= top || !bounds.width || !bounds.height) return;
			onreveal(target);
			if (
				left >= bounds.left + VIEW_PADDING &&
				right <= bounds.right - VIEW_PADDING &&
				top >= bounds.top + VIEW_PADDING &&
				bottom <= bounds.bottom - VIEW_PADDING
			)
				return;
			const viewport = flow.getViewport();
			const zoom = Math.min(
				viewport.zoom,
				(viewport.zoom * (bounds.width - VIEW_PADDING * 2)) / (right - left),
				(viewport.zoom * (bounds.height - VIEW_PADDING * 2)) / (bottom - top)
			);
			const centerX = ((left + right) / 2 - bounds.left - viewport.x) / viewport.zoom;
			const centerY = ((top + bottom) / 2 - bounds.top - viewport.y) / viewport.zoom;
			void flow.setViewport({
				x: bounds.width / 2 - centerX * zoom,
				y: bounds.height / 2 - centerY * zoom,
				zoom
			});
		});
	});
</script>
