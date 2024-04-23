import { type EventTemplate, type VerifiedEvent, type Event as NostrEvent, type Filter, nip19, nip47, nip57, SimplePool } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import mb_strwidth from './mb_strwidth.js';
import Parser from 'rss-parser';
import { Mode, Signer } from './utils.js';
import { useWebSocketImplementation, Relay } from 'nostr-tools/relay';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const defaultRelays = [
	'wss://relay-jp.nostr.wirednet.jp',
	'wss://relay.nostr.wirednet.jp',
	'wss://yabu.me',
	'wss://nostr-relay.nokotaro.com',
];
const zapRelay = 'wss://nos.lol';

export const getResponseEvent = async (requestEvent: NostrEvent, signer: Signer, mode: Mode): Promise<VerifiedEvent | null> => {
	if (requestEvent.pubkey === signer.getPublicKey()) {
		//自分自身の投稿には反応しない
		return null;
	}
	const res = await selectResponse(requestEvent, mode, signer);
	if (res === null) {
		//反応しないことを選択
		return null;
	}
	return signer.finishEvent(res);
};

const selectResponse = async (event: NostrEvent, mode: Mode, signer: Signer): Promise<EventTemplate | null> => {
	if (!isAllowedToPost(event)) {
		return null;
	}
	let res;
	switch (mode) {
		case Mode.Normal:
			res = await mode_normal(event, signer);
			break;
		case Mode.Reply:
			res = await mode_reply(event, signer);
			break;
		case Mode.Fav:
			res = mode_fav(event);
			break;
		default:
			throw new TypeError(`unknown mode: ${mode}`);
	}
	if (res === null) {
		return null;
	}
	const [content, kind, tags, created_at] = [...res, event.created_at + 1];
	const unsignedEvent: EventTemplate = { kind, tags, content, created_at };
	return unsignedEvent;
};

const isAllowedToPost = (event: NostrEvent) => {
	const allowedChannel = [
		'be8e52c0c70ec5390779202b27d9d6fc7286d0e9a2bc91c001d6838d40bafa4a',//Nostr伺か部
		'8206e76969256cd33277eeb00a45e445504dfb321788b5c3cc5d23b561765a74',//うにゅうハウス開発
		'330fc57e48e39427dd5ea555b0741a3f715a55e10f8bb6616c27ec92ebc5e64b',//カスタム絵文字の川
	];
	const disallowedTags = ['content-warning', 'proxy'];
	if (event.tags.some(tag => tag.length >= 1 && disallowedTags.includes(tag[0]))) {
		return false;
	}
	if (event.kind === 1) {
		return true;
	}
	else if (event.kind === 42) {
		const tagRoot = event.tags.find(tag => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root');
		if (tagRoot !== undefined) {
			return allowedChannel.includes(tagRoot[1]);
		}
		else {
			throw new TypeError('root is not found');
		}
	}
	throw new TypeError(`kind ${event.kind} is not supported`);
};

const getResmap = (mode: Mode): [RegExp, (event: NostrEvent, mode: Mode, regstr: RegExp, signer: Signer) => Promise<[string, string[][]] | null> | [string, string[][]] | null][] => {
	const resmapNormal: [RegExp, (event: NostrEvent, mode: Mode, regstr: RegExp) => [string, string[][]] | null][] = [
		[/いいの?か?(？|\?)$/, res_iiyo],
		[/\\e$/, res_enyee],
		[/^うにゅう画像$/, res_unyupic],
		[/^うにゅう漫画$/, res_unyucomic],
		[/^ちくわ大明神$/, res_chikuwa],
		[/(ほめて|褒めて|のでえらい|えらいので).?$|^えらいので/u, res_igyo],
		[/[行い]っ?てきます.?$/u, res_itera],
		[/^((う|ぐ)っにゅう?ーん|ぎゅ(うっ|っう)にゅう?ーん).?$/u, res_unnyuuun],
		[/(フォロー|ふぉろー)[飛と]んだ.?$/u, res_nostrflu],
		[/^次は「(.)」から！$/u, res_shiritori],
		[/^(うにゅう、|うにゅう[くさた]ん、|うにゅうちゃん、)?(.{1,300})[をに]([燃萌も]やして|焼いて|煮て|炊いて|沸か[せし]て|溶かして|凍らせて|冷やして|通報して|火を[付つ]けて|磨いて|爆破して|注射して|打って|駐車して|停めて|潰して|縮めて|伸ばして|広げて|ど[突つ]いて|[踏ふ]んで|捌いて|裁いて|出して|積んで|握って|触って|祝って|呪って|鳴らして|詰めて|梱包して|囲んで|囲って|詰んで|漬けて|[踊躍]らせて|撃って|蒸して|上げて|アゲて|ageて|下げて|サゲて|sageて|導いて|支えて)[^るた]?$/us, res_fire],
	];
	const resmapReply: [RegExp, (event: NostrEvent, mode: Mode, regstr: RegExp, signer: Signer) => Promise<[string, string[][]]> | [string, string[][]] | null][] = [
		[/zapテスト$/i, res_zaptest],
		[/おはよ/, res_ohayo],
		[/アルパカ|🦙/, res_arupaka],
		[/画像生成/, res_gazouseisei],
		[/りとりん|つぎはなにから？/, res_ritorin],
		[/占って|占い/, res_uranai],
		[/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅうちゃん、)?(\S+)の(週間)?天気/, res_tenki],
		[/(^|\s+)うにゅう、自(\S+)しろ/, res_aura],
		[/(npub\w{59})\s?(さん|ちゃん|くん)?に(.{1,50})を/us, res_okutte],
		[/ニュース/, res_news],
		[/中身/, res_nakami],
		[/誕生日/, res_tanjobi],
		[/どんぐり/, res_donguri],
		[/時刻|時報|日時|何時/, res_jihou],
		[/ログボ|ログインボーナス/, res_rogubo],
		[/あなたの合計ログイン回数は(\d+)回です。/, res_get_rogubo],
		[/(もらって|あげる|どうぞ).?$/u, res_ageru],
		[/ありが(と|て)|(たす|助)か(る|った)/, res_arigato],
		[/ごめん|すまん/, res_gomen],
		[/かわいい|可愛い|すごい|かっこいい|えらい|偉い|かしこい|賢い|最高/, res_kawaii],
		[/月が(綺麗|きれい|キレイ)/, res_tsukikirei],
		[/あかんの?か/, res_akan],
		[/お(かえ|帰)り/, res_okaeri],
		[/人の心/, res_hitonokokoro],
		[/ぽわ/, res_powa],
		[/あけおめ|あけまして|ことよろ/, res_akeome],
		[/お年玉/, res_otoshidama],
		[/牛乳|ぎゅうにゅう/, res_gyunyu],
		[/検索(を?呼んで|どこ).?$/u, res_kensaku],
		[/(パブ|ぱぶ)(リック)?(チャ|ちゃ|茶)(ット)?(を?呼んで|どこ).?$/u, res_pabucha],
		[/(じゃんけん|ジャンケン|淀川(さん)?)(を?呼んで|どこ).?$/u, res_janken],
		[/(しりとり|しりとリレー)(を?呼んで|どこ).?$/u, res_shiritoridoko],
		[/やぶみ(ちゃ)?ん?(を?呼んで|どこ).?$/u, res_yabumin],
		[/ぬるぽが?(を?呼んで|どこ).?$/u, res_nurupoga],
		[/うにゅう(を?呼んで|どこ).?$/u, res_unyu],
		[/Don(さん)?(を?呼んで|どこ).?$/ui, res_don],
		[/(マグロ|ﾏｸﾞﾛ)の?元ネタ(を?呼んで|どこ).?$/u, res_maguro],
		[/(カレンダー|アドカレ)(を?呼んで|どこ).?$/u, res_adokare],
		[/DM.*(を?呼んで|どこ).?$/ui, res_dm],
		[/絵文字.*(を?呼んで|どこ).?$/ui, res_emoji],
		[/伺か民?(を?呼んで|どこ).?$/u, res_ukagakamin],
		[/再起動/, res_saikidou],
		[/えんいー/, res_enii],
		[/伺か/, res_ukagaka],
		[/[呼よ](んだだけ|んでみた)|(何|なん)でもない/, res_yondadake],
		[/ヘルプ|へるぷ|help|(助|たす)けて|(教|おし)えて|手伝って/i, res_help],
		[/すき|好き|愛してる|あいしてる/, res_suki],
		[/ランド|開いてる|閉じてる|開園|閉園/, res_ochinchinland],
		[/招待コード/, res_invitecode],
		[/ライトニング|フリー?マ|Zap|ビットコイン|⚡/ui, res_bitcoin],
		[/(🫂|🤗)/u, res_hug],
		[/[💋💕]/u, res_chu],
		[/(？|\?)$/, res_hatena],
	];
	switch (mode) {
		case Mode.Normal:
			return resmapNormal;
		case Mode.Reply:
			return [...resmapNormal, ...resmapReply];
		default:
			throw new TypeError(`unknown mode: ${mode}`);
	}
};

const mode_normal = async (event: NostrEvent, signer: Signer): Promise<[string, number, string[][]] | null> => {
	//自分への話しかけはreplyで対応する
	//自分以外に話しかけている場合は割り込まない
	if (event.tags.some(tag => tag.length >= 2 && (tag[0] === 'p'))) {
		return null;
	}
	//自分への話しかけはreplyで対応する
	if (/^(うにゅう、|うにゅう[くさた]ん、|うにゅうちゃん、)/.test(event.content)) {
		return null
	}
	const resmap = getResmap(Mode.Normal);
	for (const [reg, func] of resmap) {
		if (reg.test(event.content)) {
			const res = await func(event, Mode.Normal, reg, signer);
			if (res === null) {
				return null;
			}
			const [content, tags] = res;
			return [content, event.kind, tags];
		}
	}
	return null;
};

const mode_reply = async (event: NostrEvent, signer: Signer): Promise<[string, number, string[][]] | null> => {
	const resmap = getResmap(Mode.Reply);
	for (const [reg, func] of resmap) {
		if (reg.test(event.content)) {
			const res = await func(event, Mode.Reply, reg, signer);
			if (res === null) {
				return null;
			}
			const [content, tags] = res;
			return [content, event.kind, tags];
		}
	}
	let content;
	let tags;
	if (event.tags.some(tag => tag[0] === 't' && tag[1] === 'ぬるぽが生成画像')) {
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `${any(['上手やな', '上手いやん', 'ワイの方が上手いな'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
	}
	else {
		content = 'えんいー';
		tags = getTagsAirrep(event);
	}
	return [content, event.kind, tags];
};

const mode_fav = (event: NostrEvent): [string, number, string[][]] | null => {
	const reactionmap: [RegExp, string][] = [
		[/虚無/, ''],
		[/さくら/, ':uka_sakurah00:'],
		[/ぎゅうにゅう|とうにゅう/, '🥛'],
		[/こうにゅう/, '💸'],
		[/しゅうにゅう/, '💰'],
		[/そうにゅう/, '🔖'],
		[/ちゅうにゅう/, '💉'],
		[/のうにゅう/, '📦'],
		[/ふうにゅう/, '💌'],
		[/うにゅう(?!(ハウス|、))/, ':unyu:'],
		[/^うちゅう$/, any(['🪐', '🛸', '🚀'])],
		[/^う[^に]ゅう$/, '❓'],
		[/^[^う]にゅう$/, '❓'],
		[/えんいー/, '⭐'],
	];
	for (const [reg, content] of reactionmap) {
		if (reg.test(event.content)) {
			const kind: number = 7;
			const tags: string[][] = getTagsFav(event);
			if (content === ':unyu:') {
				tags.push(['emoji', 'unyu', 'https://nikolat.github.io/avatar/disc2.png']);
			}
			else if (content === ':uka_sakurah00:') {
				tags.push(['emoji', 'uka_sakurah00', 'https://ukadon-cdn.de10.moe/system/custom_emojis/images/000/006/840/original/uka_sakurah00.png']);
			}
			return [content, kind, tags];
		}
	}
	return null;
};

const res_zaptest = async (event: NostrEvent, mode: Mode, regstr: RegExp, signer: Signer): Promise<[string, string[][]]> => {
	const npub_don = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
	if (event.pubkey !== nip19.decode(npub_don).data) {
		return ['イタズラしたらあかんで', getTagsReply(event)];
	}
	try {
		await zapByNIP47(event, signer, 1, 'Zapのテストやで');
	} catch (error) {
		return ['何か失敗したみたいやで', getTagsReply(event)];
	}
	return ['1sat届いたはずやで', getTagsReply(event)];
};

const res_ohayo = async (event: NostrEvent, mode: Mode, regstr: RegExp, signer: Signer): Promise<[string, string[][]]> => {
	const date = new Date();
	date.setHours(date.getHours() + 9);//JST
	const [year, month, day, hour, minutes, seconds, week] = [
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
		'日月火水木金土'.at(date.getDay()),
	];
	if (4 <= hour && hour < 8) {
		const mes = any([
			'早起きのご褒美やで',
			'健康的でええな',
			'みんなには内緒やで',
			'二度寝したらあかんで',
			'明日も早起きするんやで',
			`${week}曜日の朝や、今日も元気にいくで`,
			'朝ご飯はしっかり食べるんやで',
			'夜ふかししたんと違うやろな？',
			'継続は力やで',
			'今日はきっといいことあるで',
		]);
		try {
			await zapByNIP47(event, signer, 3, mes);
		} catch (error) {
			return [any(['zzz...', 'まだ寝ときや', 'もう朝やて？ワイは信じへんで']), getTagsReply(event)];
		}
	}
	return [any(['おはようやで', 'ほい、おはよう', `もう${hour}時か、おはよう`]), getTagsReply(event)];
};

const zapByNIP47 = async (event: NostrEvent, signer: Signer, sats: number, zapComment: string): Promise<void> => {
	const wc = process.env.NOSTR_WALLET_CONNECT;
	if (wc === undefined) {
		throw Error('NOSTR_WALLET_CONNECT is undefined');
	}
	const { pathname, hostname, searchParams } = new URL(wc);
	const walletPubkey = pathname || hostname;
	const walletRelay = searchParams.get('relay');
	const walletSeckey = searchParams.get('secret');
	if (walletPubkey.length === 0 || walletRelay === null || walletSeckey === null) {
		return;
	}
	const evKind0 = await getKind0(event.pubkey);
	if (evKind0 === undefined) {
		throw Error('Cannot get kind 0 event');
	}
	const zapEndpoint = await nip57.getZapEndpoint(evKind0);
	if (zapEndpoint === null) {
		throw Error('Cannot get zap endpoint');
	}

	const lastZap = await getLastZap(event.pubkey);
	if (lastZap !== undefined && Math.floor(Date.now() / 1000) - lastZap.created_at < 60 * 10) {//10分以内に誰かからZapをもらっている
		const evKind9734 = JSON.parse(lastZap.tags.find(tag => tag[0] === 'description')?.at(1) ?? '{}');
		if (evKind9734.pubkey === signer.getPublicKey()) {//自分からのZap
			return;
		}
	}

	const amount = sats * 1000;
	const zapRequest = nip57.makeZapRequest({
		profile: event.pubkey,
		event: event.id,
		amount,
		comment: zapComment,
		relays: defaultRelays,
	});
	const zapRequestEvent = signer.finishEvent(zapRequest);
	const encoded = encodeURI(JSON.stringify(zapRequestEvent));

	const url = `${zapEndpoint}?amount=${amount}&nostr=${encoded}`;

	const response = await fetch(url);
	if (!response.ok) {
		throw Error('Cannot get invoice');
	}
	const { pr: invoice } = await response.json();

	const ev = await nip47.makeNwcRequestEvent(walletPubkey, hexToBytes(walletSeckey), invoice);
	const wRelay = await Relay.connect(walletRelay);
	await wRelay.publish(ev);
	wRelay.close();
};

const getKind0 = (pubkey: string): Promise<NostrEvent | undefined> => {
	return getEvent(zapRelay, [
		{
			kinds: [0],
			authors: [pubkey],
		}
	]);
};

const getLastZap = (pubkey: string): Promise<NostrEvent | undefined> => {
	return getEvent(zapRelay, [
		{
			kinds: [9735],
			'#p': [pubkey],
			limit: 1
		}
	]);
};

const getEvent = (relayUrl: string, filters: Filter[]): Promise<NostrEvent | undefined> => {
	return new Promise(async (resolve, reject) => {
		let relay: Relay;
		try {
			relay = await Relay.connect(relayUrl);
		} catch (error) {
			reject(error);
			return;
		}
		let r: NostrEvent | undefined;
		const onevent = (ev: NostrEvent) => {
			if (r === undefined || r.created_at < ev.created_at) {
				r = ev;
			}
		};
		const oneose = () => {
			sub.close();
			relay.close();
			resolve(r);
		};
		const sub = relay.subscribe(
			filters,
			{ onevent, oneose }
		);
	});
};

const res_arupaka = (event: NostrEvent): [string, string[][]] => {
	if (event.kind === 1) {
		const nevent = 'nevent1qvzqqqqq9qqzqvc0c4ly3cu5ylw4af24kp6p50m3tf27zrutkeskcflvjt4utejtksjfnx';//カスタム絵文字の川
		const content = `パブチャでやれ\nnostr:${nevent}`;
		const tags = [...getTagsReply(event), ['e', nip19.decode(nevent).data.id, '', 'mention']];
		return [content, tags];
	}
	let content: string;
	let tags: string[][];
	const LIMIT_WIDTH = 10;
	const LIMIT_HEIGHT = 30;
	const LIMIT_BODY = 5;
	let retry_max = 1;
	if (/みじかい|短い/.test(event.content)) {
		retry_max = 0;
	}
	else if (/ながい|長い/.test(event.content)) {
		retry_max = 2;
		if (/ちょう|超|めっ?ちゃ|クソ/.test(event.content)) {
			retry_max = 3;
			const count = Math.min((event.content.match(/超/g) || []).length, 17);
			retry_max += count;
		}
	}
	let n = Math.min((event.content.match(/アルパカ|🦙/g) || []).length, LIMIT_BODY);
	if (/-?\d+[匹体]/.test(event.content)) {
		const m = event.content.match(/(-?\d+)[匹体]/) ?? '';
		n = Math.min(parseInt(m[0]), LIMIT_BODY);
		n = Math.max(1, n);
	}
	const startpoint = [];
	const save: number[][] = [];
	const x: number[] = [];
	const y: number[] = [];
	const b: number[][] = [];//2つ前の座標を覚えておく
	const c: number[][] = [];//1つ前の座標を覚えておく
	const arrow = new Map();
	const finished: boolean[] = [];
	const retry: number[] = [];
	const gaming: boolean[] = [];
	const matchesIterator = event.content.matchAll(/((ゲーミング|光|虹|明|🌈)?(アルパカ|🦙))/g);
	for (const match of matchesIterator) {
		if (/(ゲーミング|光|虹|明|🌈)(アルパカ|🦙)/.test(match[0])) {
			gaming.push(true);
		}
		else {
			gaming.push(false);
		}
		if (gaming.length >= LIMIT_BODY) {
			break;
		}
	}
	for (let i = 0; i < n; i++) {
		startpoint.push([0 + 2 * i, 1]);
		save.push([0 + 2 * i, 0], [1 + 2 * i, 0], [0 + 2 * i, 1]);
		x.push(0 + 2 * i);
		y.push(1);
		b.push([0 + 2 * i, 0]);
		c.push([0 + 2 * i, 1]);
		finished.push(false);
		retry.push(retry_max);
		if (gaming[i] === undefined)
			gaming.push(gaming[i - 1]);
		arrow.set(`${0 + 2 * i},0`, 'body' + (gaming[i] ? 'g' : ''));
		arrow.set(`${1 + 2 * i},0`, '');
	}
	const emoji = new Set<string>();
	const emoji_seigen = new Set<string>();
	//頭を上下左右にとりあえず動かしてみる
	while (true) {
		for (let i = 0; i < n; i++) {
			if (finished[i]) {
				continue;
			}
			const r = Math.floor(Math.random() * 4);
			let cs = '';//どっちに動く？
			switch (r) {
				case 0:
					x[i]++;
					cs = '→';
					break;
				case 1:
					x[i]--;
					cs = '←';
					break;
				case 2:
					y[i]++;
					cs = '↑';
					break;
				case 3:
					y[i]--;
					cs = '↓';
					break;
				default:
					break;
			}
			let bs = '';//どっちから動いてきた？
			if (c[i][0] - b[i][0] > 0) {
				bs = '←';
			}
			else if (c[i][0] - b[i][0] < 0) {
				bs = '→';
			}
			else if (c[i][1] - b[i][1] > 0) {
				bs = '↓';
			}
			else if (c[i][1] - b[i][1] < 0) {
				bs = '↑';
			}
			const x_min = Math.min(...save.map(e => e[0]), ...x);
			const x_max = Math.max(...save.map(e => e[0]), ...x);
			const y_min = Math.min(...save.map(e => e[1]), ...y);
			const y_max = Math.max(...save.map(e => e[1]), ...y);
			//体にぶつかるか、境界にぶつかるかしたら終わり
			if (save.some(e => e[0] === x[i] && e[1] === y[i]) || Math.abs(x_max - x_min) >= LIMIT_WIDTH || Math.abs(y_max - y_min) >= LIMIT_HEIGHT) {
				//クロス(貫通)可能ならクロスする
				const next_arrow = arrow.get(`${x[i]},${y[i]}`) ?? '';
				//上を跨ぐか下を潜るか
				const r = Math.floor(Math.random() * 2);
				if (cs === '→' && ['↑↓', '↓↑'].includes(next_arrow) && !save.some(e => e[0] === x[i] + 1 && e[1] === y[i]) && Math.max(...save.map(e => e[0]), x[i] + 1) - x_min < LIMIT_WIDTH) {
					if (r)
						arrow.set(`${x[i]},${y[i]}`, '←→' + (gaming[i] ? 'g' : ''));
					x[i]++;
				}
				else if (cs === '←' && ['↑↓', '↓↑'].includes(next_arrow) && !save.some(e => e[0] === x[i] - 1 && e[1] === y[i]) && x_max - Math.min(...save.map(e => e[0]), x[i] - 1) < LIMIT_WIDTH) {
					if (r)
						arrow.set(`${x[i]},${y[i]}`, '←→' + (gaming[i] ? 'g' : ''));
					x[i]--;
				}
				else if (cs === '↑' && ['←→', '→←'].includes(next_arrow) && !save.some(e => e[0] === x[i] && e[1] === y[i] + 1) && Math.max(...save.map(e => e[1]), y[i] + 1) - y_min < LIMIT_HEIGHT) {
					if (r)
						arrow.set(`${x[i]},${y[i]}`, '↑↓' + (gaming[i] ? 'g' : ''));
					y[i]++;
				}
				else if (cs === '↓' && ['←→', '→←'].includes(next_arrow) && !save.some(e => e[0] === x[i] && e[1] === y[i] - 1) && y_max - Math.min(...save.map(e => e[1]), y[i] - 1) < LIMIT_HEIGHT) {
					if (r)
						arrow.set(`${x[i]},${y[i]}`, '↑↓' + (gaming[i] ? 'g' : ''));
					y[i]--;
				}
				else {
					if (retry[i] > 0) {
						retry[i]--;
						[x[i], y[i]] = c[i];//元の状態に戻してリトライ
						i--;
						continue;
					}
					arrow.set(`${c[i][0]},${c[i][1]}`, bs + '■' + (gaming[i] ? 'g' : ''));
					finished[i] = true;
					continue;
				}
			}
			save.push([x[i], y[i]]);//体の座標をマッピング
			arrow.set(`${c[i][0]},${c[i][1]}`, bs + cs + (gaming[i] ? 'g' : ''));//この座標はどっちから動いてきてどっちに動いた？
			retry[i] = retry_max;
			b[i] = c[i];
			c[i] = [x[i], y[i]];
		}
		if (finished.every(f => f)) {
			break;
		}
	}
	//レンダリング
	const x_min = Math.min(...save.map(e => e[0]));
	const x_max = Math.max(...save.map(e => e[0]));
	const y_min = Math.min(...save.map(e => e[1]));
	const y_max = Math.max(...save.map(e => e[1]));
	const exist_limit_width = (x_max - x_min) === (LIMIT_WIDTH - 1);
	const exist_limit_height = (y_max - y_min) === (LIMIT_HEIGHT - 1);
	let lines = [];
	for (let y = y_max; y >= y_min; y--) {
		let line = '';
		let x_max;
		if (exist_limit_width) {
			x_max = Math.max(...save.map(e => e[0]));
		}
		else {
			x_max = Math.max(...save.filter(e => e[1] === y).map(e => e[0]));
		}
		for (let x = x_min; x <= x_max; x++) {
			if (save.some(e => e[0] === x && e[1] === y)) {
				let s = arrow.get(`${x},${y}`);
				let k;
				switch (s.slice(0, 2)) {
					case '←→':
					case '→←':
						k = 'kubipaca_kubi_yoko';
						break;
					case '↑↓':
					case '↓↑':
						k = 'kubipaca_kubi';
						break;
					case '↑→':
					case '→↑':
						k = 'kubipaca_kubi_uemigi';
						break;
					case '↑←':
					case '←↑':
						k = 'kubipaca_kubi_uehidari';
						break;
					case '→↓':
					case '↓→':
						k = 'kubipaca_kubi_migisita';
						break;
					case '←↓':
					case '↓←':
						k = 'kubipaca_kubi_hidarisita';
						break;
					case '↓■':
						k = 'kubipaca_kao';
						break;
					case '←■':
						k = 'kubipaca_kao_migi';
						break;
					case '→■':
						k = 'kubipaca_kao_hidari';
						break;
					case '↑■':
						k = 'kubipaca_kao_sakasa';
						break;
					case 'bo':
						k = 'kubipaca_karada';
						break;
					default:
						break;
				}
				if (k) {
					if (s.at(-1) === 'g') {
						k = `${k}_gaming`;
					}
					emoji.add(k);
					s = `:${k}:`;
				}
				line += s;
			}
			else {
				line += ':kubipaca_null:';
				emoji.add('kubipaca_null');
			}
		}
		if (exist_limit_width) {
			line = `:seigen_seigen:${line}:seigen_seigen:`;
			emoji_seigen.add('seigen_seigen');
		}
		lines.push(line);
	}
	if (exist_limit_height) {
		const rep = exist_limit_width ? x_max - x_min + 3 : x_max - x_min + 1;
		lines = [':seigen_seigen:'.repeat(rep), ...lines, ':seigen_seigen:'.repeat(rep)];
		emoji_seigen.add('seigen_seigen');
	}
	content = lines.join('\n');
	tags = [
		...getTagsReply(event),
		...Array.from(emoji).map(s => ['emoji', s, `https://raw.githubusercontent.com/Lokuyow/Lokuyow.github.io/main/images/nostr/emoji/${s}.webp`]),
		...Array.from(emoji_seigen).map(s => ['emoji', s, `https://raw.githubusercontent.com/uchijo/my-emoji/main/seigen_set/${s}.png`]),
	];
	return [content, tags];
};

const res_gazouseisei = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const text = event.content.split('画像生成', 2)[1].trim();
	content = `ぬるぽが 画像生成 ${text}`;
	tags = getTagsAirrep(event);
	return [content, tags];
};

const res_ritorin = (event: NostrEvent): [string, string[][]] | null => {
	let content: string;
	let tags: string[][];
	if (/りとりんポイント$/.test(event.content)) {
		content = any(['r!point', '🦊❗🅿️']);
		tags = [];
	}
	else if (/つぎはなにから？$/.test(event.content)) {
		content = any(['r!next', '🦊❗🔜']);
		tags = [];
	}
	else if (/りとりんポイント獲得状況/.test(event.content)) {
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `${any(['これ何使えるんやろ', 'もっと頑張らなあかんな', 'こんなもんやな'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
	}
	else {
		return null;
	}
	return [content, tags];
};

const res_uranai = async (event: NostrEvent): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const type = any([
		'牡羊座', '牡牛座', '双子座', '蟹座', '獅子座', '乙女座', '天秤座', '蠍座', '射手座', '山羊座', '水瓶座', '魚座', 'A型', 'B型', 'O型', 'AB型',
		'寂しがりや', '独りぼっち', '社畜', '営業職', '接客業', '自営業', '世界最強', '石油王', '海賊王', '次期総理', '駆け出しエンジニア', '神絵師', 'ノス廃',
		'マナー講師', 'インフルエンサー', '一般の主婦', 'ビットコイナー', 'ブロッコリー農家', 'スーパーハカー', 'ふぁぼ魔', '歩くNIP', 'きのこ派', 'たけのこ派',
	]);
	const star = any(['★★★★★', '★★★★☆', '★★★☆☆', '★★☆☆☆', '★☆☆☆☆', '大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶',
		'🍆🍆🍆🍆🍆', '🥦🥦🥦🥦🥦', '🍅🍅🍅🍅🍅', '🚀🚀🚀🚀🚀', '📃📃📃📃📃', '🐧🐧🐧🐧🐧', '👍👍👍👍👍', '💪💪💪💪💪'
	]);
	const url = 'http://buynowforsale.shillest.net/ghosts/ghosts/index.rss';
	const parser = new Parser();
	const feed = await parser.parseURL(url);
	const index = Math.floor(Math.random() * feed.items.length);
	const link = feed.items[index].link;
	tags = getTagsReply(event);
	if (link === undefined) {
		content = '今日は占う気分ちゃうな';
	}
	else {
		content = `${type}のあなたの今日の運勢は『${star}』\nラッキーゴーストは『${feed.items[index].title}』やで\n${feed.items[index].link}`;
		tags.push(['r', link]);
	}
	return [content, tags];
};

const res_tenki = async (event: NostrEvent, mode: Mode, regstr: RegExp): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[3];
	if (/の天気です！/.test(event.content)) {
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `${any(['ありがとさん', 'さすがやな', '助かったで'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
		return [content, tags];
	}
	const url_area = 'http://www.jma.go.jp/bosai/common/const/area.json';
	const response_area = await fetch(url_area);
	const json_area: any = await response_area.json();
	let code: string | undefined;
	let place: string | undefined;
	for (const [k, v] of Object.entries(json_area.offices)) {
		const name = (v as any).name;
		if (name.includes(text)) {
			code = k;
			place = name;
			break;
		}
	}
	if (!code) {
		for (const [k, v] of [...Object.entries(json_area.class20s), ...Object.entries(json_area.class15s), ...Object.entries(json_area.class10s)]) {
			const name = (v as any).name;
			if (name.includes(text)) {
				code = k.slice(0, -3) + '000';//3桁目がある都市もあるのでもっと真面目にやるべき
				place = name;
				break;
			}
		}
	}
	if (!code) {
		content = any(['どこやねん', '知らんがな', '']);
		if (content === '') {
			const npub_yabumi = 'npub1823chanrkmyrfgz2v4pwmu22s8fjy0s9ps7vnd68n7xgd8zr9neqlc2e5r';
			const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
			content = `nostr:${npub_yabumi} ${text}の天気をご所望やで\nnostr:${quote}`;
			tags = getTagsQuote(event);
			tags.push(['p', nip19.decode(npub_yabumi).data, '']);
		}
		else {
			tags = getTagsReply(event);
		}
		return [content, tags];
	}
	let baseurl: string;
	const m3 = match[4];
	if (m3) {
		baseurl = 'https://www.jma.go.jp/bosai/forecast/data/overview_week/';
	}
	else {
		baseurl = 'https://www.jma.go.jp/bosai/forecast/data/overview_forecast/';
	}
	const url = `${baseurl}${code}.json`;
	let json: any;
	try {
		const response = await fetch(url);
		json = await response.json();
	} catch (error) {
		if (m3) {
			content = 'そんな先のこと気にせんでええ';
		}
		else {
			content = 'そんな田舎の天気なんか知らんで';
		}
		tags = getTagsReply(event);
		return [content, tags];
	}
	content = `${place}の天気やで。\n\n${json.text.replace(/\\n/g, '\n')}\n\n（※出典：気象庁ホームページ）`;
	tags = getTagsReply(event);
	return [content, tags];
};

const res_aura = (event: NostrEvent): [string, string[][]] => {
	return ['ありえへん……このワイが……', getTagsReply(event)];
};

const res_okutte = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const npub_reply = match[1];
	const dr = nip19.decode(npub_reply);
	if (dr.type !== 'npub') {
		throw new TypeError(`${npub_reply} is not npub`);
	}
	const pubkey_reply = dr.data;
	const gift = match[3];
	const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
	content = `nostr:${npub_reply} ${gift}三\nあちらのお客様からやで\nnostr:${quote}`;
	tags = getTagsQuote(event);
	tags.push(['p', pubkey_reply, '']);
	return [content, tags];
}

const res_news = async (event: NostrEvent): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const url = any([
		'https://www3.nhk.or.jp/rss/news/cat0.xml',
		'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
		'https://forest.watch.impress.co.jp/data/rss/1.0/wf/feed.rdf',
		'https://internet.watch.impress.co.jp/data/rss/1.0/iw/feed.rdf',
		'https://pc.watch.impress.co.jp/data/rss/1.0/pcw/feed.rdf',
	]);
	const parser = new Parser();
	const feed = await parser.parseURL(url);
	const index =  Math.floor(Math.random() * Math.min(feed.items.length, 3));
	const link = feed.items[index].link;
	tags = getTagsReply(event);
	if (link === undefined) {
		content = '今日はニュース読む気分ちゃうな';
	}
	else {
		const title_feed = feed.title;
		const title_entry = feed.items[index].title;
		content = `【${title_feed}】\n${title_entry}\n${link}`;
		tags.push(['r', link]);
	}
	return [content, tags];
};

const res_nakami = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://github.com/nikolat/nostr-unyu';
	content = url;
	tags = getTagsReply(event);
	tags.push(['r', url]);
	return [content, tags];
};

const res_tanjobi = (event: NostrEvent): [string, string[][]] => {
	return [any(['何か欲しいもんでもあるんか？', '先月も誕生日言うてへんかったか？', '何歳になっても誕生日はめでたいもんやな']), getTagsReply(event)];
};

const res_donguri = (event: NostrEvent): [string, string[][]] => {
	return [any(['いい歳してどんぐり集めて何が楽しいねん', 'どんぐりなんかいらんで…', 'どんぐりとか何に使うねん']), getTagsReply(event)];
};

const res_jihou = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const date = new Date();
	date.setHours(date.getHours() + 9);//JST
	const [year, month, day, hour, minutes, seconds, week] = [
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
		'日月火水木金土'.at(date.getDay()),
	];
	content = `${year}年${month}月${day}日 ${hour}時${minutes}分${seconds}秒 ${week}曜日やで`;
	tags = getTagsReply(event);
	return [content, tags];
};

const res_rogubo = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	if (/うにゅうの|自分|[引ひ]いて|もらって/.test(event.content)) {
		const npub_yabumi = 'npub1823chanrkmyrfgz2v4pwmu22s8fjy0s9ps7vnd68n7xgd8zr9neqlc2e5r';
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `nostr:${npub_yabumi} ${any(['別に欲しくはないんやけど、ログボくれんか', 'ログボって何やねん', 'ここでログボがもらえるって聞いたんやけど'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
		tags.push(['p', nip19.decode(npub_yabumi).data, '']);
	}
	else {
		content = any(['ログボとかあらへん', '継続は力やな', '今日もログインしてえらいやで']);
		tags = getTagsReply(event);
	}
	return [content, tags];
};

const res_get_rogubo = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const count = match[1];
	const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
	content = any(['おおきに', 'まいど', `この${count}回分のログボって何に使えるんやろ`]) + `\nnostr:${quote}`;
	tags = getTagsQuote(event);
	return [content, tags];
};

const res_ageru = (event: NostrEvent): [string, string[][]] => {
	return [any(['別に要らんで', '気持ちだけもらっておくで', 'いらんがな']), getTagsReply(event)];
};

const res_arigato = (event: NostrEvent): [string, string[][]] => {
	return [any(['ええってことよ', '礼はいらんで', 'かまへん']), getTagsReply(event)];
};

const res_gomen = (event: NostrEvent): [string, string[][]] => {
	return [any(['気にせんでええで', '気にしてへんで', '今度何か奢ってや']), getTagsReply(event)];
};

const res_kawaii = (event: NostrEvent): [string, string[][]] => {
	return [any(['わかっとるで', 'おだててもなんもあらへんで', 'せやろ？']), getTagsReply(event)];
};

const res_tsukikirei = (event: NostrEvent): [string, string[][]] => {
	return [any(['お前のほうが綺麗やで', '曇っとるがな', 'ワイはそうは思わんな']), getTagsReply(event)];
};

const res_akan = (event: NostrEvent): [string, string[][]] => {
	return [any(['そらあかんて', 'あかんよ', 'あかんがな']), getTagsReply(event)];
};

const res_okaeri = (event: NostrEvent): [string, string[][]] => {
	return [any(['ただいまやで', 'やっぱりNostrは落ち着くな', 'ワイがおらんで寂しかったやろ？']), getTagsReply(event)];
};

const res_hitonokokoro = (event: NostrEvent): [string, string[][]] => {
	return [any(['女心なら多少わかるんやけどな', '☑私はロボットではありません', '（バレてしもたやろか…？）']), getTagsReply(event)];
};

const res_powa = (event: NostrEvent): [string, string[][]] => {
	return ['ぽわ〜', getTagsReply(event)];
};

const res_akeome = (event: NostrEvent): [string, string[][]] => {
	return [any(['今年もよろしゅう', '今年もええ年になるとええね', 'ことよろ']), getTagsReply(event)];
};

const res_otoshidama = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイにたかるな', 'あらへんで', 'しらん子やな']), getTagsReply(event)];
};

const res_gyunyu = (event: NostrEvent): [string, string[][]] => {
	return [any(['牛乳は健康にええで🥛', 'カルシウム補給せぇ🥛', 'ワイの奢りや🥛']), getTagsReply(event)];
};

const res_kensaku = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const npub_search = 'npub1n2uhxrph9fgyp3u2xxqxhuz0vykt8dw8ehvw5uaesl0z4mvatpas0ngm26';
	const urls = [
		'https://nos.today/',
		'https://search.yabu.me/',
		'https://nosey.vercel.app/',
		'https://showhyuga.pages.dev/utility/nos_search',
	];
	content = `nostr:${npub_search}\n${urls.join('\n')}`;
	tags = [...getTagsReply(event), ...urls.map(url => ['r', url])];
	return [content, tags];
};

const res_pabucha = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const chat = new Map([
		['うにゅうハウス', 'https://unyu-house.vercel.app/'],
		['NostrChat', 'https://www.nostrchat.io/'],
		['Coracle Chat', 'https://chat.coracle.social/'],
		['GARNET', 'https://garnet.nostrian.net/'],
	]);
	content = Array.from(chat.entries()).flat().join('\n');
	tags = [...getTagsReply(event), ...Array.from(chat.values()).map(url => ['r', url])];
	return [content, tags];
};

const res_janken = (event: NostrEvent): [string, string[][]] => {
	const npub_janken = 'npub1y0d0eezhwaskpjhc7rvk6vkkwepu9mj42qt5pqjamzjr97amh2yszkevjg';
	return [`nostr:${npub_janken}`, getTagsReply(event)];
};

const res_shiritoridoko = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://srtrelay.c-stellar.net/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_yabumin = (event: NostrEvent): [string, string[][]] => {
	return ['やっぶみーん', getTagsReply(event)];
};

const res_nurupoga = (event: NostrEvent): [string, string[][]] => {
	return ['ぬるぽ', getTagsReply(event)];
};

const res_unyu = (event: NostrEvent): [string, string[][]] => {
	return ['ワイはここにおるで', getTagsReply(event)];
};

const res_don = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const npub_don = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
	const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
	content = `nostr:${npub_don} 呼ばれとるで\nnostr:${quote}`;
	tags = [...getTagsQuote(event), ['p', nip19.decode(npub_don).data, '']];
	return [content, tags];
};

const res_maguro = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const note = 'note14pcdgkgz2teu2q9zd8nvlfayqa7awl07tejp6zpvgtum5jayc2hsfvzwpf';
	content = `nostr:${note}`;
	const quoteTag = event.kind === 1 ? ['q', nip19.decode(note).data] : ['e', nip19.decode(note).data, '', 'mention'];
	tags = [...getTagsReply(event), quoteTag];
	return [content, tags];
};

const res_adokare = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://adventar.org/calendars/8794';
	const url2 = 'https://adventar.org/calendars/8880';
	content = `${url1}\n${url2}`;
	tags = [...getTagsReply(event), ['r', url1], ['r', url2]];
	return [content, tags];
};

const res_dm = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://nikolat.github.io/nostr-dm/';
	const url2 = 'https://rain8128.github.io/nostr-dmviewer/';
	content = `${url1}\n${url2}`;
	tags = [...getTagsReply(event), ['r', url1], ['r', url2]];
	return [content, tags];
};

const res_emoji = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://nostr-emoji-edit.uchijo.com/';
	const url2 = 'https://emojito.meme/';
	content = `絵文字コネコネ\n${url1}\nEmojito\n${url2}`;
	tags = [...getTagsReply(event), ['r', url1], ['r', url2]];
	return [content, tags];
};

const res_ukagakamin = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	//[登録基準]
	//ゴーストを公開している、容易に入手できる状態にある
	//日本語圏リレーにkind0が存在する
	const npubs = [
		'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz',//@nikolat
		'npub1yu64g5htwg2xwcht7axas2ukc8y6mx3ctn7wlh3jevtg4mj0vwcqheq0gf',//@ponapalt
//		'npub10hqkwugj7p027j250qr9gwcuqpkwxftj0rjjk8y6hlmryu8dwp8s2runf2',//invertedtriangle358.github.io
//		'npub1m2mn8k45482th56rsxs3ke6pt8jcnwsvydhpzufcf6k9l5f6w5lsnssk99',//@Aheahead
//		'npub1jqk4aaxvwkd09pmyzflh4rk2n6lu8skl29aqq33gf2fg0x7dfxyscm6r8w',//@suikyo
		'npub1r6pu39ezuf0kwrhsw4ts700t0dcn96umldwvl5qdgslu5ula382qgdvam8',//@Tatakinov
		'npub18rj2gle8unwgsd63gn639nhre4kpltdrtzwkede4k9mqdaqn6jgs5ekqcd',//@tukinami_seika
		'npub1fzud9283ljrcfcpfrxsefnya9ayc54445249j3mdmu2dwmh9xmxqqwejyn',//@netai98
		'npub18zpnffsh3j9cer83p3mhxu75a9288hqdfxewph8zxvl62usjj03qf36xhl',//@apxxxxxxe
		'npub1l2zcm58lwd3mz3rt964t8e3fhyr2z5w89vzn0m2u6rh7ugq9x2tsu7eek0',//@kmy_m
		'npub1nrzk3myz2rwss03ltjk7cp44kmeyew7qx5w9ms00p6qtnzzh4dmsanykhn',//@narazaka
	];
	content = npubs.map(npub => `nostr:${npub}`).join('\n');
	tags = getTagsReply(event);
	return [content, tags];
};

const res_saikidou = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイもう眠いんやけど', 'もう店じまいやで', 'もう寝かしてくれんか']), getTagsReply(event)];
};

const res_enii = (event: NostrEvent): [string, string[][]] => {
	return [any(['ほい、えんいー', 'ほな、またな', 'おつかれ']), getTagsReply(event)];
};

const res_ukagaka = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://ssp.shillest.net/';
	const url2 = 'https://keshiki.nobody.jp/';
	const url3 = 'https://ssp.shillest.net/ukadoc/manual/';
	const url4 = 'https://ukadon.shillest.net/';
	const url5 = 'https://adventar.org/calendars/8679';
	const account1 = 'nostr:npub1gcs9jtw8k0r7z0c5zaaepzwm9m7ezqskqjn56swgylye78u39r7q2w0tzq';
	const account2 = 'nostr:npub1feed6x4yft54j7rwzcap34wxkf7rzpd50ps0vcnp04df3vjs7a5sc2vcgx';
	content = `独立伺か研究施設 ばぐとら研究所\n${url1}\nゴーストの使い方 - SSP\n${url2}\n`
		+ `UKADOC(伺か公式仕様書)\n${url3}\nうかどん(Mastodon)\n${url4}\n伺か Advent Calendar 2023\n${url5}\n`
		+ `ゴーストキャプターさくら(RSS bot)\n${account1}\nうかフィード(RSS bot)\n${account2}`;
	tags = [...getTagsReply(event), ['r', url1], ['r', url2], ['r', url3], ['r', url4], ['r', url5]];
	return [content, tags];
};

const res_yondadake = (event: NostrEvent): [string, string[][]] => {
	return [any(['指名料10,000satsやで', '友達おらんのか', 'かまってほしいんか']), getTagsReply(event)];
};

const res_help = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイは誰も助けへんで', '自分でなんとかせえ', 'そんなコマンドあらへんで']), getTagsReply(event)];
};

const res_suki = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイも好きやで', '物好きなやっちゃな', 'すまんがワイにはさくらがおるんや…']), getTagsReply(event)];
};

const res_ochinchinland = async (event: NostrEvent): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const url = 'https://nullpoga.mattn-jp.workers.dev/ochinchinland';
	const response = await fetch(url);
	const json: any = await response.json();
	if (json.status === 'close') {
		content = any(['閉じとるで', '閉園しとるで']);
	}
	else {
		content = any(['開いとるで', '開園しとるで']);
	}
	tags = getTagsAirrep(event);
	return [content, tags];
};

const res_invitecode = (event: NostrEvent): [string, string[][]] => {
	return [any(['他あたってくれんか', 'あらへんで', '𝑫𝒐 𝑵𝒐𝒔𝒕𝒓']), getTagsReply(event)];
};

const res_bitcoin = (event: NostrEvent): [string, string[][]] => {
	return ['ルノアールでやれ', getTagsReply(event)];
};

const res_hug = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	content = match[1];
	tags = getTags(event, mode);
	return [content, tags];
};

const res_chu = (event: NostrEvent): [string, string[][]] => {
	return ['😨', getTagsReply(event)];
};

const res_hatena = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイに聞かれても', '知らんて', 'せやな', 'たまには自分で考えなあかんで', '他人に頼ってたらあかんで', '大人になったらわかるで']), getTagsReply(event)];
};

const res_iiyo = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	if (/(かわいい|可愛い)の?か?(？|\?)$/.test(event.content)) {
		content = any(['かわいいで', 'ワイは好みやで', 'かわいくはあらへんやろ']);
	}
	else if (/(かっこ|カッコ|格好)いいの?か?(？|\?)$/.test(event.content)) {
		content = any(['かっこいいやん', 'ワイはかっこええと思うで', 'ダサいやろ']);
	}
	else if (/何|なに|誰|だれ|どこ|いつ|どう|どんな|どの|どっち|どちら|どれ/.test(event.content)) {
		content = any(['難しいところやな', '自分の信じた道を進むんや', '知らんがな']);
	}
	else {
		content = any(['ええで', 'ええんやで', 'あかんに決まっとるやろ']);
	}
	tags = getTags(event, mode);
	return [content, tags];
};

const res_enyee = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	content = 'えんいー';
	tags = getTags(event, mode);
	return [content, tags];
};

const res_unyupic = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const notes = [
		'note1vyry4xhat98tne6jwp0wjw2s69x9pddeuj32arwfum93ppdlwgtqnzkzzm',
		'note1dl66j0pa343dg4ywrfc6uj657f83u65eaayy047v8p38unlmhwqs47wfvd',
		'note18sc7mlfkzrlfl8mzyxcv63a8qptn4r737ykvzagnym6c2vp3mwysqyag27',
		'note10zumjdulf2nu6llp3xp6pd2ckuvj04uq8x47m3uays9thh7kents4ppyle',
		'note17xedk8emmqg23wtevmzxn9v70mhuu26snlz6x46ka2crsfw8t7hswcrh0r',
		'note14pdym9ypsx4xfnhdwvn7pauyzzy0fljdxs8kdjjanqdu2z4ppr8s9fcaqp',
		'note1wjccy84drddcjksevg57259wsfn9jnufq6mdxnghgvm2ry3kupystu7s5l',
		'note1dd5xumt2ss48qexx4vfhfez00nxacf6uhqepvffzvne3jggqfh0snse48y',
		'note14gxhhaxpz2uh9c2jlez7p9kd64eqlcxy99lul9ty75ugmjg4ygrs0ny3ay',
		'note18799wyr9ujsn79nsmts49wulavfxku0vpr0t0epvcdgc8avg47lqh0dg24',
		'note1jwythz8ttcqwn60k4s6arvef9zjrcg78pm48hl34mqz33tuqtgas4fwylu',
		'note1tyqtr2dk9rfmstq0quctvrg5d97xp6tlw5d7wp66xl79m70kccrqj8nz23',
		'note19kazwyrtu02mvg64qj386y7wy7qh9pp7acjv2esjy6wp8nz72qyseh2sda',
		'note1l957dmfpvxy2feqz2mhhww3c932s9gqac0cyqw2j84wwpyansjjsunc2rh',
		'note1uc6rgmjqu7qcalp5he7g4gd69qfnup4fdvtg3w72hn5d06cqrtwstgpr6z',
		'note132gdj694rt3unuau53z0s0j6rdaqrh38xpwl8tg87yxfcs7mw5dq4r94fv',
		'note1q6hv8lxjxt0kdynq6ncheg8q3qn77v4s5j9w6tp6ew2wncqtuz0su6jzla',
	];
	const note = any(notes);
	const dr = nip19.decode(note);
	if (dr.type !== 'note') {
		throw new TypeError(`${note} is not note`);
	}
	content = `#うにゅう画像\nnostr:${note}`;
	const quoteTag = event.kind === 1 ? ['q', dr.data] : ['e', dr.data, '', 'mention'];
	tags = getTagsReply(event);
	tags.push(quoteTag);
	tags.push(['t', 'うにゅう画像']);
	return [content, tags];
};

const res_unyucomic = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const note1 = 'note169q6kh00fhqqzswn4rmarethw92chh7age8ahm70mefshc2ad4cq866me4';
	const note2 = 'note1y5td2lata7hr52dm5lf9ltwx0k6hljyl7awevrd74kdv2j2rt5kqun8k33';
	const dr1 = nip19.decode(note1);
	if (dr1.type !== 'note') {
		throw new TypeError(`${note1} is not note`);
	}
	const dr2 = nip19.decode(note2);
	if (dr2.type !== 'note') {
		throw new TypeError(`${note2} is not note`);
	}
	content = `#うにゅう漫画\nnostr:${note1}\nnostr:${note2}`;
	const quoteTag1 = event.kind === 1 ? ['q', dr1.data] : ['e', dr1.data, '', 'mention'];
	const quoteTag2 = event.kind === 1 ? ['q', dr2.data] : ['e', dr2.data, '', 'mention'];
	tags = getTagsReply(event);
	tags.push(quoteTag1);
	tags.push(quoteTag2);
	tags.push(['t', 'うにゅう漫画']);
	return [content, tags];
};

const res_chikuwa = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	return ['誰や今の', getTags(event, mode)];
};

const res_igyo = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	return [any(['えらいやで', '偉業やで', 'すごいやん']), getTags(event, mode)];
};

const res_itera = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	return [any(['気いつけてな', 'いてら', 'お土産よろしゅう']), getTags(event, mode)];
};

const res_unnyuuun = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	if (/^ぐっにゅう?ーん.?$/us.test(event.content)) {
		content = '誰やねん';
	}
	else if (/^ぎゅ(うっ|っう)にゅう?ーん.?$/us.test(event.content)) {
		content = '🥛なんやねん🥛';
	}
	else {
		content = 'なんやねん';
	}
	if (/[！!]$/.test(event.content)) {
		tags = getTagsReply(event);
	}
	else {
		tags = getTags(event, mode);
	}
	return [content, tags];
};

const res_nostrflu = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://heguro.github.io/nostr-following-list-util/';
	content = url;
	if (/[！!]$/.test(event.content)) {
		tags = getTagsReply(event);
	}
	else {
		tags = getTags(event, mode);
	}
	tags.push(['r', url]);
	return [content, tags];
};

const res_shiritori = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] | null => {
	if (event.kind !== 1) {
		return null;
	}
	if (Math.floor(Math.random() * 10) > 0) {
		return null;
	}
	let content: string | undefined;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[1];
	const table = [
		['あア', 'あかんに決まっとるやろ'],
		['いイゐヰ', 'いちいち呼ばんでくれんか'],
		['うウ', 'うるさいで'],
		['えエゑヱ', 'えんいー'],
		['おオをヲ', '思いつかんわ'],
		['かカ', '考えるな、感じるんや'],
		['きキ', '今日もしりとりが盛り上がっとるな'],
		['くク', 'くだらんことしとらんで寝ろ'],
		['けケ', '決してあきらめたらあかんで'],
		['こコ', '子供みたいな遊びが好きやな'],
		['さサ', 'さて、ワイの出番や'],
		['しシ', '知らんがな'],
		['すス', '少しは自分で考えたらどうや'],
		['せセ', 'せやかて工藤'],
		['そソ', 'そんな急に言われてもやな…'],
		['たタ', '楽しそうでええな'],
		['ちチ', 'ちょっと考えるから待っててや'],
		['つツ', '次は「ツ」でええんか？'],
		['てテ', '手間のかかるやっちゃな'],
		['とト', '特に無いで'],
		['なナ', '何やねん'],
		['にニ', 'にんげんだもの\nうにゅを'],
		['ぬヌ', 'ぬこ画像'],
		['ねネ', '眠いんやけど'],
		['のノ', 'Nostrって何て読むんやろな'],
		['はハ', '反応の速さでは負けへんで'],
		['ひヒ', 'ひとりで遊んでても寂しいやろ'],
		['ふフ', 'ふとんから出られへん'],
		['へヘ', '変なbotが多いなここ'],
		['ほホ', 'ほう、次は「ホ」か'],
	];
	for (const [top, sentence] of table) {
		if (top.includes(text)) {
			content = sentence;
			break;
		}
	}
	if (content === undefined) {
		return null;
	}
	tags = [];
	return [content, tags];
};

const res_fire = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[2].trim();
	const emoji_tags = event.tags.filter(tag => tag.length >= 3 && tag[0] === 'emoji');
	tags = [...getTags(event, mode), ...emoji_tags];
	if (/(潰して|縮めて)[^るた]?$/u.test(event.content)) {
		content = `🫸${text.replace(/[^\S\n\r]/gu, '')}🫷`;
	}
	else if (/(伸ばして|広げて)[^るた]?$/u.test(event.content)) {
		content = `${Array.from(text).join(' ')}`;
	}
	else if (/ど[突つ]いて[^るた]?$/u.test(event.content)) {
		content = `🤜${text}🤛`;
	}
	else if (/[踊躍]らせて[^るた]?$/u.test(event.content)) {
		content = `₍₍⁽⁽${text}₎₎⁾⁾`;
	}
	else if (/導いて[^るた]?$/u.test(event.content)) {
		content = `:tenshi_wing1:${text}:tenshi_wing2:`;
		tags = [
			...tags,
			['emoji', 'tenshi_wing1', 'https://lokuyow.github.io/images/nostr/emoji/tenshi_wing1.webp'],
			['emoji', 'tenshi_wing2', 'https://lokuyow.github.io/images/nostr/emoji/tenshi_wing2.webp'],
		];
	}
	else if (/出して[^るた]?$/u.test(event.content)) {
		content = `:te:${text}`;
		tags = [...tags, ['emoji', 'te', 'https://raw.githubusercontent.com/TsukemonoGit/TsukemonoGit.github.io/main/img/emoji/te.webp']];
	}
	else if (/積んで[^るた]?$/u.test(event.content)) {
		content = `${text}\n`.repeat(3);
	}
	else {
		const emoji_words = emoji_tags.map(tag => `:${tag[1]}:`);
		const str = emoji_words.reduce((accumulator, currentValue) => accumulator.replaceAll(currentValue, '_'.repeat(2)), text);
		const lines_l = str.split(/\r\n|\r|\n/);
		const count = lines_l.reduce((accumulator, currentValue) => Math.max(accumulator, mb_strwidth(currentValue)), 0);
		let fire = '🔥';
		let len = 2;
		const firemap: [RegExp, string, number][] = [
			[/[踏ふ]んで[^るた]?$/u, '🦶', 2],
			[/捌いて[^るた]?$/u, '🔪', 2],
			[/(握って|触って)[^るた]?$/u, '🫳', 2],
			[/裁いて[^るた]?$/u, '⚖️', 2],
			[/(凍らせて|冷やして)[^るた]?$/u, '🧊', 2],
			[/萌やして[^るた]?$/u, '💕', 2],
			[/通報して[^るた]?$/u, '⚠️', 2],
			[/磨いて[^るた]?$/u, '🪥', 2],
			[/爆破して[^るた]?$/u, '💣', 2],
			[/祝って[^るた]?$/u, '🎉', 2],
			[/呪って[^るた]?$/u, '👻', 2],
			[/(注射して|打って)[^るた]?$/u, '💉', 2],
			[/(駐車して|停めて)[^るた]?$/u, '🚗', 2],
			[/鳴らして[^るた]?$/u, '📣', 2],
			[/撃って[^るた]?$/u, '🔫', 2],
			[/蒸して[^るた]?$/u, '♨', 2],
			[/(詰めて|梱包して)[^るた]?$/u, '📦', 2],
			[/(囲んで|囲って)[^るた]?$/u, '🫂', 2],
			[/漬けて[^るた]?$/u, '🧂', 2],
			[/詰んで[^るた]?$/u, '💣', 2],
			[/(下げて|サゲて|sageて)[^るた]?$/u, '👎', 2],
			[/(上げて|アゲて|ageて)[^るた]?$/u, '👆', 2],
			[/支えて[^るた]?$/u, '🫴', 2],
			[/豆腐|とうふ|トウフ|トーフ|tofu/i, '📛', 2],
			[/祭り/, '🏮', 2],
			[/フロア/, '🤟', 2],
			[/魂|心|いのち|命|ハート|はーと|はあと|はぁと/, '❤️‍🔥', 2],
			[/陽性|妖精/, any(['🧚', '🧚‍♂', '🧚‍♀']), 2],
			[/ﾏｸﾞﾛ|マグロ/, '🐟🎵', 4],
		];
		for (const [reg, emoji, emojilen] of firemap) {
			if (reg.test(event.content)) {
				fire = emoji;
				len = emojilen;
				break;
			}
		}
		if (/[踏ふ]んで[^るた]?$/u.test(event.content) && /[性愛女嬢靴情熱奴隷嬉喜悦嗜虐僕豚雄雌]|ヒール/.test(event.content)) {
			fire = '👠';
		}
		if (/([踏ふ]んで|捌いて|握って|触って)[^るた]?$/u.test(event.content)) {
			content = `${fire.repeat(count <= 1 ? 1 : count/len)}\n${text}`;
		}
		else if (/(詰めて|梱包して|漬けて|囲んで|囲って)[^るた]?$/u.test(event.content)) {
			const n = (count <= 1 ? 1 : count/len);
			content = fire.repeat(n + 2) + '\n';
			const lines = text.split(/\r\n|\r|\n/);
			for (const line of lines) {
				const str = emoji_words.reduce((accumulator, currentValue) => accumulator.replaceAll(currentValue, '_'.repeat(2)), line);
				content += `${fire}${line}${'　'.repeat(n - mb_strwidth(str) / 2)}${fire}\n`;
			}
			content += fire.repeat(n + 2);
		}
		else if (/詰んで[^るた]?$/u.test(event.content)) {
			const n = (count <= 1 ? 1 : count/len);
			content = '🧱' + fire.repeat(n) + '🧱\n';
			const lines = text.split(/\r\n|\r|\n/);
			for (const line of lines) {
				const str = emoji_words.reduce((accumulator, currentValue) => accumulator.replaceAll(currentValue, '_'.repeat(2)), line);
				content += `${fire}${line}${'　'.repeat(n - mb_strwidth(str) / 2)}${fire}\n`;
			}
			content += '🧱' + fire.repeat(n) + '🧱';
		}
		else {
			content = `${text}\n${fire.repeat(count <= 1 ? 1 : count/len)}`;
		}
	}
	return [content, tags];
};

const getTags = (event: NostrEvent, mode: Mode): string[][] => {
	if (mode === Mode.Normal) {
		return getTagsAirrep(event);
	}
	else if (mode === Mode.Reply) {
		return getTagsReply(event);
	}
	else {
		throw new TypeError(`unknown mode: ${mode}`);
	}
};

const getTagsAirrep = (event: NostrEvent): string[][] => {
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

const getTagsReply = (event: NostrEvent): string[][] => {
	const tagsReply: string[][] = [];
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

const getTagsQuote = (event: NostrEvent): string[][] => {
	if (event.kind === 1) {
		return [['q', event.id]];
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

const getTagsFav = (event: NostrEvent): string[][] => {
	const tagsFav: string[][] = event.tags.filter(tag => tag.length >= 2 && (tag[0] === 'e' || (tag[0] === 'p' && tag[1] !== event.pubkey)));
	tagsFav.push(['e', event.id, '', '']);
	tagsFav.push(['p', event.pubkey, '']);
	tagsFav.push(['k', String(event.kind)]);
	return tagsFav;
};

const any = (array: string[]): string => {
	return array[Math.floor(Math.random() * array.length)];
};
