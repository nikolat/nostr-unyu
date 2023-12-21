import * as fs from 'node:fs/promises';
import { it } from 'mocha';
import chai from 'chai';
import { generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools';
import { Mode, Signer } from '../src/utils';
import { getResponseEvent } from '../src/response';

it('get response with JSON file', async() => {
	const sk = generateSecretKey();
	const text = await fs.readFile('./test/fixtures/input.json', { encoding: 'utf8' });
	const json = JSON.parse(text);
	const event: NostrEvent = json;
	const signer = new Signer(sk);
	const mode: Mode = Mode.Normal;
	const actual = await getResponseEvent(event, signer, mode);
	const expected = {
		kind: event.kind,
		pubkey: getPublicKey(sk),
		created_at: event.created_at + 1,
		contents: ['ええで', 'ええんやで', 'あかんに決まっとるやろ'],
		tags: [...event.tags.filter(tag => tag.length >= 3 && tag[0] === 'e' && tag[3] === 'root'), ['e', event.id, '', 'mention']],
	};
	chai.assert.isNotNull(actual);
	if (actual === null) throw new Error();
	chai.assert.strictEqual(actual.kind, expected.kind);
	chai.assert.strictEqual(actual.pubkey, expected.pubkey);
	chai.assert.strictEqual(actual.created_at, expected.created_at);
	chai.assert.deepEqual(actual.tags, expected.tags);
	chai.assert.include(expected.contents, actual.content);
});
