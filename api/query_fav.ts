import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { Signer } from '../src/utils.js';

export default async function (request: VercelRequest, response: VercelResponse) {
	if (request.method !== 'GET') {
		return response.status(405).setHeader('Allow', 'GET').end('Method Not Allowed');
	}
	//署名用インスタンスを準備
	const nsec = process.env.NOSTR_PRIVATE_KEY;
	if (nsec === undefined) {
		return response.status(500).json({ error: 'NOSTR_PRIVATE_KEY is undefined' });
	}
	const dr = nip19.decode(nsec);
	if (dr.type !== 'nsec') {
		return response.status(500).json({ error: 'NOSTR_PRIVATE_KEY is not `nsec`' });
	}
	const seckey = dr.data;
	const signer = new Signer(seckey);
	//リレー送信用認証パス
	const auth = process.env.NOSTR_WEBHOOK_AUTH;
	if (auth === undefined) {
		return response.status(500).json({ error: 'NOSTR_WEBHOOK_AUTH is undefined' });
	}

	//クエリを解析
	const { id = null, note = null, nevent = null, pubkey = null, npub = null, kind = null, content = '⭐' } = request.query;
	if (!(typeof id === 'string' || id === null)
		|| !(typeof note === 'string' || note === null)
		|| !(typeof nevent === 'string' || nevent === null)
		|| !(typeof pubkey === 'string' || pubkey === null)
		|| !(typeof npub === 'string' || npub === null)
		|| !(typeof kind === 'string' || kind === null)
		|| typeof content !== 'string') {
		return response.status(403).json({ error: 'query is not single string' });
	}
	if (kind !== null && !/^\d+$/.test(kind)) {
		return response.status(403).json({ error: 'kind is not integer' });
	}
	let fav_target_id = id;
	let fav_target_pubkey = pubkey;
	if (note !== null) {
		const dr = nip19.decode(note);
		if (dr.type === 'note') {
			fav_target_id = dr.data;
		}
	}
	if (nevent !== null) {
		const dr = nip19.decode(nevent);
		if (dr.type === 'nevent') {
			fav_target_id = dr.data.id;
			if (dr.data.author !== undefined) {
				fav_target_pubkey = dr.data.author;
			}
		}
	}
	if (npub !== null) {
		const dr = nip19.decode(npub);
		if (dr.type === 'npub') {
			fav_target_pubkey = dr.data;
		}
	}
	if (fav_target_id === null || fav_target_pubkey === null) {
		return response.status(403).json({ error: 'id and pubkey are required' });
	}
	const tags: string[][] = [['e', fav_target_id], ['p', fav_target_pubkey]];
	if (kind !== null) {
		tags.push(['k', kind])
	}
	const baseEvent: EventTemplate = {
		kind: 7,
		created_at: Math.floor(Date.now() / 1000),
		tags,
		content,
	};
	const newEvent: VerifiedEvent = signer.finishEvent(baseEvent);
	const url = 'https://nostr-webhook.compile-error.net/post';
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + btoa(auth),
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(newEvent),
	})
	return response.status(200).send(await res.text());
};
