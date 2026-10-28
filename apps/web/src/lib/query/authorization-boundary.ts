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

/**
 * A 401 settles session state only when the server rejected the credential
 * itself. Action checks such as recent reauthentication answer 401 too, and
 * those must stay with the open form instead of signing the user out.
 */
export function isSessionUnauthorized(response: Pick<Response, 'status' | 'headers'>): boolean {
	return (
		response.status === 401 &&
		response.headers.get('WWW-Authenticate')?.includes('invalid_token') === true
	);
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
	response: Pick<Response, 'status' | 'headers'>
): boolean {
	if (isSessionUnauthorized(response)) settleQueryUnauthorized(session.authorizationIdentity);
	return queryMutationSessionIsCurrent(session);
}
