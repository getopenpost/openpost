const MAX_CHARS_PER_SEGMENT = 220;

function normalize(text: string): string {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function sentenceUnits(text: string): string[] {
	const units: string[] = [];
	for (const paragraph of normalize(text).split(/\n{2,}/)) {
		const sentences = paragraph.match(/[^.!?;:,\n]+(?:[.!?;:,]+|$)/g) ?? [paragraph];
		for (const sentence of sentences) {
			const trimmed = sentence.trim();
			if (trimmed) units.push(trimmed);
		}
	}
	return units;
}

function splitLongUnit(text: string, maxChars: number): string[] {
	if (text.length <= maxChars) return [text];
	const chunks: string[] = [];
	let current = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= maxChars || !current) current = candidate;
		else {
			chunks.push(current);
			current = word;
		}
	}
	if (current) chunks.push(current);
	return chunks;
}

export function chunkTextForKokoro(text: string, maxChars = MAX_CHARS_PER_SEGMENT): string[] {
	const segments: string[] = [];
	let current = '';
	const flush = (): void => {
		if (current.trim()) segments.push(current.trim());
		current = '';
	};
	for (const unit of sentenceUnits(text)) {
		if (unit.length > maxChars) {
			flush();
			segments.push(
				...splitLongUnit(unit, maxChars)
					.map((part) => part.trim())
					.filter(Boolean)
			);
			continue;
		}
		const candidate = current ? `${current} ${unit}` : unit;
		if (candidate.length <= maxChars) current = candidate;
		else {
			flush();
			current = unit;
		}
	}
	flush();
	return segments.length > 0 ? segments : [normalize(text)];
}
