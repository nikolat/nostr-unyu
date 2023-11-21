import type { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { type EventTemplate, finishEvent, getPublicKey, relayInit } from 'nostr-tools';
import { getSingle, upsertTableOrCreate } from 'nostr-key-value';

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

	#seckey: string;
	#relayUrl = 'wss://nostr-relay.nokotaro.com';
	#tableName = 'bot';
	#tableTitle = 'bot';
	#keyname = 'memo';

	constructor(seckey: string) {
		this.#seckey = seckey;
	}

	getPublicKey = () => {
		return getPublicKey(this.#seckey);
	};

	finishEvent = (unsignedEvent: EventTemplate) => {
		return finishEvent(unsignedEvent, this.#seckey);
	};

	getSingle = async () => {
		return await getSingle([this.#relayUrl], this.getPublicKey(), this.#tableName, this.#keyname);
	};

	upsertTable = async (memo: string) => {
		const values = [[this.#keyname, memo]];
		const table_ev = await upsertTableOrCreate(
			[this.#relayUrl],
			this.getPublicKey(),
			this.#tableName,
			this.#tableTitle,
			[],
			values,
		);
		await this.#postNostr(table_ev);
	};

	#postNostr = async (ev: EventTemplate) => {
		const relay = relayInit(this.#relayUrl);
		relay.connect();
		return new Promise((resolve, reject) => {
			const data = finishEvent(ev, this.#seckey);
			const pub = relay.publish(data);
			pub.then(() => {
				resolve('success');
			});
			pub.catch(() => {
				reject('failed');
			});
		});
	};
};
