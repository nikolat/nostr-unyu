import type { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';

export const Mode = {
	Normal: 0,
	Reply: 1,
	Fav: 2,
	Zap: 3,
	Delete: 4
} as const;

export type Mode = (typeof Mode)[keyof typeof Mode];

export const buffer = async (readable: Readable) => {
	const chunks: Uint8Array[] = [];
	for await (const chunk of readable) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
};
