export type AppErrorKind = 'offline' | 'forbidden' | 'not-found' | 'request-error' | 'server-error';

export interface AppErrorState {
	kind: AppErrorKind;
	canRetry: boolean;
	showDestinations: boolean;
	showDocumentation: boolean;
	showSupport: boolean;
}

export function resolveAppErrorState(status: number, online: boolean): AppErrorState {
	if (!online) {
		return {
			kind: 'offline',
			canRetry: true,
			showDestinations: false,
			showDocumentation: false,
			showSupport: false
		};
	}
	if (status === 403) {
		return {
			kind: 'forbidden',
			canRetry: false,
			showDestinations: true,
			showDocumentation: false,
			showSupport: true
		};
	}
	if (status === 404) {
		return {
			kind: 'not-found',
			canRetry: false,
			showDestinations: true,
			showDocumentation: true,
			showSupport: false
		};
	}
	if (status >= 500) {
		return {
			kind: 'server-error',
			canRetry: true,
			showDestinations: false,
			showDocumentation: false,
			showSupport: true
		};
	}
	return {
		kind: 'request-error',
		canRetry: [408, 409, 425, 429].includes(status),
		showDestinations: true,
		showDocumentation: false,
		showSupport: false
	};
}
