export interface PublicationOperation<Identity> {
	readonly identity: Identity;
	readonly lifecycleRevision: number;
	readonly workspaceId: string;
	readonly viewKey: string;
}

interface CurrentPublicationView<Identity> {
	readonly workspaceId: string;
	readonly viewKey: string;
	readonly isIdentityCurrent: (identity: Identity) => boolean;
}

export class PublicationOperationScope<Identity> {
	#lifecycleRevision = 0;

	capture(
		identity: Identity,
		workspaceId: string,
		viewKey: string
	): PublicationOperation<Identity> {
		return {
			identity,
			lifecycleRevision: this.#lifecycleRevision,
			workspaceId,
			viewKey
		};
	}

	destroy() {
		this.supersedeView();
	}

	supersedeView() {
		this.#lifecycleRevision += 1;
	}

	actorIsCurrent(
		operation: PublicationOperation<Identity>,
		isIdentityCurrent: (identity: Identity) => boolean
	) {
		return isIdentityCurrent(operation.identity);
	}

	viewIsCurrent(
		operation: PublicationOperation<Identity>,
		current: CurrentPublicationView<Identity>
	) {
		return (
			operation.lifecycleRevision === this.#lifecycleRevision &&
			operation.workspaceId === current.workspaceId &&
			operation.viewKey === current.viewKey &&
			current.isIdentityCurrent(operation.identity)
		);
	}
}
