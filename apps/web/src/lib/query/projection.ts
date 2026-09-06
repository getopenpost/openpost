export class QueryProjectionTracker {
	#data: unknown;
	#scope = '';

	shouldProject<T>(data: T | undefined, scope: string): data is T {
		if (data === undefined) return false;
		if (data === this.#data && scope === this.#scope) return false;
		this.#data = data;
		this.#scope = scope;
		return true;
	}
}
