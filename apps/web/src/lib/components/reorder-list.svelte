<script lang="ts" generics="T extends { key: string }">
	import { onDestroy, tick, type Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { m } from '$lib/paraglide/messages';
	let {
		items,
		onReorder,
		item,
		scope,
		label
	}: {
		items: T[];
		onReorder: (items: T[]) => void;
		item: Snippet<[T, number, HTMLButtonAttributes]>;
		scope: string;
		label: string;
	} = $props();
	type Session = { key: string; mode: 'keyboard' | 'pointer'; source: T[]; scope: string };
	let session = $state.raw<Session | null>(null);
	let order = $state<string[] | null>(null);
	let announcement = $state('');
	let root = $state<HTMLDivElement>();
	let scrollFrame = 0;
	const EDGE_SCROLL_ZONE = 48;
	const EDGE_SCROLL_SPEED = 12;
	const POINTER_DRAG_THRESHOLD = 6;
	let pointer: {
		id: number;
		y: number;
		currentY: number;
		capture: HTMLElement;
		key: string;
	} | null = null;
	onDestroy(() => {
		releasePointer();
	});
	const hintID = $props.id();
	const displayed = $derived(
		order ? order.flatMap((key) => items.find((item) => item.key === key) ?? []) : items
	);
	$effect(() => {
		if (session && (session.source !== items || session.scope !== scope)) cancel();
	});
	function focusHandle(key: string, mode: Session['mode'] = 'keyboard') {
		void tick().then(() =>
			root
				?.querySelector<HTMLButtonElement>(`[data-reorder-key="${CSS.escape(key)}"]`)
				?.focus({ preventScroll: mode === 'pointer' })
		);
	}
	function begin(key: string, mode: Session['mode']) {
		session = { key, mode, source: items, scope };
		order = items.map((item) => item.key);
		announcement = m.interaction_reorder_grabbed({
			name: label,
			position: items.findIndex((item) => item.key === key) + 1,
			total: items.length
		});
	}
	function move(target: number) {
		if (!session || !order || target < 0 || target >= order.length) return;
		const index = order.indexOf(session.key);
		if (index === target) return;
		const next = order.slice();
		next.splice(index, 1);
		next.splice(target, 0, session.key);
		order = next;
		announcement = m.interaction_reorder_moved({
			name: label,
			position: target + 1,
			total: items.length
		});
		focusHandle(session.key, session.mode);
	}
	function releasePointer() {
		const active = pointer;
		pointer = null;
		if (scrollFrame) cancelAnimationFrame(scrollFrame);
		scrollFrame = 0;
		if (active?.capture.hasPointerCapture(active.id))
			active.capture.releasePointerCapture(active.id);
	}
	function cancel() {
		if (session) announcement = m.interaction_reorder_cancelled();
		session = null;
		order = null;
		releasePointer();
	}
	function drop() {
		if (!session) return;
		const key = session.key;
		const mode = session.mode;
		const next = displayed;
		const position = next.findIndex((item) => item.key === key) + 1;
		const changed = next.some((item, index) => item.key !== items[index]?.key);
		cancel();
		if (changed) onReorder(next);
		announcement = m.interaction_reorder_dropped({ name: label, position });
		focusHandle(key, mode);
	}
	function handleKey(event: KeyboardEvent, key: string, index: number) {
		if (event.key === 'Tab') {
			cancel();
			return;
		}
		if (event.key === 'Escape' && session) {
			event.preventDefault();
			event.stopPropagation();
			cancel();
			announcement = m.interaction_reorder_cancelled();
			focusHandle(key);
			return;
		}
		if (event.key === ' ' || event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			if (event.repeat) return;
			if (session?.key === key) drop();
			else begin(key, 'keyboard');
			return;
		}
		const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!delta) return;
		if (!session && !event.ctrlKey) return;
		event.preventDefault();
		event.stopPropagation();
		if (!session) {
			begin(key, 'keyboard');
			move(index + delta);
			drop();
			return;
		}
		if (session.key === key) move(index + delta);
	}
	function pointerDown(event: PointerEvent, key: string) {
		if (event.button !== 0 || !event.isPrimary) return;
		cancel();
		event.preventDefault();
		if (!(event.currentTarget instanceof HTMLButtonElement) || !root) return;
		event.currentTarget.focus();
		pointer = {
			id: event.pointerId,
			y: event.clientY,
			currentY: event.clientY,
			capture: root,
			key
		};
		root.setPointerCapture(event.pointerId);
	}
	function moveAtPointer() {
		if (!pointer) return;
		const clientY = pointer.currentY;
		const rows = Array.from(root?.querySelectorAll<HTMLElement>('[data-reorder-row]') ?? []);
		const target = rows.findIndex((row) => {
			const rect = row.getBoundingClientRect();
			return clientY >= rect.top && clientY <= rect.bottom;
		});
		if (target >= 0) move(target);
	}
	function scrollAtEdge() {
		scrollFrame = 0;
		if (!pointer || session?.mode !== 'pointer') return;
		let scroller: HTMLElement | null = root?.parentElement ?? null;
		while (
			scroller &&
			!(
				scroller.scrollHeight > scroller.clientHeight &&
				/auto|scroll/.test(getComputedStyle(scroller).overflowY)
			)
		)
			scroller = scroller.parentElement;
		const bounds = scroller?.getBoundingClientRect();
		const top = Math.max(0, bounds?.top ?? 0),
			bottom = Math.min(innerHeight, bounds?.bottom ?? innerHeight);
		const offset =
			pointer.currentY < top + EDGE_SCROLL_ZONE
				? -Math.min(1, (top + EDGE_SCROLL_ZONE - pointer.currentY) / EDGE_SCROLL_ZONE)
				: pointer.currentY > bottom - EDGE_SCROLL_ZONE
					? Math.min(1, (pointer.currentY - bottom + EDGE_SCROLL_ZONE) / EDGE_SCROLL_ZONE)
					: 0;
		if (offset) {
			const target = scroller ?? document.scrollingElement;
			if (target) target.scrollTop += offset * EDGE_SCROLL_SPEED;
			moveAtPointer();
		}
		scrollFrame = requestAnimationFrame(scrollAtEdge);
	}
	function pointerMove(event: PointerEvent) {
		if (!pointer || pointer.id !== event.pointerId) return;
		pointer.currentY = event.clientY;
		if (!session) {
			if (Math.abs(event.clientY - pointer.y) < POINTER_DRAG_THRESHOLD) return;
			begin(pointer.key, 'pointer');
			scrollFrame = requestAnimationFrame(scrollAtEdge);
		}
		moveAtPointer();
	}
	function handleProps(entry: T, index: number): HTMLButtonAttributes {
		return {
			'data-reorder-key': entry.key,
			'aria-pressed': session?.key === entry.key,
			'aria-describedby': hintID,
			'aria-keyshortcuts': 'Space Enter ArrowUp ArrowDown Control+ArrowUp Control+ArrowDown Escape',
			style: 'touch-action: none;',
			onkeydown: (event) => handleKey(event, entry.key, index),
			onblur: (event) => {
				if (event.relatedTarget && session?.mode === 'keyboard' && session.key === entry.key)
					cancel();
			},
			onpointerdown: (event) => pointerDown(event, entry.key)
		};
	}
</script>

<svelte:window
	onblur={() => cancel()}
	onpointermove={pointerMove}
	onpointerup={() => {
		if (session?.mode === 'pointer') drop();
		else releasePointer();
	}}
	onpointercancel={() => cancel()}
	onkeydown={(event) => {
		if (event.key === 'Escape' && session?.mode === 'pointer') {
			const key = session.key;
			event.preventDefault();
			cancel();
			announcement = m.interaction_reorder_cancelled();
			focusHandle(key, 'pointer');
		}
	}}
/>
<span id={hintID} class="sr-only">{m.interaction_reorder_hint()}</span>
<span class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
<div
	bind:this={root}
	onlostpointercapture={() => {
		if (pointer) cancel();
	}}
	role="list"
	aria-label={label}
>
	{#each displayed as entry, index (entry.key)}
		<div
			data-reorder-row={entry.key}
			role="listitem"
			class:grabbed={session?.key === entry.key}
			animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
		>
			{@render item(entry, index, handleProps(entry, index))}
		</div>
	{/each}
</div>

<style>
	[data-reorder-row] {
		border-radius: var(--radius);
		transition: background-color 160ms ease;
	}
	.grabbed {
		background: color-mix(in oklch, var(--primary) 5%, transparent);
		outline: 1px solid color-mix(in oklch, var(--primary) 45%, transparent);
	}
	.grabbed :global([data-reorder-key]) {
		opacity: 1 !important;
		color: var(--primary);
		background: var(--muted);
	}
	@media (prefers-reduced-motion: reduce) {
		[data-reorder-row] {
			transition: none;
		}
	}
</style>
