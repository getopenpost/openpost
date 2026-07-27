export class SerializedSaveQueue<T> {
	private current: Promise<T>;

	constructor(private readonly fallback: () => T) {
		this.current = Promise.resolve(fallback());
	}

	run(task: () => Promise<T>): Promise<T> {
		const next = this.current.catch(() => this.fallback()).then(task);
		this.current = next;
		return next;
	}

	flush(): Promise<T> {
		return this.current;
	}
}
