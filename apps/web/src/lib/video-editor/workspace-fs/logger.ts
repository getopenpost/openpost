/**
 * Minimal logger for the video editor storage layer. Deliberately quiet in
 * production: debug lines are dropped, warnings and errors always surface.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const DEBUG = import.meta.env.DEV;

export function createLogger(scope: string) {
	function emit(level: Level, message: string, ...rest: unknown[]): void {
		if (level === 'debug' && !DEBUG) return;
		const prefix = `[video-editor:${scope}]`;
		if (level === 'error') console.error(prefix, message, ...rest);
		else if (level === 'warn') console.warn(prefix, message, ...rest);
		else console.info(prefix, message, ...rest);
	}
	return {
		debug: (message: string, ...rest: unknown[]) => emit('debug', message, ...rest),
		info: (message: string, ...rest: unknown[]) => emit('info', message, ...rest),
		warn: (message: string, ...rest: unknown[]) => emit('warn', message, ...rest),
		error: (message: string, ...rest: unknown[]) => emit('error', message, ...rest)
	};
}
