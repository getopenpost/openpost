interface PathVertexSelection {
	indices: number[];
	showAll: boolean;
}

let selections = $state(new Map<string, PathVertexSelection>());

function update(itemId: string, selection: PathVertexSelection): void {
	const next = new Map(selections);
	next.set(itemId, selection);
	selections = next;
}

export const pathVertexSelectionStore = {
	forItem(itemId: string): PathVertexSelection {
		return selections.get(itemId) ?? { indices: [], showAll: false };
	},
	select(itemId: string, indices: readonly number[]): void {
		const current = this.forItem(itemId);
		update(itemId, {
			...current,
			indices: [...new Set(indices.filter((index) => Number.isInteger(index) && index >= 0))]
		});
	},
	setShowAll(itemId: string, showAll: boolean): void {
		update(itemId, { ...this.forItem(itemId), showAll });
	},
	clear(itemId: string): void {
		const next = new Map(selections);
		next.delete(itemId);
		selections = next;
	},
	reset(): void {
		selections = new Map();
	}
};
