import { buffer } from '../src/utils.js';
import { base } from '../src/base.js';

export const config = {
	api: {
		bodyParser: false,
	},
};

export default async function (request, response) {
	if (request.method === 'POST') {
		const buf = await buffer(request);
		const rawBody = buf.toString('utf8');
		return base(rawBody, response);
	} else {
		return response.status(405).setHeader('Allow', 'POST').end('Method Not Allowed');
	}
};
