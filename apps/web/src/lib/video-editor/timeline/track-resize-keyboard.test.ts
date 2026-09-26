import { describe, expect, it } from 'vitest';
import {
	MAX_TRACK_HEIGHT,
	MIN_TRACK_HEIGHT,
	formatTrackHeightText,
	nextTrackHeightKeyboard
} from './track-resize';

describe('nextTrackHeightKeyboard', () => {
	it('shrinks and grows by one step with arrows, three steps with shift', () => {
		expect(nextTrackHeightKeyboard(96, 'ArrowUp', false)).toBe(92);
		expect(nextTrackHeightKeyboard(96, 'ArrowDown', false)).toBe(100);
		expect(nextTrackHeightKeyboard(96, 'ArrowUp', true)).toBe(84);
		expect(nextTrackHeightKeyboard(96, 'ArrowDown', true)).toBe(108);
	});

	it('moves by a large step with PageUp and PageDown in the arrow direction', () => {
		expect(nextTrackHeightKeyboard(96, 'PageUp', false)).toBe(72);
		expect(nextTrackHeightKeyboard(96, 'PageDown', false)).toBe(120);
	});

	it('jumps to the height bounds with Home and End', () => {
		expect(nextTrackHeightKeyboard(96, 'Home', false)).toBe(MIN_TRACK_HEIGHT);
		expect(nextTrackHeightKeyboard(96, 'End', false)).toBe(MAX_TRACK_HEIGHT);
	});

	it('returns null for unhandled keys so the caller skips side effects', () => {
		expect(nextTrackHeightKeyboard(96, 'Enter', false)).toBeNull();
		expect(nextTrackHeightKeyboard(96, 'a', false)).toBeNull();
	});
});

describe('formatTrackHeightText', () => {
	it('announces the height with a pixels unit instead of a bare number', () => {
		expect(formatTrackHeightText(96)).toBe('96 pixels');
		expect(formatTrackHeightText(72)).toBe('72 pixels');
	});

	it('rounds fractional heights to whole pixels', () => {
		expect(formatTrackHeightText(96.4)).toBe('96 pixels');
	});
});
