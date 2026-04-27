/**
 * Shared JSON parsing utilities.
 *
 * Centralizes JSON extraction from markdown code blocks, balanced brace
 * scanning, and safe parsing — used across the engine, session manager,
 * and LLM response handling.
 */

/**
 * Extract JSON content from a markdown code block.
 * Returns the raw text inside the first ```json ... ``` or ``` ... ``` block,
 * or the original text if no code block is found.
 */
export function extractJsonFromMarkdown(text: string): string {
	const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
	return match ? match[1]! : text;
}

/**
 * Scan text for top-level balanced JSON objects using a brace stack.
 *
 * Non-greedy regex fails on nested objects (e.g. {"concepts":[{"id":"a"}]}),
 * so we explicitly track brace depth to find complete top-level objects.
 */
export function extractBalancedJsonObjects(text: string): string[] {
	const objects: string[] = [];
	const stack: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '{') {
			stack.push(i);
		} else if (text[i] === '}' && stack.length > 0) {
			const start = stack.pop()!;
			if (stack.length === 0) {
				objects.push(text.slice(start, i + 1));
			}
		}
	}
	return objects;
}

/**
 * Attempt to parse JSON from text, supporting markdown code blocks
 * and balanced brace extraction as fallbacks.
 *
 * Returns the first successfully parsed object, or null if none found.
 */
export function tryParseJson<T = Record<string, unknown>>(text: string): T | null {
	const targetText = extractJsonFromMarkdown(text);
	const candidates = extractBalancedJsonObjects(targetText);
	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate) as T;
		} catch {
			// Try next candidate
		}
	}
	return null;
}

/**
 * Check if text contains a syntactically valid JSON object.
 */
export function containsValidJson(text: string): boolean {
	if (!text.trim()) return false;
	const candidates = extractBalancedJsonObjects(extractJsonFromMarkdown(text));
	for (const candidate of candidates) {
		try {
			JSON.parse(candidate);
			return true;
		} catch {
			// Not valid JSON
		}
	}
	return false;
}

/**
 * Safely extract an array from a parsed JSON object under common field names.
 */
export function extractArrayField(
	parsed: Record<string, unknown>,
	...fieldNames: string[]
): unknown[] | undefined {
	for (const name of fieldNames) {
		const value = parsed[name];
		if (Array.isArray(value)) return value;
	}
	return undefined;
}
