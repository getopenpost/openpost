export interface QueryAuthorizationBoundary {
	captureIdentity: () => unknown;
	settleUnauthorized: (identity: unknown) => void;
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

export function settleQueryUnauthorized(identity: unknown) {
	boundary?.settleUnauthorized(identity);
}
