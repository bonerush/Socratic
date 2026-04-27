/**
 * Shared error handling utilities.
 */

/**
 * Extract a human-readable message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Wrap a function with standardized error formatting.
 * Returns the result on success, or throws with a prefixed message on failure.
 */
export async function withErrorPrefix<T>(
	fn: () => Promise<T>,
	prefix: string,
): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		throw new Error(`${prefix}: ${getErrorMessage(error)}`);
	}
}
