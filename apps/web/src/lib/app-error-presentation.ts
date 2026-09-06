import { resolveAppErrorState, type AppErrorKind, type AppErrorState } from '$lib/app-error-state';
import { m } from '$lib/paraglide/messages';

export type AppErrorIcon = 'offline' | 'forbidden' | 'not-found' | 'request-error' | 'server-error';

export interface AppErrorPresentation {
	title: string;
	description: string;
	icon: AppErrorIcon;
}

export interface AppErrorProjection {
	recovery: AppErrorState;
	presentation: AppErrorPresentation;
}

const presentations = {
	offline: () => ({
		title: m.app_offline_title(),
		description: m.app_offline_description(),
		icon: 'offline'
	}),
	forbidden: () => ({
		title: m.app_forbidden_title(),
		description: m.app_forbidden_description(),
		icon: 'forbidden'
	}),
	'not-found': () => ({
		title: m.app_not_found_title(),
		description: m.app_not_found_description(),
		icon: 'not-found'
	}),
	'request-error': () => ({
		title: m.app_request_error_title(),
		description: m.app_request_error_description(),
		icon: 'request-error'
	}),
	'server-error': () => ({
		title: m.app_error_title(),
		description: m.app_error_description(),
		icon: 'server-error'
	})
} satisfies Record<AppErrorKind, () => AppErrorPresentation>;

export function resolveAppErrorPresentation(kind: AppErrorKind): AppErrorPresentation {
	return presentations[kind]();
}

export function resolveAppErrorProjection(status: number, online: boolean): AppErrorProjection {
	const recovery = resolveAppErrorState(status, online);
	return {
		recovery,
		presentation: resolveAppErrorPresentation(recovery.kind)
	};
}
