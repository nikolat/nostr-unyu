import type { VercelRequest, VercelResponse } from '@vercel/node';
import { nip19, nip57 } from 'nostr-tools';
import { Signer } from '../src/utils.js';

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
	const restapiurl = `https://api.yabu.me/v0/profiles/${pubkey}`;
	const resAPI = await fetch(restapiurl);
	if (!resAPI.ok) {
		return response.status(503).json({ error: `Failed to fetch ${restapiurl}` });
	}
	const evKind0 = await resAPI.json();
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
