const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const NO_SPACE_BEFORE = /^[\p{P}\p{S}]/u;
const NO_SPACE_AFTER = /[\p{Ps}\p{Pi}]$/u;

function needsSeparator(previous: string, next: string): boolean {
	const left = Array.from(previous.trim()).at(-1) ?? '';
	const right = Array.from(next.trim())[0] ?? '';
	if (!left || !right || CJK.test(left) || CJK.test(right)) return false;
	return !NO_SPACE_AFTER.test(left) && !NO_SPACE_BEFORE.test(right);
}

export function joinTranscriptWords(words: readonly string[]): string {
	const normalized = words.map((word) => word.trim()).filter(Boolean);
	return normalized.reduce(
		(text, word, index) =>
			index === 0
				? word
				: `${text}${needsSeparator(normalized[index - 1] ?? '', word) ? ' ' : ''}${word}`,
		''
	);
}
