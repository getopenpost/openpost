import type { DirectLinkableProperty, Vector2 } from '../project/types';

export type ExpressionValue = number | Vector2;

export interface PropertyExpressionContext {
	preValue: ExpressionValue;
	globalFrame: number;
	fps: number;
	resolveProperty: (itemId: string, property: DirectLinkableProperty) => ExpressionValue | null;
}

export interface PropertyExpressionResult {
	value: ExpressionValue;
	error?: string;
}

type TokenType = 'number' | 'identifier' | 'string' | 'punctuation' | 'eof';

interface Token {
	type: TokenType;
	value: string;
	position: number;
}

interface ScannedToken {
	token: Token;
	nextIndex: number;
}

type ScalarRequirement = (value: ExpressionValue, label: string) => number;
type BuiltinEvaluator = (
	arguments_: ExpressionValue[],
	requireScalar: ScalarRequirement
) => ExpressionValue;

const MAX_SOURCE_LENGTH = 2048;
const MAX_TOKENS = 512;
const MAX_DEPTH = 64;
const LINKABLE_PROPERTIES = new Set<DirectLinkableProperty>([
	'x',
	'y',
	'width',
	'height',
	'anchorX',
	'anchorY',
	'rotation',
	'opacity',
	'cornerRadius',
	'position',
	'scale',
	'anchor'
]);

export function isDirectLinkableProperty(property: string): property is DirectLinkableProperty {
	// SAFETY: Set.has only compares the string against the closed domain above.
	return LINKABLE_PROPERTIES.has(property as DirectLinkableProperty);
}

export function isVectorLinkableProperty(
	property: DirectLinkableProperty
): property is 'position' | 'scale' | 'anchor' {
	return property === 'position' || property === 'scale' || property === 'anchor';
}

export function areDirectLinkPropertiesCompatible(
	target: DirectLinkableProperty,
	source: DirectLinkableProperty
): boolean {
	return isVectorLinkableProperty(target) === isVectorLinkableProperty(source);
}

function isVector(value: ExpressionValue): value is Vector2 {
	return Object(value) === value;
}

function mapUnary(value: ExpressionValue, operation: (input: number) => number): ExpressionValue {
	return isVector(value) ? { x: operation(value.x), y: operation(value.y) } : operation(value);
}

function mapBinary(
	left: ExpressionValue,
	right: ExpressionValue,
	operation: (leftValue: number, rightValue: number) => number
): ExpressionValue {
	if (isVector(left) && isVector(right)) {
		return { x: operation(left.x, right.x), y: operation(left.y, right.y) };
	}
	if (isVector(left)) {
		// SAFETY: the vector branch above already excluded a vector right operand.
		const scalarRight = right as number;
		return { x: operation(left.x, scalarRight), y: operation(left.y, scalarRight) };
	}
	if (isVector(right)) {
		return { x: operation(left, right.x), y: operation(left, right.y) };
	}
	return operation(left, right);
}

function assertFinite(value: ExpressionValue): ExpressionValue {
	const values = isVector(value) ? [value.x, value.y] : [value];
	if (values.some((candidate) => !Number.isFinite(candidate))) {
		throw new Error('Expression produced a non-finite value');
	}
	return value;
}

function scanNumber(source: string, start: number): ScannedToken {
	let nextIndex = start;
	let dots = 0;
	while (nextIndex < source.length && /[0-9.]/.test(source[nextIndex]!)) {
		if (source[nextIndex] === '.') dots += 1;
		nextIndex += 1;
	}
	const value = source.slice(start, nextIndex);
	if (dots > 1 || value === '.' || !Number.isFinite(Number(value))) {
		throw new Error(`Invalid number at ${start + 1}`);
	}
	return { token: { type: 'number', value, position: start }, nextIndex };
}

function scanIdentifier(source: string, start: number): ScannedToken {
	let nextIndex = start + 1;
	while (nextIndex < source.length && /[A-Za-z0-9_]/.test(source[nextIndex]!)) nextIndex += 1;
	return {
		token: { type: 'identifier', value: source.slice(start, nextIndex), position: start },
		nextIndex
	};
}

function scanString(source: string, start: number): ScannedToken {
	const quote = source[start]!;
	let nextIndex = start + 1;
	let value = '';
	while (nextIndex < source.length && source[nextIndex] !== quote) {
		if (source[nextIndex] === '\\') nextIndex += 1;
		if (nextIndex >= source.length) throw new Error(`Unterminated string at ${start + 1}`);
		value += source[nextIndex]!;
		nextIndex += 1;
	}
	if (source[nextIndex] !== quote) throw new Error(`Unterminated string at ${start + 1}`);
	return { token: { type: 'string', value, position: start }, nextIndex: nextIndex + 1 };
}

function scanToken(source: string, index: number): ScannedToken {
	const character = source[index]!;
	if (/[0-9.]/.test(character)) return scanNumber(source, index);
	if (/[A-Za-z_]/.test(character)) return scanIdentifier(source, index);
	if (character === '"' || character === "'") return scanString(source, index);
	if ('+-*/(),[]'.includes(character)) {
		return {
			token: { type: 'punctuation', value: character, position: index },
			nextIndex: index + 1
		};
	}
	throw new Error(`Unexpected character "${character}" at ${index + 1}`);
}

function tokenize(source: string): Token[] {
	if (source.length > MAX_SOURCE_LENGTH) throw new Error('Expression is too long');
	const tokens: Token[] = [];
	let index = 0;
	while (index < source.length) {
		if (/\s/.test(source[index]!)) {
			index += 1;
			continue;
		}
		const scanned = scanToken(source, index);
		tokens.push(scanned.token);
		index = scanned.nextIndex;
		if (tokens.length > MAX_TOKENS) throw new Error('Expression has too many tokens');
	}
	tokens.push({ type: 'eof', value: '', position: source.length });
	return tokens;
}

function evaluateUnaryCall(
	name: 'abs' | 'sin' | 'cos',
	arguments_: ExpressionValue[]
): ExpressionValue {
	if (arguments_.length !== 1) throw new Error(`${name} expects 1 argument`);
	const operations = { abs: Math.abs, sin: Math.sin, cos: Math.cos };
	return mapUnary(arguments_[0]!, operations[name]);
}

function evaluateMinMaxCall(name: 'min' | 'max', arguments_: ExpressionValue[]): ExpressionValue {
	if (arguments_.length < 2) throw new Error(`${name} expects at least 2 arguments`);
	const operation = name === 'min' ? Math.min : Math.max;
	return arguments_
		.slice(1)
		.reduce((result, value) => mapBinary(result, value, operation), arguments_[0]!);
}

function evaluateClampCall(arguments_: ExpressionValue[]): ExpressionValue {
	if (arguments_.length !== 3) throw new Error('clamp expects 3 arguments');
	return mapBinary(mapBinary(arguments_[0]!, arguments_[1]!, Math.max), arguments_[2]!, Math.min);
}

function evaluateLerpCall(
	arguments_: ExpressionValue[],
	requireScalar: ScalarRequirement
): ExpressionValue {
	if (arguments_.length !== 3) throw new Error('lerp expects 3 arguments');
	const amount = requireScalar(arguments_[2]!, 'lerp amount');
	return mapBinary(arguments_[0]!, arguments_[1]!, (from, to) => from + (to - from) * amount);
}

const BUILTIN_EVALUATORS: ReadonlyMap<string, BuiltinEvaluator> = new Map([
	['abs', (arguments_: ExpressionValue[]) => evaluateUnaryCall('abs', arguments_)],
	['sin', (arguments_: ExpressionValue[]) => evaluateUnaryCall('sin', arguments_)],
	['cos', (arguments_: ExpressionValue[]) => evaluateUnaryCall('cos', arguments_)],
	['min', (arguments_: ExpressionValue[]) => evaluateMinMaxCall('min', arguments_)],
	['max', (arguments_: ExpressionValue[]) => evaluateMinMaxCall('max', arguments_)],
	['clamp', evaluateClampCall],
	['lerp', evaluateLerpCall]
]);

class Parser {
	private index = 0;
	private depth = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly context: PropertyExpressionContext
	) {}

	parse(): ExpressionValue {
		const value = this.parseAdditive();
		if (this.current().type !== 'eof') {
			throw new Error(`Unexpected token at ${this.current().position + 1}`);
		}
		return assertFinite(value);
	}

	private current(): Token {
		return this.tokens[this.index]!;
	}
	private consume(value?: string): Token {
		const token = this.current();
		if (value !== undefined && token.value !== value) {
			throw new Error(`Expected "${value}" at ${token.position + 1}`);
		}
		this.index += 1;
		return token;
	}

	private withDepth<T>(callback: () => T): T {
		this.depth += 1;
		if (this.depth > MAX_DEPTH) throw new Error('Expression is too deeply nested');
		try {
			return callback();
		} finally {
			this.depth -= 1;
		}
	}

	private parseAdditive(): ExpressionValue {
		let value = this.parseMultiplicative();
		while (this.current().value === '+' || this.current().value === '-') {
			const operator = this.consume().value;
			const right = this.parseMultiplicative();
			value = mapBinary(value, right, operator === '+' ? (a, b) => a + b : (a, b) => a - b);
		}
		return value;
	}

	private parseMultiplicative(): ExpressionValue {
		let value = this.parseUnary();
		while (this.current().value === '*' || this.current().value === '/') {
			const operator = this.consume().value;
			const right = this.parseUnary();
			if (operator === '/' && (isVector(right) ? right.x === 0 || right.y === 0 : right === 0)) {
				throw new Error('Division by zero');
			}
			value = mapBinary(value, right, operator === '*' ? (a, b) => a * b : (a, b) => a / b);
		}
		return value;
	}

	private parseUnary(): ExpressionValue {
		if (this.current().value === '+') {
			this.consume('+');
			return this.parseUnary();
		}
		if (this.current().value === '-') {
			this.consume('-');
			return mapUnary(this.parseUnary(), (value) => -value);
		}
		return this.parsePrimary();
	}

	private parsePrimary(): ExpressionValue {
		return this.withDepth(() => this.parsePrimaryValue());
	}
	private parsePrimaryValue(): ExpressionValue {
		const token = this.current();
		if (token.type === 'number') return Number(this.consume().value);
		if (token.value === '(') return this.parseGroupedValue();
		if (token.value === '[') return this.parseVectorValue();
		if (token.type === 'identifier') return this.parseIdentifierValue();
		throw new Error(`Expected a value at ${token.position + 1}`);
	}

	private parseGroupedValue(): ExpressionValue {
		this.consume('(');
		const value = this.parseAdditive();
		this.consume(')');
		return value;
	}

	private parseVectorValue(): Vector2 {
		this.consume('[');
		const x = this.requireScalar(this.parseAdditive(), 'Vector X');
		this.consume(',');
		const y = this.requireScalar(this.parseAdditive(), 'Vector Y');
		this.consume(']');
		return { x, y };
	}

	private parseIdentifierValue(): ExpressionValue {
		const identifier = this.consume().value;
		if (identifier === 'value' || identifier === 'preValue') return this.context.preValue;
		if (identifier === 'frame') return this.context.globalFrame;
		if (identifier === 'time') return this.context.globalFrame / Math.max(1, this.context.fps);
		if (this.current().value !== '(') throw new Error(`Unknown identifier "${identifier}"`);
		return this.parseCall(identifier);
	}

	private parseCall(name: string): ExpressionValue {
		this.consume('(');
		if (name === 'prop') return this.parsePropertyReference();
		const arguments_ = this.parseCallArguments();
		this.consume(')');
		const evaluate = BUILTIN_EVALUATORS.get(name);
		if (!evaluate) throw new Error(`Unknown function "${name}"`);
		return evaluate(arguments_, (value, label) => this.requireScalar(value, label));
	}

	private parseCallArguments(): ExpressionValue[] {
		const arguments_: ExpressionValue[] = [];
		if (this.current().value === ')') return arguments_;
		while (true) {
			arguments_.push(this.parseAdditive());
			if (this.current().value !== ',') return arguments_;
			this.consume(',');
		}
	}

	private parsePropertyReference(): ExpressionValue {
		const itemId = this.consumeString('Layer ID');
		this.consume(',');
		const propertyName = this.consumeString('Property');
		this.consume(')');
		if (!isDirectLinkableProperty(propertyName))
			throw new Error(`Unknown property "${propertyName}"`);
		const value = this.context.resolveProperty(itemId, propertyName);
		if (value === null) throw new Error('Property reference is unavailable');
		return value;
	}

	private consumeString(label: string): string {
		const token = this.current();
		if (token.type !== 'string') throw new Error(`${label} must be a quoted string`);
		this.consume();
		return token.value;
	}

	private requireScalar(value: ExpressionValue, label: string): number {
		if (isVector(value)) throw new Error(`${label} must be a scalar`);
		return value;
	}
}

export function isExpressionValueCompatible(
	property: DirectLinkableProperty,
	value: ExpressionValue
): boolean {
	return isVectorLinkableProperty(property) === isVector(value);
}

export function evaluatePropertyExpression(
	source: string,
	context: PropertyExpressionContext
): PropertyExpressionResult {
	try {
		return { value: new Parser(tokenize(source), context).parse() };
	} catch (error) {
		return {
			value: context.preValue,
			error: error instanceof Error ? error.message : 'Expression failed'
		};
	}
}
