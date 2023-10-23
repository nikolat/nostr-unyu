import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buffer, Mode } from '../src/utils';
import { base } from '../src/base';

const mode: Mode = Mode.Fav;

export const config = {
	api: {
		bodyParser: false,
	},
};

export default async function (request: VercelRequest, response: VercelResponse) {
	if (request.method === 'POST') {
		const buf = await buffer(request);
		const rawBody = buf.toString('utf8');
		return await base(rawBody, response, mode);
	} else {
		return response.status(405).setHeader('Allow', 'POST').end('Method Not Allowed');
	}
};
