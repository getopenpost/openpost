import type { components } from '$lib/api/types';

export type ThemeReference = components['schemas']['ThemeReference'];

export const WORKSHOP_REFERENCE: ThemeReference = {
	kind: 'built_in',
	id: 'workshop',
	version: 1
};

export function builtInThemeReference(id: string, version = 1): ThemeReference {
	if (!Number.isInteger(version) || version < 1) {
		throw new Error('Built-in theme version must be a positive integer');
	}
	return { kind: 'built_in', id, version };
}

export function builtInManifestReference(id: string, revision: string): ThemeReference {
	const match = /^builtin-v([1-9]\d*)$/.exec(revision);
	if (!match) throw new Error(`Built-in theme ${id} has an invalid revision identity`);
	return builtInThemeReference(id, Number(match[1]));
}

export function themeReferenceKey(reference: ThemeReference): string {
	return `${reference.kind}:${reference.id}:${reference.version}`;
}

export function sameThemeReference(
	left: ThemeReference | undefined,
	right: ThemeReference | undefined
): boolean {
	if (!left || !right) return left === right;
	return left.kind === right.kind && left.id === right.id && left.version === right.version;
}

export function sameThemeFamily(
	left: ThemeReference | undefined,
	right: ThemeReference | undefined
): boolean {
	if (!left || !right) return left === right;
	return left.kind === right.kind && left.id === right.id;
}
