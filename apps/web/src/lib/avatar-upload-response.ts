type AvatarUploadJSONValue =
	| string
	| number
	| boolean
	| null
	| AvatarUploadJSONValue[]
	| { [key: string]: AvatarUploadJSONValue };

export interface AvatarUploadResponse {
	avatar_url?: string;
}

function responseFields(source: string): Map<string, AvatarUploadJSONValue> {
	const value: AvatarUploadJSONValue = JSON.parse(source);
	if (value === null || Array.isArray(value) || !(value instanceof Object)) return new Map();
	return new Map(Object.entries(value));
}

function responseString(value: AvatarUploadJSONValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

export function parseAvatarUploadResponse(source: string): AvatarUploadResponse {
	const avatarURL = responseString(responseFields(source).get('avatar_url'))?.trim();
	return avatarURL ? { avatar_url: avatarURL } : {};
}

export function parseAvatarUploadErrorDetail(source: string): string | undefined {
	const fields = responseFields(source);
	for (const key of ['detail', 'error', 'title']) {
		const value = responseString(fields.get(key))?.trim();
		if (value) return value;
	}
	return undefined;
}
