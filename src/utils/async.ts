/**
 * Retry an async function with exponential backoff.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries = 2,
	baseDelayMs = 1000,
): Promise<T> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
			}
		}
	}
	throw lastError || new Error('Operation failed after retries');
}
