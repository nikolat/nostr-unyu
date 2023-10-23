import { nip19 } from 'nostr-tools';

export const getResponseEvent = (requestEvent, signer) => {
	if (requestEvent.pubkey === signer.getPublicKey()) {
		//自分自身の投稿には反応しない
		return null;
	}
	const res = selectResponse(requestEvent);
	if (res === null) {
		//反応しないことを選択
		return null;
	}
	return signer.finishEvent(res);
};

const selectResponse = (event) => {
	if (!isAllowedToPost(event)) {
		return null;
	}
	let content;
	let kind;
	let tags;
	if (/^そもさん$/.test(event.content)) {
		content = 'せっぱ！';
		kind = event.kind;
		tags = getTagsReply(event);
	}
	else if (event.tags.some(tag => tag.length >= 2 && tag[0] === 't' && tag[1] === 'ノス禁')) {
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `𝑫𝒐 𝑵𝒐𝒔𝒕𝒓\nnostr:${quote}`;
		kind = event.kind;
		tags = getTagsAirrep(event);
	}
	else if (/^祝福$/.test(event.content)) {
		content = '+';
		kind = 7;
		tags = getTagsFav(event);
	}
	else {
		return null;
	}
	const created_at = event.created_at + 1;
	const unsignedEvent = { kind, tags, content, created_at };
	return unsignedEvent;
};

const isAllowedToPost = (event) => {
	if (event.kind === 1) {
		return true;
	}
	else if (event.kind === 42) {
		const existRootTag = event.tags.some(tag => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root');
		if (existRootTag) {
			return true;
		}
		else {
			throw new TypeError('root is not found');
		}
	}
	throw new TypeError(`kind ${event.kind} is not supported`);
};

const getTagsAirrep = (event) => {
	if (event.kind === 1) {
		return [['e', event.id, '', 'mention']];
	}
	else if (event.kind === 42) {
		const tagRoot = event.tags.find(tag => tag.length >= 3 && tag[0] === 'e' && tag[3] === 'root');
		if (tagRoot !== undefined) {
			return [tagRoot, ['e', event.id, '', 'mention']];
		}
		else {
			throw new TypeError('root is not found');
		}
	}
	throw new TypeError(`kind ${event.kind} is not supported`);
};

const getTagsReply = (event) => {
	const tagsReply = [];
	const tagRoot = event.tags.find(tag => tag.length >= 3 && tag[0] === 'e' && tag[3] === 'root');
	if (tagRoot !== undefined) {
		tagsReply.push(tagRoot);
		tagsReply.push(['e', event.id, '', 'reply']);
	}
	else {
		tagsReply.push(['e', event.id, '', 'root']);
	}
	for (const tag of event.tags.filter(tag => tag.length >= 2 && tag[0] === 'p' && tag[1] !== event.pubkey)) {
		tagsReply.push(tag);
	}
	tagsReply.push(['p', event.pubkey, '']);
	return tagsReply;
};

const getTagsFav = (event) => {
	const tagsFav = event.tags.filter(tag => tag.length >= 2 && (tag[0] === 'e' || (tag[0] === 'p' && tag[1] !== event.pubkey)));
	tagsFav.push(['e', event.id, '', '']);
	tagsFav.push(['p', event.pubkey, '']);
	tagsFav.push(['k', String(event.kind)]);
	return tagsFav;
};
