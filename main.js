import { generatePrivateKey, finishEvent } from 'nostr-tools';
import { Signer } from './src/utils.js'
import { getResponseEvent } from './src/response.js';

const main = async () => {
	const unsignedEvent = {
		kind: 42,
		created_at: Math.floor(Date.now() / 1000),
		content: 'そもさん',
		tags: [['e', '1234567890123456789012345678901234567890123456789012345678901234', '', 'root']],
	};
	const sk_req = generatePrivateKey();
	const event_req = finishEvent(unsignedEvent, sk_req);
	const sk_res = generatePrivateKey();
	const signer = new Signer(sk_res);
	const event_res = await getResponseEvent(event_req, signer);
	const request = JSON.stringify(event_req, undefined, 2);
	const response = JSON.stringify(event_res, undefined, 2);
	console.log(request, response);
};

main();
