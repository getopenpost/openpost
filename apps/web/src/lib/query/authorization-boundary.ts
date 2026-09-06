export interface QueryAuthorizationIdentity {
	userID: string;
	epoch: number;
}

export interface QueryAuthorizationBoundary {
	captureIdentity: () => QueryAuthorizationIdentity | undefined;
	isIdentityCurrent?: (identity: QueryAuthorizationIdentity | undefined) => boolean;
	settleUnauthorized: (identity: QueryAuthorizationIdentity | undefined) => void;
}

export interface QueryMutationSession {
	readonly authorizationIdentity: QueryAuthorizationIdentity | undefined;
	readonly boundaryRevision: number;
}

let boundary: QueryAuthorizationBoundary | undefined;
let boundaryRevision = 0;

export function registerQueryAuthorizationBoundary(
	nextBoundary: QueryAuthorizationBoundary | undefined
) {
	const previousBoundary = boundary;
	boundary = nextBoundary;
	boundaryRevision += 1;
	return () => {
		if (boundary !== nextBoundary) return;
		boundary = previousBoundary;
		boundaryRevision += 1;
	};
}

export function captureQueryAuthorizationIdentity() {
	return boundary?.captureIdentity();
}

export function settleQueryUnauthorized(identity: QueryAuthorizationIdentity | undefined) {
	boundary?.settleUnauthorized(identity);
}

export function captureQueryMutationSession(): QueryMutationSession {
	return {
		authorizationIdentity: boundary?.captureIdentity(),
		boundaryRevision
	};
}

export function queryMutationSessionIsCurrent(session: QueryMutationSession): boolean {
	if (session.boundaryRevision !== boundaryRevision) return false;
	if (!boundary) return session.authorizationIdentity === undefined;
	return boundary.isIdentityCurrent?.(session.authorizationIdentity) ?? false;
}

export function settleQueryMutationSession(
	session: QueryMutationSession,
	response: Pick<Response, 'status'>
): boolean {
	if (response.status === 401) settleQueryUnauthorized(session.authorizationIdentity);
	return queryMutationSessionIsCurrent(session);
}
