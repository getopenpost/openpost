import { describe, it, expect } from 'vitest';
import { m } from '$lib/paraglide/messages';
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
		{
			command: `curl https://example.com -H 'Authorization: Bearer private-token'`,
			message: m.workflows_curl_secret()
		},
		{
			command: `curl https://example.com -H 'X-API-Key: private-token'`,
			message: m.workflows_curl_secret()
		},
		{
			command: `curl https://example.com --data @/etc/passwd`,
			message: m.workflows_curl_unsupported({ flag: '@file' })
		},
		{
			command: `curl https://example.com ; echo unsafe`,
			message: m.workflows_curl_invalid()
		},
		{
			command: `curl https://example.com --output /tmp/result`,
			message: m.workflows_curl_unsupported({ flag: '--output' })
		},
		{
			command: `curl https://example.com -d $SECRET`,
			message: m.workflows_curl_invalid()
		},
		{
			command: `curl https://user:secret@example.com`,
			message: m.workflows_curl_invalid()
		}
	])('rejects unsafe or unsupported imports: $command', ({ command, message }) => {
		// A generic throw could come from an unrelated guard, so each row names
		// the localized message it must reach. Ordinary header, body, and URL
		// controls stay in the two declarations above.
		expect(() => importCurl(command)).toThrow(message);
	});
});
