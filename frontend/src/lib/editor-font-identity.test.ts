import { describe, expect, it } from 'vitest';
import { editorFontAssetFamily } from './editor-font-identity';

describe('project font identity', () => {
	it('keeps different font assets distinct even when their display descriptors match', () => {
		expect(editorFontAssetFamily('Launch Sans', 'asset-a')).not.toBe(
			editorFontAssetFamily('Launch Sans', 'asset-b')
		);
		expect(editorFontAssetFamily('Launch Sans', 'asset-a')).toBe(
			editorFontAssetFamily('Launch Sans', 'asset-a')
		);
	});
});
