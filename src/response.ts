import { type EventTemplate, type VerifiedEvent, type Event as NostrEvent, nip19 } from 'nostr-tools';
import { mb_strwidth } from "@demouth/mb_strwidth";
import Parser from 'rss-parser';
import { Mode, Signer } from './utils';

export const getResponseEvent = async (requestEvent: NostrEvent, signer: Signer, mode: Mode): Promise<VerifiedEvent | null> => {
	if (requestEvent.pubkey === signer.getPublicKey()) {
		//自分自身の投稿には反応しない
		return null;
	}
	const res = await selectResponse(requestEvent, mode);
	if (res === null) {
		//反応しないことを選択
		return null;
	}
	return signer.finishEvent(res);
};

const selectResponse = async (event: NostrEvent, mode: Mode): Promise<EventTemplate | null> => {
	if (!isAllowedToPost(event)) {
		return null;
	}
	let res;
	switch (mode) {
		case Mode.Normal:
			res = await mode_normal(event);
			break;
		case Mode.Reply:
			res = await mode_reply(event);
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
	];
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

const getResmap = (mode: Mode): [RegExp, (event: NostrEvent, mode: Mode, regstr: RegExp) => Promise<[string, string[][]]> | [string, string[][]]][] => {
	const resmapNormal: [RegExp, (event: NostrEvent, mode: Mode, regstr: RegExp) => [string, string[][]]][] = [
		[/いいの?か?(？|\?)$/, res_iiyo],
		[/\\e$/, res_enyee],
		[/^うにゅう画像$/, res_unyupic],
		[/^ちくわ大明神$/, res_chikuwa],
		[/(ほめて|褒めて|のでえらい).?$/u, res_igyo],
		[/[行い]っ?てきます.?$/u, res_itera],
		[/^((う|ぐ)っにゅう?ーん|ぎゅ(うっ|っう)にゅう?ーん).?$/u, res_unnyuuun],
		[/(フォロー|ふぉろー)[飛と]んだ.?$/u, res_nostrflu],
		[/^(.{1,100})[をに]([燃萌も]やして|焼いて|煮て|炊いて|凍らせて|冷やして|通報して|火を[付つ]けて|磨いて|爆破して|注射して|打って|駐車して|停めて|潰して|ど[突つ]いて|[踏ふ]んで)[^るた]?$/us, res_fire],
	];
	const resmapReply: [RegExp, (event: NostrEvent, mode: Mode, regstr: RegExp) => Promise<[string, string[][]]> | [string, string[][]]][] = [
		[/占って|占い/, res_uranai],
		[/(^|\s+)(\S+)の(週間)?天気/, res_tenki],
		[/(npub\w{59})\s?(さん)?に(.{1,50})を/us, res_okutte],
		[/ニュース/, res_news],
		[/中身/, res_nakami],
		[/時刻|時報|日時|何時/, res_jihou],
		[/ログボ|ログインボーナス/, res_rogubo],
		[/あなたの合計ログイン回数は(\d+)回です。/, res_get_rogubo],
		[/(もらって|あげる|どうぞ).?$/u, res_ageru],
		[/ありが(と|て)|(たす|助)か(る|った)/, res_arigato],
		[/ごめん|すまん/, res_gomen],
		[/かわいい|可愛い|すごい|かっこいい|えらい|偉い|かしこい|賢い|最高/, res_kawaii],
		[/あかんの?か/, res_akan],
		[/人の心/, res_hitonokokoto],
		[/ぽわ/, res_powa],
		[/おはよ/, res_ohayo],
		[/牛乳|ぎゅうにゅう/, res_gyunyu],
		[/検索(を?呼んで|どこ).?$/u, res_kensaku],
		[/(パブ|ぱぶ)(リック)?(チャ|ちゃ|茶)(ット)?(を?呼んで|どこ).?$/u, res_pabucha],
		[/(じゃんけん|ジャンケン|淀川(さん)?)(を?呼んで|どこ).?$/u, res_janken],
		[/やぶみ(ちゃ)?ん?(を?呼んで|どこ).?$/u, res_yabumin],
		[/ぬるぽが?(を?呼んで|どこ).?$/u, res_nurupoga],
		[/うにゅう(を?呼んで|どこ).?$/u, res_unyu],
		[/Don(さん)?(を?呼んで|どこ).?$/ui, res_don],
		[/再起動/, res_saikidou],
		[/えんいー/, res_enii],
		[/[呼よ](んだだけ|んでみた)|(何|なん)でもない/, res_yondadake],
		[/ヘルプ|へるぷ|help|(助|たす)けて|(教|おし)えて|手伝って/i, res_help],
		[/すき|好き|愛してる|あいしてる/, res_suki],
		[/ランド|開いてる|閉じてる|開園|閉園/, res_ochinchinland],
		[/招待コード/, res_invitecode],
		[/(🫂|🤗)/, res_hug],
		[/[💋💕]/, res_chu],
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

const mode_normal = async (event: NostrEvent): Promise<[string, number, string[][]] | null> => {
	//自分への話しかけはreplyで対応する
	//自分以外に話しかけている場合は割り込まない
	if (event.tags.some(tag => tag.length >= 2 && (tag[0] === 'p'))) {
		return null;
	}
	const resmap = getResmap(Mode.Normal);
	for (const [reg, func] of resmap) {
		if (reg.test(event.content)) {
			const [content, tags] = await func(event, Mode.Normal, reg);
			return [content, event.kind, tags];
		} 
	}
	return null;
};

const mode_reply = async (event: NostrEvent): Promise<[string, number, string[][]] | null> => {
	const resmap = getResmap(Mode.Reply);
	for (const [reg, func] of resmap) {
		if (reg.test(event.content)) {
			const [content, tags] = await func(event, Mode.Reply, reg);
			return [content, event.kind, tags];
		} 
	}
	return ['えんいー', event.kind, getTagsAirrep(event)];
};

const mode_fav = (event: NostrEvent): [string, number, string[][]] | null => {
	const reactionmap: [RegExp, string][] = [
		[/ぎゅうにゅう/, '🥛'],
		[/うにゅう(?!ハウス)/, ':unyu:'],
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
			return [content, kind, tags];
		} 
	}
	return null;
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
	const index =  Math.floor(Math.random() * feed.items.length);
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
	const text = match[2];
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
			tags = getTagsAirrep(event);
			tags.push(['p', nip19.decode(npub_yabumi).data, '']);
		}
		else {
			tags = getTagsReply(event);
		}
		return [content, tags];
	}
	let baseurl: string;
	const m3 = match[3];
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
	tags = getTagsAirrep(event);
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
		tags = getTagsAirrep(event);
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
	tags = getTagsAirrep(event);
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

const res_akan = (event: NostrEvent): [string, string[][]] => {
	return [any(['そらあかんて', 'あかんよ', 'あかんがな']), getTagsReply(event)];
};

const res_hitonokokoto = (event: NostrEvent): [string, string[][]] => {
	return [any(['女心なら多少わかるんやけどな', '☑私はロボットではありません', '（バレてしもたやろか…？）']), getTagsReply(event)];
};

const res_powa = (event: NostrEvent): [string, string[][]] => {
	return ['ぽわ〜', getTagsReply(event)];
};

const res_ohayo = (event: NostrEvent): [string, string[][]] => {
	const date = new Date();
	date.setHours(date.getHours() + 9);//JST
	return [any(['おはようやで', 'ほい、おはよう', `もう${date.getHours()}時か、おはよう`]), getTagsReply(event)];
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
	tags = [...getTagsAirrep(event), ['p', nip19.decode(npub_don).data, '']];
	return [content, tags];
};

const res_saikidou = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイもう眠いんやけど', 'もう店じまいやで', 'もう寝かしてくれんか']), getTagsReply(event)];
};

const res_enii = (event: NostrEvent): [string, string[][]] => {
	return [any(['ほい、えんいー', 'ほな、またな', 'おつかれ']), getTagsReply(event)];
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

const res_hug = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	content = match[1];
	tags = getTagsAirrep(event);
	return [content, tags];
};

const res_chu = (event: NostrEvent): [string, string[][]] => {
	return ['😨', getTagsReply(event)];
};

const res_hatena = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイに聞かれても', '知らんて', 'せやな']), getTagsReply(event)];
};

const res_iiyo = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	if (/何|なに|誰|だれ|どこ|いつ|どう|どの|どっち|どちら|どれ/.test(event.content)) {
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
	];
	const note = any(notes);
	const dr = nip19.decode(note);
	if (dr.type !== 'note') {
		throw new TypeError(`${note} is not note`);
	}
	content = `#うにゅう画像\nnostr:${note}`;
	tags = getTagsReply(event);
	tags.push(['e', dr.data, '', 'mention']);
	tags.push(['t', 'うにゅう画像']);
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

const res_fire = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[1].trim();
	const emoji_tags = event.tags.filter(tag => tag.length >= 3 && tag[0] === 'emoji');
	if (/潰して[^るた]?$/us.test(event.content)) {
		content = `🫸${text.replace(/[^\S\n\r]/gu, '') }🫷`;
	}
	else if (/ど[突つ]いて[^るた]?$/us.test(event.content)) {
		content = `🤜${text}🤛`;
	}
	else {
		const emoji_words = emoji_tags.map(tag => `:${tag[1]}:`);
		const str = emoji_words.reduce((accumulator, currentValue) => accumulator.replace(new RegExp(currentValue, 'g'), '_'.repeat(2)), text);
		const lines = str.split(/\r\n|\r|\n/);
		const count = lines.reduce((accumulator, currentValue) => Math.max(accumulator, mb_strwidth(currentValue)), 0);
		let fire = '🔥';
		const firemap = {
			'[踏ふ]んで[^るた]?$': '🦶',
			'(凍らせて|冷やして)[^るた]?$': '🧊',
			'萌やして[^るた]?$': '💕',
			'通報して[^るた]?$': '⚠️',
			'磨いて[^るた]?$': '🪥',
			'爆破して[^るた]?$': '💣',
			'(注射して|打って)[^るた]?$': '💉',
			'(駐車して|停めて)[^るた]?$': '🚗',
			'豆腐|とうふ|トウフ|トーフ|tofu': '📛',
			'魂|心|いのち|命|ハート|はーと|はあと|はぁと': '❤️‍🔥',
			'陽性|妖精': any(['🧚', '🧚‍♂', '🧚‍♀']),
		};
		for (const [key, value] of Object.entries(firemap)) {
			if ((new RegExp(key, 'ui')).test(event.content)) {
				fire = value;
				break;
			} 
		}
		if (/[踏ふ]んで.?$/us.test(event.content)) {
			if (/[性愛女嬢靴情熱奴隷嬉喜悦嗜虐僕豚雄雌]|ヒール/us.test(event.content)) {
				fire = '👠';
			}
			content = `${fire.repeat(count <= 1 ? 1 : count/2)}\n${text}`;
		}
		else {
			content = `${text}\n${fire.repeat(count <= 1 ? 1 : count/2)}`;
		}
	}
	tags = [...getTags(event, mode), ...emoji_tags];
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
