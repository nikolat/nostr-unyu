import * as fs from 'node:fs/promises';
import { it } from 'mocha';
import { assert } from 'chai';
import {
  generateSecretKey,
  getPublicKey,
  type NostrEvent,
} from 'nostr-tools/pure';
import { Mode, Signer } from '../src/utils.js';
import { getResponseEvent } from '../src/response.js';

it('get response with JSON file', async () => {
  const sk = generateSecretKey();
  const text = await fs.readFile('./test/fixtures/input.json', {
    encoding: 'utf8',
  });
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
    tags: [
      ...event.tags.filter(
        (tag: string[]) =>
          tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root',
      ),
      ['e', event.id, '', 'mention'],
    ],
  };
  assert.isNotNull(actual);
  if (actual === null) throw new Error();
  assert.strictEqual(actual.kind, expected.kind);
  assert.strictEqual(actual.pubkey, expected.pubkey);
  assert.strictEqual(actual.created_at, expected.created_at);
  assert.deepEqual(actual.tags, expected.tags);
  assert.include(expected.contents, actual.content);
});
