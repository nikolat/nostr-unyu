import type { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';

export const enum Mode {
	Normal,
	Reply,
	Fav,
	Zap,
	Delete
}

export const buffer = async (readable: Readable) => {
	const chunks: Uint8Array[] = [];
	for await (const chunk of readable) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
};
