import type { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import type { EventTemplate } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools';

export const enum Mode {
	Normal,
	Reply,
	Fav,
};

export const buffer = async (readable: Readable) => {
	const chunks: Uint8Array[] = [];
	for await (const chunk of readable) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
};

export class Signer {

	#seckey: Uint8Array;

	constructor(seckey: Uint8Array) {
		this.#seckey = seckey;
	}

	getPublicKey = () => {
		return getPublicKey(this.#seckey);
	};

	finishEvent = (unsignedEvent: EventTemplate) => {
		return finalizeEvent(unsignedEvent, this.#seckey);
	};

};
