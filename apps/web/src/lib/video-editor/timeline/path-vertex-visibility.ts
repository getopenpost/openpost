import type { ItemKeyframes, KeyframeProperty } from '../project/types';
import {
	isPathVertexKeyframeProperty,
	parsePathVertexKeyframeProperty
} from './path-vertex-keyframes';

export function visiblePathVertexProperties(
	properties: readonly KeyframeProperty[],
	options: {
		itemKeyframes?: ItemKeyframes;
		selectedVertexIndices?: readonly number[];
		showAllVertices?: boolean;
		alwaysInclude?: KeyframeProperty | null;
	} = {}
): KeyframeProperty[] {
	if (options.showAllVertices) return [...properties];
	const pathProperties = properties.filter(isPathVertexKeyframeProperty);
	if (pathProperties.length === 0) return [...properties];

	const visible = new Set<KeyframeProperty>(
		Object.entries(options.itemKeyframes ?? {}).flatMap(([property, track]) =>
			isPathVertexKeyframeProperty(property) && (track?.frames.length ?? 0) > 0 ? [property] : []
		)
	);
	if (options.alwaysInclude && isPathVertexKeyframeProperty(options.alwaysInclude)) {
		visible.add(options.alwaysInclude);
	}
	const selected =
		(options.selectedVertexIndices?.length ?? 0) > 0
			? new Set(options.selectedVertexIndices)
			: visible.size > 0
				? new Set<number>()
				: new Set([0]);
	for (const property of pathProperties) {
		const parsed = parsePathVertexKeyframeProperty(property);
		if (parsed && selected.has(parsed.vertexIndex)) visible.add(property);
	}
	return properties.filter(
		(property) => !isPathVertexKeyframeProperty(property) || visible.has(property)
	);
}
