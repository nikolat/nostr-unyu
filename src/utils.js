import { Buffer } from 'node:buffer';
import { finishEvent, getPublicKey } from 'nostr-tools';

export const buffer = async (readable) => {
	const chunks = [];
	for await (const chunk of readable) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
};

export class Signer {

	#seckey;

	constructor(seckey) {
		this.#seckey = seckey;
	}

	getPublicKey = () => {
		return getPublicKey(this.#seckey);
	};

	finishEvent = (unsignedEvent) => {
		return finishEvent(unsignedEvent, this.#seckey);
	};

};
