import type {
	DirectLinkableProperty,
	DirectPropertyLink,
	PropertyExpression,
	TimelineItem
} from '../../project/types';
import { areDirectLinkPropertiesCompatible } from '../property-expression';
import { doDirectLinkTargetsConflict } from '../property-runtime';
import { wouldCreateTransformParentCycle } from '../transform-parenting';
import { execute } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';

export { clonePropertyRuntime } from '../property-runtime-clone';

export type SetPropertyLinkResult =
	| { ok: true }
	| { ok: false; reason: 'missing-item' | 'missing-source' | 'incompatible' | 'cycle' };

export function setDirectPropertyLink(
	itemId: string,
	link: DirectPropertyLink
): SetPropertyLinkResult {
	const item = timelineStore.itemById.get(itemId);
	if (!item) return { ok: false, reason: 'missing-item' };
	if (!timelineStore.itemById.has(link.sourceItemId))
		return { ok: false, reason: 'missing-source' };
	if (!areDirectLinkPropertiesCompatible(link.targetProperty, link.sourceProperty)) {
		return { ok: false, reason: 'incompatible' };
	}
	if (link.enabled && wouldCreateDirectPropertyLinkCycle(itemId, link)) {
		return { ok: false, reason: 'cycle' };
	}
	if (
		link.enabled &&
		itemId !== link.sourceItemId &&
		wouldCreateTransformParentCycle(itemId, link.sourceItemId, (candidateId) =>
			timelineStore.itemById.get(candidateId)
		)
	) {
		return { ok: false, reason: 'cycle' };
	}
	execute(
		'SET_DIRECT_PROPERTY_LINK',
		() => {
			const propertyLinks = [
				...(item.propertyLinks ?? []).filter(
					(candidate) => !doDirectLinkTargetsConflict(candidate.targetProperty, link.targetProperty)
				),
				{ ...link }
			];
			timelineStore._updateItems([{ id: itemId, patch: { propertyLinks } }]);
		},
		{ itemId, property: link.targetProperty, sourceItemId: link.sourceItemId }
	);
	return { ok: true };
}

export function removeDirectPropertyLink(
	itemId: string,
	property: DirectLinkableProperty
): boolean {
	const item = timelineStore.itemById.get(itemId);
	if (!item?.propertyLinks?.some((link) => link.targetProperty === property)) return false;
	execute(
		'REMOVE_DIRECT_PROPERTY_LINK',
		() => {
			const propertyLinks = item.propertyLinks!.filter((link) => link.targetProperty !== property);
			timelineStore._updateItems([
				{
					id: itemId,
					patch: { propertyLinks: propertyLinks.length > 0 ? propertyLinks : undefined }
				}
			]);
		},
		{ itemId, property }
	);
	return true;
}

export function setPropertyExpression(itemId: string, expression: PropertyExpression): boolean {
	const item = timelineStore.itemById.get(itemId);
	if (!item) return false;
	execute(
		'SET_PROPERTY_EXPRESSION',
		() => {
			const expressions = [
				...(item.expressions ?? []).filter(
					(candidate) => candidate.targetProperty !== expression.targetProperty
				),
				{ ...expression }
			];
			timelineStore._updateItems([{ id: itemId, patch: { expressions } }]);
		},
		{ itemId, property: expression.targetProperty, enabled: expression.enabled }
	);
	return true;
}

export function removePropertyExpression(
	itemId: string,
	property: DirectLinkableProperty
): boolean {
	const item = timelineStore.itemById.get(itemId);
	if (!item?.expressions?.some((expression) => expression.targetProperty === property))
		return false;
	execute(
		'REMOVE_PROPERTY_EXPRESSION',
		() => {
			const expressions = item.expressions!.filter(
				(expression) => expression.targetProperty !== property
			);
			timelineStore._updateItems([
				{
					id: itemId,
					patch: { expressions: expressions.length > 0 ? expressions : undefined }
				}
			]);
		},
		{ itemId, property }
	);
	return true;
}

export function wouldCreateDirectPropertyLinkCycle(
	itemId: string,
	link: Pick<DirectPropertyLink, 'targetProperty' | 'sourceItemId' | 'sourceProperty'>
): boolean {
	const targetKey = `${itemId}:${link.targetProperty}`;
	let currentItemId = link.sourceItemId;
	let currentProperty = link.sourceProperty;
	const visited = new Set<string>();
	while (true) {
		const key = `${currentItemId}:${currentProperty}`;
		if (key === targetKey) return true;
		if (visited.has(key)) return false;
		visited.add(key);
		const item = timelineStore.itemById.get(currentItemId);
		const next = item?.propertyLinks?.find(
			(candidate) => candidate.targetProperty === currentProperty
		);
		if (
			!next?.enabled ||
			!areDirectLinkPropertiesCompatible(currentProperty, next.sourceProperty)
		) {
			return false;
		}
		currentItemId = next.sourceItemId;
		currentProperty = next.sourceProperty;
	}
}
