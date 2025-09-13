import { readFile } from 'node:fs/promises';
import { it } from 'mocha';
import { assert } from 'chai';
import { generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools/pure';
import { PlainKeySigner as Signer } from 'nostr-tools/signer';
import { Mode } from '../src/utils.js';
import { getResponseEvent } from '../src/response.js';

it('get response with JSON file', async () => {
	const sk = generateSecretKey();
	const text = await readFile('./test/fixtures/input.json', {
		encoding: 'utf8'
	});
	const json = JSON.parse(text);
	const event: NostrEvent = json;
	const signer = new Signer(sk);
	const mode: Mode = Mode.Normal;
	const actual = await getResponseEvent(event, signer, mode);
	const expected0 = {
		kind: 0,
		pubkey: getPublicKey(sk),
		created_at: event.created_at + 1
	};
	const expected42 = {
		kind: event.kind,
		pubkey: getPublicKey(sk),
		created_at: event.created_at + 1,
		contents: ['ええで', 'ええんやで', 'あかんに決まっとるやろ'],
		tags: [
			...event.tags.filter(
				(tag: string[]) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
			),
			['e', event.id, '', 'reply', event.pubkey]
		]
	};
	assert.isNotNull(actual);
	if (actual === null) throw new Error();
	assert.strictEqual(actual.length, 2);
	const kind0 = actual.at(0);
	const kind42 = actual.at(1);
	if (kind0 === undefined || kind42 === undefined) throw new Error();
	assert.strictEqual(kind0.kind, expected0.kind);
	assert.strictEqual(kind0.pubkey, expected0.pubkey);
	assert.strictEqual(kind0.created_at, expected0.created_at);
	assert.strictEqual(kind42.kind, expected42.kind);
	assert.strictEqual(kind42.pubkey, expected42.pubkey);
	assert.strictEqual(kind42.created_at, expected42.created_at);
	assert.deepEqual(kind42.tags, expected42.tags);
	assert.include(expected42.contents, kind42.content);
});
