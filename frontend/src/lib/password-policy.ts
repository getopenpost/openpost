export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_CHARACTERS = 1024;

// OpenAPI string lengths and the Go handlers count Unicode code points. Array.from
// applies the same rule, unlike JavaScript's UTF-16 string length.
export function passwordCharacterCount(password: string) {
	return Array.from(password).length;
}
