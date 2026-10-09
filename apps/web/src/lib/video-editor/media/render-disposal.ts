/** Coordinates renderer teardown with asynchronous frame work. */
export class RenderDisposalGate {
	private active = 0;
	private requested = false;
	private disposed = false;

	constructor(private readonly cleanup: () => void) {}

	enter(): void {
		if (this.requested) throw new Error('Cannot start work on a disposed renderer.');
		this.active += 1;
	}

	leave(): void {
		if (this.active > 0) this.active -= 1;
		if (this.requested && this.active === 0) this.finish();
	}

	dispose(): void {
		if (this.requested) return;
		this.requested = true;
		if (this.active === 0) this.finish();
	}

	private finish(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cleanup();
	}
}
