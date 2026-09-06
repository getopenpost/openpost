import {
	createBrowserPointerGestureSessionHost,
	type PointerGestureEvent,
	type PointerGestureSessionHost
} from '../timeline/pointer-gesture-session';

const MARQUEE_ACTIVATION_DISTANCE_PX = 4;
const ASSET_ROW_SELECTOR = '[data-asset-row]';
const OPEN_MENU_SELECTOR = '[role="menu"]';
const TEXT_EDITING_SELECTOR =
	'input, textarea, select, [contenteditable="true"], [data-editor-shortcuts-disabled]';
const MARQUEE_DISABLED_SELECTOR =
	'button, input, textarea, select, a, [contenteditable="true"], [draggable="true"], [data-asset-row], [data-marquee-ignore]';

export interface AssetLibrarySelection {
	mediaIds: Set<string>;
	sequenceIds: Set<string>;
}

interface RectangleEdges {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

interface Point {
	x: number;
	y: number;
}

interface ActiveMarquee {
	startClientX: number;
	startClientY: number;
	active: boolean;
	additive: boolean;
	base: AssetLibrarySelection;
	selection: AssetLibrarySelection;
	rows: ResolvedAssetRow[] | null;
}

interface ResolvedAssetRow {
	rectangle: DOMRect;
	mediaId?: string;
	sequenceId?: string;
}

export interface AssetLibrarySelectionControllerOptions {
	getSelection(): AssetLibrarySelection;
	getVisibleSelection(): AssetLibrarySelection;
	setSelection(selection: AssetLibrarySelection): void;
	clearSelection(): void;
	requestDelete(): void;
	interactionBlocked(): boolean;
	onMarqueeSelectionChange(selection: AssetLibrarySelection | null): void;
}

export interface AssetLibrarySelectionController {
	connect(surface: HTMLElement): { destroy(): void };
	focus(): void;
}

function copySelection(selection: AssetLibrarySelection): AssetLibrarySelection {
	return {
		mediaIds: new Set(selection.mediaIds),
		sequenceIds: new Set(selection.sequenceIds)
	};
}

function unionSelection(
	base: AssetLibrarySelection,
	hits: AssetLibrarySelection
): AssetLibrarySelection {
	return {
		mediaIds: new Set([...base.mediaIds, ...hits.mediaIds]),
		sequenceIds: new Set([...base.sequenceIds, ...hits.sequenceIds])
	};
}

function selectionSize(selection: AssetLibrarySelection): number {
	return selection.mediaIds.size + selection.sequenceIds.size;
}

function selectionsEqual(first: AssetLibrarySelection, second: AssetLibrarySelection): boolean {
	return (
		first.mediaIds.size === second.mediaIds.size &&
		first.sequenceIds.size === second.sequenceIds.size &&
		[...first.mediaIds].every((id) => second.mediaIds.has(id)) &&
		[...first.sequenceIds].every((id) => second.sequenceIds.has(id))
	);
}

function keyboardTargetIsDisabled(event: KeyboardEvent): boolean {
	const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
	return Boolean(target instanceof HTMLElement && target.closest(TEXT_EDITING_SELECTOR));
}

function marqueeTargetIsDisabled(target: EventTarget | null): boolean {
	return !(target instanceof Element) || Boolean(target.closest(MARQUEE_DISABLED_SELECTOR));
}

function rectanglesIntersect(first: RectangleEdges, second: RectangleEdges): boolean {
	return !(
		first.right < second.left ||
		first.left > second.right ||
		first.bottom < second.top ||
		first.top > second.bottom
	);
}

function clampedPoint(event: PointerGestureEvent, bounds: DOMRect): Point {
	return {
		x: Math.max(bounds.left, Math.min(bounds.right, event.clientX)),
		y: Math.max(bounds.top, Math.min(bounds.bottom, event.clientY))
	};
}

function resolveAssetRows(surface: HTMLElement): ResolvedAssetRow[] {
	return [...surface.querySelectorAll<HTMLElement>(ASSET_ROW_SELECTOR)].map((element) => ({
		rectangle: element.getBoundingClientRect(),
		mediaId: element.dataset.assetMediaId,
		sequenceId: element.dataset.assetSequenceId
	}));
}

function selectedRows(
	rows: readonly ResolvedAssetRow[],
	rectangle: RectangleEdges
): AssetLibrarySelection {
	const mediaIds = new Set<string>();
	const sequenceIds = new Set<string>();
	for (const row of rows) {
		if (!rectanglesIntersect(rectangle, row.rectangle)) continue;
		if (row.mediaId) mediaIds.add(row.mediaId);
		if (row.sequenceId) sequenceIds.add(row.sequenceId);
	}
	return { mediaIds, sequenceIds };
}

export function createAssetLibrarySelectionController(
	options: AssetLibrarySelectionControllerOptions
): AssetLibrarySelectionController {
	let surface: HTMLElement | null = null;
	let scopeActive = false;
	let pointerGestures: PointerGestureSessionHost | null = null;
	let marquee: ActiveMarquee | null = null;
	let overlay: HTMLElement | null = null;

	function hideMarquee(): void {
		if (overlay) overlay.hidden = true;
		options.onMarqueeSelectionChange(null);
	}

	function finishMarquee(commit: boolean): void {
		const finished = marquee;
		marquee = null;
		hideMarquee();
		if (!commit || !finished) return;
		if (!finished.active) {
			if (!finished.additive) options.clearSelection();
			return;
		}
		options.setSelection(copySelection(finished.selection));
	}

	function updateMarquee(event: PointerGestureEvent, bounds: DOMRect): void {
		if (!marquee || !surface) return;
		const deltaX = event.clientX - marquee.startClientX;
		const deltaY = event.clientY - marquee.startClientY;
		if (
			!marquee.active &&
			Math.max(Math.abs(deltaX), Math.abs(deltaY)) < MARQUEE_ACTIVATION_DISTANCE_PX
		) {
			return;
		}
		event.preventDefault();
		const current = clampedPoint(event, bounds);
		const left = Math.min(marquee.startClientX, current.x);
		const right = Math.max(marquee.startClientX, current.x);
		const top = Math.min(marquee.startClientY, current.y);
		const bottom = Math.max(marquee.startClientY, current.y);
		if (!marquee.rows) marquee.rows = resolveAssetRows(surface);
		const hits = selectedRows(marquee.rows, { left, right, top, bottom });
		const wasActive = marquee.active;
		const previousSelection = marquee.selection;
		marquee.active = true;
		marquee.selection = marquee.additive ? unionSelection(marquee.base, hits) : hits;
		if (overlay) {
			overlay.hidden = false;
			overlay.style.left = `${left - bounds.left + surface.scrollLeft}px`;
			overlay.style.top = `${top - bounds.top + surface.scrollTop}px`;
			overlay.style.width = `${right - left}px`;
			overlay.style.height = `${bottom - top}px`;
		}
		if (!wasActive || !selectionsEqual(previousSelection, marquee.selection)) {
			options.onMarqueeSelectionChange(copySelection(marquee.selection));
		}
	}

	function startMarquee(event: PointerEvent): void {
		if (event.button !== 0 || marqueeTargetIsDisabled(event.target)) return;
		if (!surface) return;
		const bounds = surface.getBoundingClientRect();
		const start = clampedPoint(event, bounds);
		const additive = event.metaKey || event.ctrlKey;
		const base = copySelection(options.getSelection());
		pointerGestures?.cancel('superseded');
		marquee = {
			startClientX: start.x,
			startClientY: start.y,
			active: false,
			additive,
			base,
			selection: additive ? copySelection(base) : { mediaIds: new Set(), sequenceIds: new Set() },
			rows: null
		};
		pointerGestures?.start({
			pointerId: event.pointerId,
			target: surface,
			onMove: (move) => updateMarquee(move, bounds),
			onCommit: () => finishMarquee(true),
			onCancel: () => finishMarquee(false)
		});
	}

	function interactionBlocked(event: KeyboardEvent): boolean {
		return (
			keyboardTargetIsDisabled(event) ||
			options.interactionBlocked() ||
			Boolean(document.querySelector(OPEN_MENU_SELECTOR))
		);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!scopeActive) return;
		if (marquee && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			pointerGestures?.cancel('escape');
			return;
		}
		if (interactionBlocked(event)) return;
		const selection = options.getSelection();
		if (event.key === 'Escape' && selectionSize(selection) > 0) {
			event.preventDefault();
			event.stopPropagation();
			options.clearSelection();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
			const visible = options.getVisibleSelection();
			if (selectionSize(visible) === 0) return;
			event.preventDefault();
			event.stopPropagation();
			options.setSelection(visible);
			return;
		}
		if (event.key !== 'Delete' || selectionSize(selection) === 0) return;
		event.preventDefault();
		event.stopPropagation();
		options.requestDelete();
	}

	return {
		focus() {
			surface?.focus({ preventScroll: true });
		},
		connect(node) {
			surface = node;
			overlay = node.querySelector<HTMLElement>('[data-asset-marquee]');
			if (overlay) overlay.hidden = true;
			pointerGestures = createBrowserPointerGestureSessionHost();
			const updatePointerScope = (event: PointerEvent) => {
				scopeActive = event.target instanceof Node && node.contains(event.target);
			};
			const updateFocusScope = (event: FocusEvent) => {
				scopeActive = event.target instanceof Node && node.contains(event.target);
			};
			node.addEventListener('pointerdown', startMarquee);
			document.addEventListener('pointerdown', updatePointerScope, true);
			document.addEventListener('focusin', updateFocusScope, true);
			document.addEventListener('keydown', handleKeydown);
			return {
				destroy() {
					node.removeEventListener('pointerdown', startMarquee);
					document.removeEventListener('pointerdown', updatePointerScope, true);
					document.removeEventListener('focusin', updateFocusScope, true);
					document.removeEventListener('keydown', handleKeydown);
					pointerGestures?.destroy();
					pointerGestures = null;
					marquee = null;
					hideMarquee();
					overlay = null;
					if (surface === node) surface = null;
				}
			};
		}
	};
}
