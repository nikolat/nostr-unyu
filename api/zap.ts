import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { NostrEvent } from 'nostr-tools/pure';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import * as nip57 from 'nostr-tools/nip57';
import { Signer } from '../src/utils.js';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const defaultRelays = [
	'wss://relay-jp.nostr.wirednet.jp',
	'wss://relay.nostr.wirednet.jp',
	'wss://yabu.me',
	'wss://nostr-relay.nokotaro.com',
];

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

	//クエリを解析
	const { id = null, pubkey, sats = '50', comment = '' } = request.query;
	if (!(typeof id === 'string' || id === null) || typeof pubkey !== 'string' || typeof sats !== 'string' || typeof comment !== 'string') {
		return response.status(403).json({ error: 'query is not single string' });
	}
	const sats_int = Number.parseInt(sats);
	if (Number.isNaN(sats_int)) {
		return response.status(403).json({ error: 'sats is not integer' });
	}

	//kind0からZapエンドポイントを取得
	const pool = new SimplePool();
	const relays = defaultRelays;
	const evKind0 = await getKind0(pool, relays, pubkey);
	pool.close(defaultRelays);
	const zapEndpoint = await nip57.getZapEndpoint(evKind0);
	if (zapEndpoint === null) {
		return response.status(403).json({ error: 'Zap endpoint is null' });
	}

	//Zapイベントの署名
	const amount = sats_int * 1000;
	const zapRequest = nip57.makeZapRequest({
		profile: pubkey,
		event: id,
		amount,
		comment,
		relays: defaultRelays,
	});
	const zapRequestEvent = signer.finishEvent(zapRequest);

	//invoiceの取得
	const encoded = encodeURI(JSON.stringify(zapRequestEvent));
	const url = `${zapEndpoint}?amount=${amount}&nostr=${encoded}`;
	const resZap = await fetch(url);
	if (!resZap.ok) {
		return response.status(503).json({ error: `Failed to fetch ${url}` });
	}
	const { pr: invoice } = await resZap.json();

	return response.status(200).send(invoice);
};

const getKind0 = async (pool: SimplePool, relays: string[], pubkey: string): Promise<NostrEvent> => {
	return new Promise(async (resolve) => {
		let r: NostrEvent;
		const filters = [
			{
				kinds: [0],
				authors: [pubkey],
			}
		];
		const onevent = async (ev: NostrEvent) => {
			if (r === undefined || r.created_at < ev.created_at) {
				r = ev;
			}
		};
		const oneose = async () => {
			sub.close();
			resolve(r);
		};
		const sub = pool.subscribeMany(
			relays,
			filters,
			{ onevent, oneose }
		);
	});
};
