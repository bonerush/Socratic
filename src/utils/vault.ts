import { type Vault, normalizePath } from 'obsidian';

/**
 * Vault filesystem utilities shared across SessionManager and MemoryManager.
 */

/**
 * Ensure a directory exists in the vault, creating it if necessary.
 */
export async function ensureDir(vault: Vault, dir: string): Promise<void> {
	const adapter = vault.adapter;
	const normalized = normalizePath(dir);
	const exists = await adapter.exists(normalized);
	if (!exists) {
		await adapter.mkdir(normalized);
	}
}

/**
 * Remove a directory and all its contents from the vault.
 *
 * Obsidian's adapter.remove() cannot delete non-empty directories,
 * so we list files and delete them individually first.
 */
export async function removeDir(vault: Vault, dir: string): Promise<void> {
	const adapter = vault.adapter;
	const normalized = normalizePath(dir);
	const exists = await adapter.exists(normalized);
	if (!exists) return;

	let files: string[] = [];
	try {
		const listing = await adapter.list(normalized);
		if (listing && typeof listing === 'object') {
			files = Array.isArray(listing.files) ? listing.files : [];
		}
	} catch {
		// list() may fail; caller should provide fallback file names
	}

	for (const file of files) {
		if (typeof file !== 'string') continue;
		const filePath = file.startsWith(normalized) ? file : normalizePath(`${normalized}/${file}`);
		try {
			await adapter.remove(filePath);
		} catch {
			// File may not exist
		}
	}

	await adapter.remove(normalized);
}

/**
 * Write text to a file, ensuring the parent directory exists.
 */
export async function writeFile(vault: Vault, path: string, content: string): Promise<void> {
	const normalized = normalizePath(path);
	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash > 0) {
		await ensureDir(vault, normalized.substring(0, lastSlash));
	}
	await vault.adapter.write(normalized, content);
}
