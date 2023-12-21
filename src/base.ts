import type { VercelResponse } from '@vercel/node';
import { type VerifiedEvent, type Event as NostrEvent, nip19, validateEvent, verifyEvent } from 'nostr-tools';
import { Mode, Signer } from './utils';
import { getResponseEvent } from './response';

//入力イベントを検証するかどうか(デバッグ時は無効化した方が楽)
const verifyInputEvent = true;

export const base = async (rawBody: string, response: VercelResponse, mode: Mode) => {
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
	//入力イベントを準備
	let body: any;
	try {
		body = JSON.parse(rawBody);
	} catch (error) {
		return response.status(400).json({ error: 'JSON parse failed' });
	}
	const requestEvent: NostrEvent = body;
	if (!validateEvent(requestEvent)) {
		return response.status(400).json({ error: 'Invalid event' });
	}
	if (verifyInputEvent && !verifyEvent(requestEvent)) {
		return response.status(400).json({ error: 'Unverified event' });
	}
	//出力イベントを取得
	let responseEvent: VerifiedEvent | null;
	try {
		responseEvent = await getResponseEvent(requestEvent, signer, mode);
	} catch (error) {
		if (error instanceof Error) {
			return response.status(400).json({ error: error.message });
		}
		else {
			console.warn(error);
			return response.status(400).json({ error: 'Unexpected error' });
		}
	}
	//出力
	if (responseEvent === null) {
		return response.status(204).send('');
	}
	return response.status(200).setHeader('content-type', 'application/json; charset=utf-8').send(JSON.stringify(responseEvent));
};
