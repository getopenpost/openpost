import type {
	ItemKeyframes,
	KeyframeProperty,
	ShapePathVertex,
	TimelineItem
} from '../../project/types';
import { resolvePreExpressionItemAt } from '../animated-properties';
import { execute } from '../commands/command-store.svelte';
import {
	changedPathVertexValues,
	clonePathVertices,
	hasPathVertexKeyframes,
	isPathVertexKeyframeProperty,
	parsePathVertexKeyframeProperty,
	pathVertexKeyframeProperties,
	pathVertexPropertyValue
} from '../path-vertex-keyframes';
import { keyframeSelectionStore } from '../stores/keyframe-selection-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { setAnimatedProperties } from './keyframes';

export type PathGeometryCommitResult = 'committed' | 'unchanged' | 'topology' | 'frame';

export function keyPathVerticesAtFrame(
	itemId: string,
	absoluteFrame: number,
	vertexIndices: readonly number[] | 'all'
): boolean {
	const item = timelineStore.itemById.get(itemId);
	if (!isPathItem(item)) return false;
	const resolved = resolvePreExpressionItemAt(item, absoluteFrame);
	const vertices = resolved.pathVertices ?? item.pathVertices ?? [];
	const selected =
		vertexIndices === 'all' ? new Set(vertices.map((_, index) => index)) : new Set(vertexIndices);
	const properties = pathVertexKeyframeProperties(vertices).filter((property) => {
		const parsed = parsePathVertexKeyframeProperty(property);
		return parsed ? selected.has(parsed.vertexIndex) : false;
	});
	if (properties.length === 0) return false;
	const values: Partial<Record<KeyframeProperty, number>> = {};
	for (const property of properties) {
		values[property] = pathVertexPropertyValue(vertices, property);
	}
	const keyed = new Set<KeyframeProperty>(properties);
	return setAnimatedProperties(itemId, absoluteFrame, values, (property) => keyed.has(property));
}

export function commitPathGeometryAtFrame(
	itemId: string,
	absoluteFrame: number,
	nextVertices: readonly ShapePathVertex[]
): PathGeometryCommitResult {
	const item = timelineStore.itemById.get(itemId);
	if (!isPathItem(item)) return 'topology';
	const currentVertices =
		resolvePreExpressionItemAt(item, absoluteFrame).pathVertices ?? item.pathVertices ?? [];
	const pathIsAnimated = hasPathVertexKeyframes(item.keyframes);
	if (pathIsAnimated && currentVertices.length !== nextVertices.length) return 'topology';
	const changed = changedPathVertexValues(currentVertices, nextVertices);
	if (!pathIsAnimated) {
		const tangentModesMatch =
			currentVertices.length === nextVertices.length &&
			currentVertices.every(
				(vertex, index) => vertex.tangentMode === nextVertices[index]?.tangentMode
			);
		if (changed.length === 0 && tangentModesMatch) return 'unchanged';
		execute('UPDATE_PATH_GEOMETRY', () => {
			timelineStore._updateItems([
				{ id: itemId, patch: { pathVertices: clonePathVertices(nextVertices) } }
			]);
		});
		return 'committed';
	}
	if (changed.length === 0) return 'unchanged';
	const values: Partial<Record<KeyframeProperty, number>> = {};
	for (const change of changed) values[change.property] = change.value;
	return setAnimatedProperties(itemId, absoluteFrame, values, () => true) ? 'committed' : 'frame';
}

export function clearPathVertexKeyframes(itemId: string): boolean {
	return execute('CLEAR_PATH_VERTEX_KEYFRAMES', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item || !hasPathVertexKeyframes(item.keyframes)) return false;
		const keyframes: ItemKeyframes = { ...item.keyframes };
		for (const property of Object.keys(keyframes)) {
			if (isPathVertexKeyframeProperty(property)) {
				delete keyframes[property];
			}
		}
		timelineStore._updateItems([
			{
				id: itemId,
				patch: { keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined }
			}
		]);
		if (keyframeSelectionStore.itemId === itemId) keyframeSelectionStore.clear();
		return true;
	});
}

function isPathItem(item: TimelineItem | undefined): item is TimelineItem {
	return item?.type === 'shape' && item.shapeType === 'path';
}
