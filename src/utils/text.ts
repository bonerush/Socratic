/**
 * Format a duration in seconds to a human-readable string.
 */
export function formatInterval(seconds: number): string {
	if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	return `${Math.round(seconds / 86400)}d`;
}

/**
 * Sanitize a string for use as a filename.
 */
export function sanitizeFilename(name: string): string {
	return name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'untitled';
}
