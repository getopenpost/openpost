export async function createHash(file: File): Promise<string> {
	const size = file.size;
	const chunkSize = 65536;
	const parts: Blob[] = [];
	// Head
	parts.push(file.slice(0, Math.min(chunkSize, size)));
	// Middle
	if (size > chunkSize * 2) {
		const midStart = Math.floor(size / 2) - Math.floor(chunkSize / 2);
		parts.push(file.slice(midStart, midStart + chunkSize));
	}
	// Tail
	if (size > chunkSize) {
		parts.push(file.slice(Math.max(0, size - chunkSize), size));
	}
	// Size as well (to detect same-head/middle/tail but different size)
	const sizeBytes = new TextEncoder().encode(String(size));
	const blobs = [...parts, new Blob([sizeBytes])];
	const combined = new Blob(blobs);
	const buf = await combined.arrayBuffer();
	const hash = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
