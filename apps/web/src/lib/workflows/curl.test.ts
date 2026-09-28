import { describe, it, expect } from 'vitest';
import { importCurl } from './curl';

describe('cURL request import', () => {
	it('preserves JSON bodies and request options without shell execution', () => {
		const inputs = importCurl(
			`curl 'https://example.com/v1/items' --json '{"title":"New release"}' -X PATCH --max-time 12 -H 'Accept-Language: en'`
		);
		expect(inputs.method.literal).toBe('PATCH');
		expect(inputs.body.literal).toBe('{"title":"New release"}');
		expect(inputs.headers.literal).toEqual({
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'Accept-Language': 'en'
		});
		expect(inputs.timeout.literal).toBe(12);
	});
	it('keeps encoded form data in the body unless GET is requested', () => {
		const command = `curl https://example.com --data-urlencode 'title=release & notes'`;
		expect(importCurl(command).body.literal).toBe('title=release%20%26%20notes');
		const get = importCurl(command + ' -G');
		expect(get.method.literal).toBe('GET');
		expect(get.body.literal).toBe('');
		expect(get.query.literal).toEqual({ title: 'release & notes' });
	});
	it.each([
		...['Authorization: Bearer private-token', 'X-API-Key: private-token'].map(
			(header) => `curl https://example.com -H '${header}'`
		),
		`curl https://example.com --data @/etc/passwd`,
		`curl https://example.com ; echo unsafe`,
		`curl https://example.com --output /tmp/result`,
		`curl https://example.com -d $SECRET`,
		`curl https://user:secret@example.com`
	])('rejects unsafe or unsupported imports: %s', (command) => {
		expect(() => importCurl(command)).toThrow();
	});
});
