const HTML_ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#x27;',
};

/**
 * Escape special HTML characters to prevent XSS.
 */
export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] || c);
}
