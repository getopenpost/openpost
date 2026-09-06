import type { TimelineItem, TransformParentBinding } from '../../project/types';
import { sequenceStore } from '../../sequences/sequence-store.svelte';
import {
	resolveAnimatedItemAt,
	resolveAnimatedItemLocalAt,
	resolvedTransformForItem,
	type AnimatedItemMotionContext
} from '../animated-properties';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	createTransformParentBinding,
	hasRedundantTransformParentLink,
	wouldCreateTransformParentCycle,
	type ResolvedTransform
} from '../transform-parenting';

export type SetTransformParentResult =
	| { ok: true }
	| {
			ok: false;
			reason:
				| 'missing-child'
				| 'missing-parent'
				| 'unsupported-child'
				| 'unsupported-parent'
				| 'self'
				| 'already-parented'
				| 'cycle'
				| 'duplicate-transform';
	  };

function canParticipate(item: TimelineItem): boolean {
	return item.type !== 'audio' && item.type !== 'adjustment';
}

function motionContext(): AnimatedItemMotionContext {
	return {
		fps: timelineStore.fps,
		frameWidth: sequenceStore.activeWidth,
		frameHeight: sequenceStore.activeHeight,
		items: timelineStore.items
	};
}

function resolvedTransform(item: TimelineItem): ResolvedTransform {
	return resolvedTransformForItem(item, sequenceStore.activeWidth, sequenceStore.activeHeight);
}

function parentBinding(child: TimelineItem, parent: TimelineItem): TransformParentBinding {
	const context = motionContext();
	const childLocal = resolvedTransform(
		resolveAnimatedItemLocalAt(child, timelineStore.currentFrame, context)
	);
	const childWorld = resolvedTransform(
		resolveAnimatedItemAt(child, timelineStore.currentFrame, context)
	);
	const parentWorld = resolvedTransform(
		resolveAnimatedItemAt(parent, timelineStore.currentFrame, context)
	);
	return createTransformParentBinding({
		childLocal,
		childWorld,
		parentItemId: parent.id,
		parentWorld
	});
}

export function setTransformParent(
	childItemId: string,
	parentItemId: string
): SetTransformParentResult {
	const child = timelineStore.itemById.get(childItemId);
	if (!child) return { ok: false, reason: 'missing-child' };
	const parent = timelineStore.itemById.get(parentItemId);
	if (!parent) return { ok: false, reason: 'missing-parent' };
	if (!canParticipate(child)) return { ok: false, reason: 'unsupported-child' };
	if (!canParticipate(parent)) return { ok: false, reason: 'unsupported-parent' };
	if (child.id === parent.id) return { ok: false, reason: 'self' };
	if (child.transformParent?.parentItemId === parent.id) {
		return { ok: false, reason: 'already-parented' };
	}
	if (
		wouldCreateTransformParentCycle(child.id, parent.id, (itemId) =>
			timelineStore.itemById.get(itemId)
		)
	) {
		return { ok: false, reason: 'cycle' };
	}
	if (
		hasRedundantTransformParentLink(child.id, parent.id, (itemId) =>
			timelineStore.itemById.get(itemId)
		)
	) {
		return { ok: false, reason: 'duplicate-transform' };
	}

	const transformParent = parentBinding(child, parent);
	execute(
		'SET_TRANSFORM_PARENT',
		() => timelineStore._updateItems([{ id: child.id, patch: { transformParent } }]),
		{ childItemId: child.id, parentItemId: parent.id }
	);
	return { ok: true };
}

export function detachTransformParent(childItemId: string): boolean {
	const child = timelineStore.itemById.get(childItemId);
	if (!child?.transformParent?.parentItemId) return false;
	const transformParent = detachedTransformParentBinding(child);
	if (!transformParent) return false;
	execute(
		'DETACH_TRANSFORM_PARENT',
		() => timelineStore._updateItems([{ id: child.id, patch: { transformParent } }]),
		{ childItemId: child.id }
	);
	return true;
}

export function detachedTransformParentBinding(
	child: TimelineItem
): TransformParentBinding | undefined {
	if (!child.transformParent) return undefined;
	const context = motionContext();
	const childLocal = resolvedTransform(
		resolveAnimatedItemLocalAt(child, timelineStore.currentFrame, context)
	);
	const childWorld = resolvedTransform(
		resolveAnimatedItemAt(child, timelineStore.currentFrame, context)
	);
	return createTransformParentBinding({ childLocal, childWorld });
}

/**
 * Freeze surviving children in world space before their parent leaves the
 * timeline. The caller owns the surrounding command so deletion and detach
 * undo together.
 */
export function detachTransformChildrenForRemoval(removedItemIds: readonly string[]): void {
	const removed = new Set(removedItemIds);
	const updates = timelineStore.items.flatMap((child) => {
		const parentItemId = child.transformParent?.parentItemId;
		if (!parentItemId || removed.has(child.id) || !removed.has(parentItemId)) return [];
		const transformParent = detachedTransformParentBinding(child);
		if (!transformParent) return [];
		return [
			{
				id: child.id,
				patch: { transformParent }
			}
		];
	});
	if (updates.length > 0) timelineStore._updateItems(updates);
}
