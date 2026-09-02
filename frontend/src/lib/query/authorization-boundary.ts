export interface QueryAuthorizationIdentity {
	userID: string;
	epoch: number;
}

export interface QueryAuthorizationBoundary {
	captureIdentity: () => QueryAuthorizationIdentity | undefined;
	settleUnauthorized: (identity: QueryAuthorizationIdentity | undefined) => void;
}

let boundary: QueryAuthorizationBoundary | undefined;

export function registerQueryAuthorizationBoundary(
	nextBoundary: QueryAuthorizationBoundary | undefined
) {
	const previousBoundary = boundary;
	boundary = nextBoundary;
	return () => {
		if (boundary === nextBoundary) boundary = previousBoundary;
	};
}

export function captureQueryAuthorizationIdentity() {
	return boundary?.captureIdentity();
}

export function settleQueryUnauthorized(identity: QueryAuthorizationIdentity | undefined) {
	boundary?.settleUnauthorized(identity);
}
