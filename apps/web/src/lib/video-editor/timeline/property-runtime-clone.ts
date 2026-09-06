import type { TimelineItem } from '../project/types';

export function clonePropertyRuntime(
	item: TimelineItem,
	duplicatedItemIdMap: ReadonlyMap<string, string>
): Pick<TimelineItem, 'propertyLinks' | 'expressions' | 'transformParent'> {
	return {
		...(item.transformParent && {
			transformParent: {
				...item.transformParent,
				parentItemId: item.transformParent.parentItemId
					? (duplicatedItemIdMap.get(item.transformParent.parentItemId) ??
						item.transformParent.parentItemId)
					: undefined,
				parentReference: item.transformParent.parentReference
					? { ...item.transformParent.parentReference }
					: undefined,
				childLocalReference: { ...item.transformParent.childLocalReference },
				childWorldReference: { ...item.transformParent.childWorldReference }
			}
		}),
		...(item.propertyLinks && {
			propertyLinks: item.propertyLinks.map((link) => ({
				...link,
				sourceItemId: duplicatedItemIdMap.get(link.sourceItemId) ?? link.sourceItemId
			}))
		}),
		...(item.expressions && {
			expressions: item.expressions.map((expression) => ({ ...expression }))
		})
	};
}
