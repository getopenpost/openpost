<script lang="ts">
	let {
		anchor,
		text,
		measureKey = '',
		kind = null,
		offsetY = 6
	}: {
		anchor: HTMLElement | null;
		text: string;
		measureKey?: string;
		kind?: string | null;
		offsetY?: number;
	} = $props();

	let readout: HTMLDivElement | null = $state.raw(null);
	let left = $state(0);
	let top = $state(0);
	let visible = $state(false);
	let animationFrame: number | null = null;

	function updatePosition(activeAnchor: HTMLElement): void {
		if (!readout || !activeAnchor.isConnected) {
			visible = false;
			return;
		}
		const anchorRect = activeAnchor.getBoundingClientRect();
		const width = readout.offsetWidth;
		const height = readout.offsetHeight;
		const viewportPadding = 4;
		const preferredLeft = anchorRect.left + anchorRect.width / 2 - width / 2;
		const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
		left = Math.max(viewportPadding, Math.min(maxLeft, preferredLeft));
		const above = anchorRect.top - offsetY - height;
		const below = Math.min(
			Math.max(viewportPadding, window.innerHeight - height - viewportPadding),
			anchorRect.bottom + offsetY
		);
		top = above >= viewportPadding ? above : below;
		visible = true;
	}

	function schedulePosition(activeAnchor: HTMLElement, key: string): void {
		if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		animationFrame = requestAnimationFrame(() => {
			animationFrame = null;
			if (measureKey !== key || anchor !== activeAnchor) return;
			updatePosition(activeAnchor);
		});
	}

	$effect(() => {
		const activeAnchor = anchor;
		const activeText = text;
		const activeKey = measureKey;
		if (!activeAnchor || !activeText) {
			visible = false;
			return;
		}
		const update = () => schedulePosition(activeAnchor, activeKey);
		update();
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		const observer = new ResizeObserver(update);
		observer.observe(activeAnchor);
		return () => {
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
			observer.disconnect();
			if (animationFrame !== null) {
				cancelAnimationFrame(animationFrame);
				animationFrame = null;
			}
		};
	});
</script>

{#if anchor && text}
	<div
		bind:this={readout}
		class="pointer-events-none fixed z-[10000] max-w-[calc(100vw-8px)] overflow-hidden rounded bg-slate-950/95 px-1.5 py-0.5 font-mono text-[10px] font-medium text-ellipsis whitespace-nowrap text-white shadow-lg"
		style="left:{left}px;top:{top}px;visibility:{visible ? 'visible' : 'hidden'}"
		data-fade-readout={kind ?? undefined}
	>
		{text}
	</div>
{/if}
