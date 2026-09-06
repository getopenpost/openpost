export type OrganizationAPITokenMode = 'scoped' | 'deny';

export function normalizeOrganizationAPITokenMode(value: string): OrganizationAPITokenMode {
	return value === 'scoped' || value === 'allow' ? 'scoped' : 'deny';
}
