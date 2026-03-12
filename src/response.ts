import { Mode } from './utils.js';
import mb_strwidth from './mb_strwidth.js';
import Parser from 'rss-parser';
import type { Filter } from 'nostr-tools/filter';
import { Relay } from 'nostr-tools/relay';
import { hexToBytes } from 'nostr-tools/utils';
import {
	verifyEvent,
	type EventTemplate,
	type NostrEvent,
	type VerifiedEvent
} from 'nostr-tools/pure';
import type { Signer } from 'nostr-tools/signer';
import * as nip19 from 'nostr-tools/nip19';
import { nip47 } from 'nostr-tools';
import * as nip57 from 'nostr-tools/nip57';

const zapBroadcastRelays = [
	'wss://relay-jp.nostr.wirednet.jp/',
	'wss://relay.nostr.wirednet.jp/',
	'wss://yabu.me/'
];
const badgeRelays = [
	'wss://yabu.me/',
	'wss://relay-jp.nostr.wirednet.jp/',
	'wss://nrelay.c-stellar.net/'
];
const pollRelays = ['wss://yabu.me/', 'wss://nostr.compile-error.net/'];
const profileRelay = 'wss://yabu.me/';
const shogiRelay = 'wss://yabu.me/';
const zapCheckRelay = 'wss://yabu.me/';
const emojiSearchRelay = 'wss://yabu.me/';
const followSearchRelay = 'wss://yabu.me/';

export const getResponseEvent = async (
	requestEvent: NostrEvent,
	signer: Signer,
	mode: Mode
): Promise<VerifiedEvent[] | null> => {
	if (requestEvent.pubkey === (await signer.getPublicKey())) {
		//自分自身の投稿には反応しない
		return null;
	}
	const res: EventTemplate[] | null = await selectResponse(requestEvent, mode, signer);
	if (res === null) {
		//反応しないことを選択
		return null;
	}
	const events: VerifiedEvent[] = await Promise.all(
		res.map(async (r) => await signer.signEvent(r))
	);
	return events;
};

const selectResponse = async (
	event: NostrEvent,
	mode: Mode,
	signer: Signer
): Promise<EventTemplate[] | null> => {
	if (!isAllowedToPost(event)) {
		return null;
	}
	let res: EventTemplate | null;
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
		case Mode.Zap:
			res = await mode_zap(event, signer);
			break;
		case Mode.Delete:
			res = await mode_delete(event);
			break;
		default:
			throw new TypeError(`unknown mode: ${mode}`);
	}
	if (res === null) {
		return null;
	}
	if (isNsecPost(event)) {
		res = {
			content: '\\s[11]お前……秘密鍵を漏らすのは……あかんに決まっとるやろ！！',
			kind: event.kind,
			tags: getTags(event, mode),
			created_at: event.created_at + 1
		};
	}
	if (/^\\s\[\d+\]/.test(res.content)) {
		const match = res.content.match(/^\\s\[(\d+)\]/);
		if (match === null) {
			throw new Error();
		}
		const surface = parseInt(match[1]);
		if ([10, 11].includes(surface)) {
			const npub_don = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
			const npub_awayuki = 'npub1e4qg56wvd3ehegd8dm7rlgj8cm998myq0ah8e9t5zeqkg7t7s93q750p76';
			const date = new Date();
			date.setHours(date.getHours() + 9); //JST
			const [year, month, day, hour, minutes, seconds, week] = [
				date.getFullYear(),
				date.getMonth() + 1,
				date.getDate(),
				date.getHours(),
				date.getMinutes(),
				date.getSeconds(),
				'日月火水木金土'.at(date.getDay())
			];
			const kind0: EventTemplate = {
				content: JSON.stringify({
					about: `うにゅうやで\n※自動返信BOTです\n管理者: nostr:${npub_don}\nアイコン: nostr:${npub_awayuki} さん`,
					bot: true,
					display_name: 'うにゅう',
					lud16: 'nikolat@coinos.io',
					name: 'unyu',
					nip05: 'unyu@nikolat.github.io',
					picture: `https://nikolat.github.io/avatar/unyu-${surface}.png`,
					website: 'https://nikolat.github.io/',
					birthday: {
						month,
						day
					}
				}),
				kind: 0,
				tags: [],
				created_at: event.created_at + 1
			};
			res.content = res.content.replace(/^\\s\[\d+\]/, '');
			return [kind0, res];
		}
	}
	if (/^\\_a/.test(res.content)) {
		const kind10002: EventTemplate = {
			content: '',
			kind: 10002,
			tags: [
				['r', 'wss://relay-jp.nostr.wirednet.jp/'],
				['r', 'wss://yabu.me/'],
				['r', 'wss://nostr.compile-error.net/']
			],
			created_at: event.created_at + 1
		};
		res.content = res.content.replace(/^\\_a/, '');
		return [kind10002, res];
	}
	if (/^\\b$/.test(res.content)) {
		const r = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'r')?.at(1) ?? '';
		if (!URL.canParse(r)) {
			return [
				{
					content: 'rタグが必要や',
					kind: event.kind,
					tags: getTags(event, mode),
					created_at: event.created_at + 1
				}
			];
		}
		const url = new URL(r);
		if (url.search !== '' || url.hash !== '' || r.endsWith('?') || r.endsWith('#')) {
			return [
				{
					content: 'https://example.com/ みたいな形式で頼むで',
					kind: event.kind,
					tags: getTags(event, mode),
					created_at: event.created_at + 1
				}
			];
		}
		const hasnTags = Array.from(
			new Set<string>(
				event.tags
					.filter((tag) => tag.length >= 2 && tag[0] === 't')
					.map((tag) => tag[1].toLowerCase())
			)
		);
		const identifier = r.replace(/^https?:\/\//, '');
		const pubkey = await signer.getPublicKey();
		const kind = 39701;
		const kind39701: EventTemplate = {
			content: '',
			kind,
			tags: [
				['d', identifier],
				['published_at', String(Math.floor(Date.now() / 1000))],
				...hasnTags.map((t) => ['t', t])
			],
			created_at: event.created_at + 1
		};
		const naddr: string = nip19.naddrEncode({
			identifier,
			pubkey,
			kind,
			relays: pollRelays
		});
		res.content = `ブックマークしといたで\nnostr:${naddr}`;
		res.tags.push(['q', `${kind}:${pubkey}:${identifier}`, pollRelays[0]]);
		return [kind39701, res];
	}
	if (/^\\!\[\*\]$/.test(res.content)) {
		let badgeEvent: EventTemplate;
		if (/バッジ$/.test(event.content)) {
			badgeEvent = getBadgeEventTemplate(event);
		} else if (/バッジを授与して/.test(event.content)) {
			badgeEvent = getOthersBadgeEventTemplate(event);
		} else {
			return null;
		}
		const badgeEventSigned: VerifiedEvent = await signer.signEvent(badgeEvent);
		const nevent: string = nip19.neventEncode({
			...badgeEventSigned,
			author: badgeEventSigned.pubkey,
			relays: badgeRelays
		});
		if (/バッジ$/.test(event.content)) {
			res.content = `ワイのバッジやで\nnostr:${nevent}`;
		} else if (/バッジを授与して/.test(event.content)) {
			res.content = `勝手に授与してええんやろか？\nnostr:${nevent}`;
		}
		res.tags.push(['q', badgeEventSigned.id, badgeRelays[0], badgeEventSigned.pubkey]);
		return [badgeEvent, res];
	}
	if (/^\\__q$/.test(res.content)) {
		const pollEvent: EventTemplate = getPollEventTemplate(event, pollRelays);
		const pollEventSigned: VerifiedEvent = await signer.signEvent(pollEvent);
		const nevent: string = nip19.neventEncode({
			...pollEventSigned,
			author: pollEventSigned.pubkey,
			relays: pollRelays
		});
		const pollUrl1 = `https://pollerama.fun/respond/${nevent}`;
		const pollUrl2 = `https://nostr-poll.compile-error.net/?id=${nevent}`;
		res.content = `アンケートやで\nnostr:${nevent}\n${pollUrl1}\n${pollUrl2}`;
		res.tags.push(['q', pollEventSigned.id, pollRelays[0], pollEventSigned.pubkey]);
		res.tags.push(['r', pollUrl1]);
		res.tags.push(['r', pollUrl2]);
		return [pollEvent, res];
	}
	if (/^\\_b$/.test(res.content)) {
		const g: string = event.content.split(' ').at(1)!;
		const kind20000: EventTemplate = {
			content: '邪魔するで',
			kind: 20000,
			tags: [
				['g', g],
				['n', 'うにゅう(bot)'],
				['t', 'teleport']
			],
			created_at: event.created_at + 1
		};
		return [kind20000];
	}
	return [res];
};

const isAllowedToPost = (event: NostrEvent) => {
	const allowedChannel = [
		'be8e52c0c70ec5390779202b27d9d6fc7286d0e9a2bc91c001d6838d40bafa4a', //Nostr伺か部
		'8206e76969256cd33277eeb00a45e445504dfb321788b5c3cc5d23b561765a74', //うにゅうハウス開発
		'330fc57e48e39427dd5ea555b0741a3f715a55e10f8bb6616c27ec92ebc5e64b', //カスタム絵文字の川
		'c8d5c2709a5670d6f621ac8020ac3e4fc3057a4961a15319f7c0818309407723', //Nostr麻雀開発部
		'5b0703f5add2bb9e636bcae1ef7870ba6a591a93b6b556aca0f14b0919006598', //₍ ﾃｽﾄ ₎
		'addfe50481fb4edcf4ca42faaf0fa28e4b4caa36409f37f0cf0c1c6bf4acb3b5', //ノスハイクのテスト
		'e3e2fef762933fb7d4dd59d215a9616911d958cbf0ae0401cbf9b1a9764d2915' //おはよう
	];
	const disallowedNpubs = [
		'npub1j0ng5hmm7mf47r939zqkpepwekenj6uqhd5x555pn80utevvavjsfgqem2' //雀卓
	];
	if (disallowedNpubs.includes(nip19.npubEncode(event.pubkey))) {
		return false;
	}
	const disallowedTags = ['content-warning', 'proxy'];
	if (event.tags.some((tag: string[]) => tag.length >= 1 && disallowedTags.includes(tag[0]))) {
		return false;
	}
	if (event.kind === 1) {
		return true;
	} else if (event.kind === 42) {
		const tagRoot = event.tags.find(
			(tag: string[]) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
		);
		if (tagRoot !== undefined) {
			return allowedChannel.includes(tagRoot[1]);
		} else {
			throw new TypeError('root is not found');
		}
	} else if (event.kind === 9735) {
		return true;
	} else if (event.kind === 20000) {
		return true;
	}
	throw new TypeError(`kind ${event.kind} is not supported`);
};

const isNsecPost = (event: NostrEvent) => {
	return /nsec1\w{5,58}/.test(event.content);
};

const getResmap = (
	mode: Mode
): [
	RegExp,
	(
		event: NostrEvent,
		mode: Mode,
		regstr: RegExp,
		signer: Signer
	) => Promise<[string, string[][]] | null> | [string, string[][]] | null
][] => {
	const resmapNormal: [
		RegExp,
		(event: NostrEvent, mode: Mode, regstr: RegExp) => [string, string[][]] | null
	][] = [
		[/いいの?か?(？|\?)$/, res_iiyo],
		[/\\e$/, res_enyee],
		[/^うにゅう画像(\s*)(-?\d*)$/, res_unyupic],
		[/^うにゅう漫画$/, res_unyucomic],
		[/^ちくわ大明神$/, res_chikuwa],
		[/(ほめて|褒めて|のでえらい|えらいので).?$|^えらいので/u, res_igyo],
		[/[行い]っ?てきます.?$/u, res_itera],
		[/^((う|ぐ)っにゅう?ーん|ぎゅ(うっ|っう)にゅう?ーん).?$/u, res_unnyuuun],
		[/(フォロー|ふぉろー)[飛と]んだ.?$/u, res_nostrflu],
		[/^次は「(.)」から！$/u, res_shiritori],
		[
			/^(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(.{1,300})[をに]([燃萌も]やして|焼いて|煮て|炊いて|沸か[せし]て|溶かして|凍らせて|冷やして|冷まして|覚まして|通報して|火を[付つ]けて|磨いて|爆破して|注射して|打って|駐車して|停めて|潰して|縮めて|伸ばして|広げて|ど[突つ]いて|[踏ふ]んで|捌いて|裁いて|出して|積んで|重ねて|握って|触って|祝って|呪って|鳴らして|詰めて|梱包して|囲んで|囲って|詰んで|漬けて|[踊躍]らせて|撃って|蒸して|上げて|アゲて|ageて|下げて|サゲて|sageて|導いて|支えて|応援して|増やして|包囲して|沈めて|願って|祈って|直して|秘めて|胴上げして|飛ばして|登って|のぼって|轢いて)[^るた]?$/su,
			res_fire
		]
	];
	const resmapReply: [
		RegExp,
		(
			event: NostrEvent,
			mode: Mode,
			regstr: RegExp,
			signer: Signer
		) => Promise<[string, string[][]]> | [string, string[][]] | null
	][] = [
		[/プロフィールzapテスト$/i, res_profilezaptest],
		[/zapテスト$/i, res_zaptest],
		[/^\\s\[(\d+)\]$/, res_surfacetest],
		[/update\srelay/, res_relayupdate],
		[/おはよ/, res_ohayo],
		[/将棋*.対局/, res_shogi_start],
		[/盤面/, res_shogi_banmen],
		[
			/([▲△☗☖])?(([1-9])([一二三四五六七八九])|同)(王|玉|飛|角|金|銀|桂|香|歩|龍|馬|成銀|成桂|成香|と)([打右左上引直寄])?(成|不成)?$/,
			res_shogi_turn
		],
		[/アルパカ|🦙|ものパカ|モノパカ|夏パカ/, res_arupaka],
		[/ケルベ[ロノ]ス/, res_kerubenos],
		[/タイガー|🐯|🐅/u, res_tiger],
		[/クマダス|🐻/u, res_bear],
		[/俺達に制限/, res_seigen],
		[/ミシシッピアカミミガメ/, res_akamimigame],
		[/(今|いま)の(気分|きぶん)/, res_imanokibun],
		[/画像生成/, res_gazouseisei],
		[/りとりん|つぎはなにから？/, res_ritorin],
		[/バッジ$/, res_badge],
		[/バッジを授与して/, res_others_badge],
		[/最近の(アンケート|投票)/, res_resent_poll],
		[/アンケート|投票/, res_poll],
		[/まだ(助|たす)かる|マダガスカル/, res_madagasukaru],
		[/いいスタート|イースター島/, res_iisutato],
		[/占って|占い/, res_uranai],
		[/きょもなん/, res_kyomonan],
		[/(午後|ごご)なん/, res_gogonan],
		[/(よしえ|みゆき)$/, res_yoshie],
		[/カレーの材料/, res_curry],
		[/タツノオトシゴの絵文字/, res_tatsunootoshigo],
		[/赤ちゃんの身長/, res_akachannoshincho],
		[/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(\S+)の(週間)?天気/, res_tenki],
		[/(^|\s+)うにゅう、自(\S+)しろ/, res_aura],
		[
			/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(.+)を短冊にして$/u,
			res_tanzakunishite
		],
		[
			/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(.+)を絵文字にして$/u,
			res_emojinishite
		],
		[
			/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(.+)を(CW|warning|ワーニング|わーにんぐ|nip36)にして$/iu,
			res_cwnishite
		],
		[
			/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(.+)をスロットにして$/u,
			res_slotnishite
		],
		[/スロット/, res_slot],
		[/(npub\w{59})\s?(さん|ちゃん|くん)?に(.{1,50})を/su, res_okutte],
		[/(ブクマ|ブックマーク)して/, res_bukuma],
		[/馬券|予想して/, res_keiba],
		[/ニュース/, res_news],
		[/中身/, res_nakami],
		[/誕生日/, res_tanjobi],
		[/どんぐり/, res_donguri],
		[/まりも|マリモ/, res_marimo],
		[/ゼリー$/, res_jelly],
		[/ウカチュウ$/, res_ukachu],
		[/ゴムまり$/, res_gomumari],
		[/もじぴったん/, res_mojipittan],
		[/わたあめ/, res_wataame],
		[/(びっちゃ|bitchat) [a-z0-9]{2,}$/i, res_bitchat],
		[/時刻|時報|日時|何時/, res_jihou],
		[/ログボ|ログインボーナス/, res_rogubo],
		[/あなたの合計ログイン回数は(\d+)回です。/, res_get_rogubo],
		[/(もらって|あげる|どうぞ).?$/u, res_ageru],
		[/([飛と]んで|[飛と]べ).?$/u, res_tonde],
		[/ありが(と|て)|(たす|助)か(る|った)/, res_arigato],
		[/ごめん|すまん/, res_gomen],
		[/かわいい|可愛い|すごい|かっこいい|えらい|偉い|かしこい|賢い|最高/, res_kawaii],
		[/月が(綺麗|きれい|キレイ)/, res_tsukikirei],
		[/あかんの?か/, res_akan],
		[/お(かえ|帰)り/, res_okaeri],
		[/人の心/, res_hitonokokoro],
		[/ぽわ/, res_powa],
		[/クリスマス|メリー|Xmas/i, res_xmas],
		[/[良よ]いお年を|来年も/, res_oomisoka],
		[/あけおめ|あけまして|ことよろ/, res_akeome],
		[/お年玉/, res_otoshidama],
		[/牛乳|ぎゅうにゅう/, res_gyunyu],
		[
			/(^|\s+)(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)?(.+)ってgrokに聞いて$/iu,
			res_grok
		],
		[/マルコフ.*(を?呼んで|どこ).?$/u, res_markov_quiz],
		[/(ブクマ|ブックマーク|口寄せ|クチヨセ|kuchiyose)(を?呼んで|どこ).?$/iu, res_kuchiyose],
		[/(ハイク|はいく)(を?呼んで|どこ).?$/u, res_haiku],
		[/(るみるみ|ルミルミ|lumilumi|もの(さん)?のクライアント)(を?呼んで|どこ).?$/iu, res_lumilumi],
		[/(長文エディタ|まきもの|マキモノ|巻物|MAKIMONO)(を?呼んで|どこ).?$/iu, res_makimono],
		[/検索(を?呼んで|どこ).?$/u, res_kensaku],
		[/麻雀(を?呼んで|どこ).?$/u, res_mahojng],
		[/(パブ|ぱぶ)(リック)?(チャ|ちゃ|茶)(ット)?(を?呼んで|どこ).?$/u, res_pabucha],
		[/(じゃんけん|ジャンケン|淀川(さん)?)(を?呼んで|どこ).?$/u, res_janken],
		[/(しりとり|しりとリレー)(を?呼んで|どこ).?$/u, res_shiritoridoko],
		[/削除.*(を?呼んで|どこ).?$/iu, res_deletion_tool],
		[/(status|ステータス).*(を?呼んで|どこ).?$/iu, res_status],
		[/(flappy|フラッピー|ふらっぴー)(を?呼んで|どこ).?$/iu, res_flappy],
		[/やぶみ(ちゃ)?ん?(を?呼んで|どこ).?$/u, res_yabumin],
		[/ぬるぽが?(を?呼んで|どこ).?$/u, res_nurupoga],
		[/うにゅう(を?呼んで|どこ).?$/u, res_unyu],
		[/iris|Don(さん)?(を?呼んで|どこ).?$/iu, res_don],
		[/(マグロ|ﾏｸﾞﾛ)の?元ネタ(を?呼んで|どこ).?$/u, res_maguro],
		[/(nip-?96|画像のやつ|あぷろだ|アッ?プロー?ダー?).*(を?呼んで|どこ).?$/iu, res_nip96],
		[/(カレンダー|アドカレ|アドベントカレンダー)(を?呼んで|どこ).?$/u, res_adokare],
		[/(nostr-hours|(ノス|のす)廃|時間[見み]るやつ).*(を?呼んで|どこ).?$/iu, res_nostr_hours],
		[/(ノス|のす)貢献.*(を?呼んで|どこ).?$/iu, res_nostr_contribution],
		[/(chronostr|ちょろのす)(を?呼んで|どこ).?$/iu, res_chronostr],
		[/((タイムライン|TL)(遡る|振り返る)やつ)|(nosaray|のさらい)(を?呼んで|どこ).?$/iu, res_nosaray],
		[/(togetter|トゥギャッター|nosli|のすり|ノスリ)(を?呼んで|どこ).?$/iu, res_nosli],
		[/DM.*(を?呼んで|どこ).?$/iu, res_dm],
		[/Zap.*(を?呼んで|どこ).?$/iu, res_zap],
		[/おいくら(サッツ|さっつ|sats).*(を?呼んで|どこ).?$/iu, res_oikurasats],
		[/(eHagaki|えはがき)(を?呼んで|どこ).?$/iu, res_ehagaki],
		[/ここは?(どこ|ドコ).?$/iu, res_kokodoko],
		[/絵文字.*(を?呼んで|どこ).?$/iu, res_emoji],
		[/伺か民?(を?呼んで|どこ).?$/u, res_ukagakamin],
		[/絵文字(を?探して|教えて)/iu, res_emoji_search],
		[/カチャン|ｶﾁｬﾝ|💥🔥/u, res_kachan],
		[/宇和さん/, res_uwasan],
		[/ファクトチェック/, res_factcheck],
		[/キャラサイ|くま(ざ|ざ)わ/u, res_charasai],
		[
			/えびふらいあざらし|おなかさん|今日はもうダメラニアン|くりゅおね|ココ・ユニちゃん|シュシュ|食パンレスラー|デビタ|なまこもの|なまはむ|はらぺことら|アムー|ピノ|ぷろてあ|ぷいちゃん|ペコペコザメ|ポチョ|まこたまろ|ンガ/,
			res_charasai_puichan
		],
		[/(今|いま)どんな(感|かん)じ.?$/u, res_imadonnakanji],
		[/スクラップボックス|Scrapbox|wikiみたいな/i, res_scrapbox],
		[/再起動/, res_saikidou],
		[/えんいー/, res_enii],
		[/へばな/, res_hebana],
		[/伺か/, res_ukagaka],
		[/[呼よ](んだだけ|んでみた)|(何|なん)でもない/, res_yondadake],
		[/ヘルプ|へるぷ|help|(助|たす)けて|(教|おし)えて|手伝って/i, res_help],
		[/できること/, res_usage],
		[/すき|好き|愛してる|あいしてる/, res_suki],
		[/ランド|開いてる|閉じてる|開園|閉園/, res_ochinchinland],
		[/招待コード/, res_invitecode],
		[/ライトニング|フリー?マ|Zap|ビットコイン|⚡/iu, res_bitcoin],
		[/(🫂|🤗)/u, res_hug],
		[/[💋💕]/u, res_chu],
		[/(？|\?)$/, res_hatena]
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

const mode_normal = async (event: NostrEvent, signer: Signer): Promise<EventTemplate | null> => {
	//自分への話しかけはreplyで対応する
	//自分以外に話しかけている場合は割り込まない
	if (event.tags.some((tag: string[]) => tag.length >= 2 && tag[0] === 'p')) {
		return null;
	}
	//自分への話しかけはreplyで対応する
	if (/^(うにゅう、|うにゅう[くさた]ん、|うにゅう[ちに]ゃん、)/.test(event.content)) {
		return null;
	}
	const resmap = getResmap(Mode.Normal);
	for (const [reg, func] of resmap) {
		if (reg.test(event.content)) {
			const res = await func(event, Mode.Normal, reg, signer);
			if (res === null) {
				return null;
			}
			const [content, tags] = res;
			return {
				content,
				kind: event.kind,
				tags,
				created_at: event.created_at + 1
			};
		}
	}
	return null;
};

const mode_reply = async (event: NostrEvent, signer: Signer): Promise<EventTemplate | null> => {
	const resmap = getResmap(Mode.Reply);
	for (const [reg, func] of resmap) {
		if (reg.test(event.content)) {
			const res = await func(event, Mode.Reply, reg, signer);
			if (res === null) {
				return null;
			}
			const [content, tags] = res;
			return {
				content,
				kind: event.kind,
				tags,
				created_at: event.created_at + 1
			};
		}
	}
	let content;
	let tags;
	let created_at_res = event.created_at + 1;
	if (event.tags.some((tag: string[]) => tag[0] === 't' && tag[1] === 'ぬるぽが生成画像')) {
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `${any(['上手やな', '上手いやん', 'ワイの方が上手いな'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
	} else if (/未来/.test(event.content)) {
		const match = event.content.match(/\d+/);
		if (match !== null) {
			content = `${match[0]}秒後からのリプライやで`;
			tags = getTagsReply(event);
			created_at_res = event.created_at + parseInt(match[0]);
		} else {
			content = '秒数を指定せえ';
			tags = getTagsReply(event);
		}
	} else {
		content = '\\s[10]えんいー';
		tags = getTagsAirrep(event);
	}
	return { content, kind: event.kind, tags, created_at: created_at_res };
};

const mode_fav = (event: NostrEvent): EventTemplate | null => {
	const rTag = event.tags.find(
		(tag: string[]) => tag.length >= 2 && tag[0] === 'r' && URL.canParse(tag[1])
	);
	if (rTag !== undefined) {
		return {
			content: '⭐',
			kind: 17,
			tags: [
				['i', rTag[1]],
				['k', 'web']
			],
			created_at: event.created_at + 1
		};
	}
	const reactionmap: [RegExp, string][] = [
		[/うにゅうも.*よ[なね]/, any(['🙂‍↕', '🙂‍↔'])],
		[/虚無/, ''],
		[/マイナス|まいなす|dislike|downvote/i, '-'],
		[/さくら/, ':uka_sakurah00:'],
		[/:en_e:/, ':en_e:'],
		[/:yen_e:/, ':yen_e:'],
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
		[/えんいー/, '⭐']
	];
	for (const [reg, content] of reactionmap) {
		if (reg.test(event.content)) {
			const kind: number = 7;
			const tags: string[][] = getTagsFav(event);
			switch (content) {
				case ':unyu:':
					tags.push(['emoji', 'unyu', 'https://nikolat.github.io/avatar/disc2.png']);
					break;
				case ':uka_sakurah00:':
					tags.push([
						'emoji',
						'uka_sakurah00',
						'https://ukadon-cdn.de10.moe/system/custom_emojis/images/000/006/840/original/uka_sakurah00.png'
					]);
					break;
				case ':en_e:':
					tags.push([
						'emoji',
						'en_e',
						'https://ompomz.github.io/docs/ene.webp',
						'30030:a19caaa8404721584746fb0e174cf971a94e0f51baaf4c4e8c6e54fa88985eaf:odaijini'
					]);
					break;
				case ':yen_e:':
					tags.push([
						'emoji',
						'yen_e',
						'https://ompomz.github.io/docs/yene.webp',
						'30030:a19caaa8404721584746fb0e174cf971a94e0f51baaf4c4e8c6e54fa88985eaf:odaijini'
					]);
					break;
				default:
					break;
			}
			return { content, kind, tags, created_at: event.created_at + 1 };
		}
	}
	return null;
};

const mode_zap = async (event: NostrEvent, signer: Signer): Promise<EventTemplate | null> => {
	//kind9734の検証
	let event9734;
	try {
		event9734 = JSON.parse(
			event.tags.find((tag: string[]) => tag.length >= 2 && tag[0] === 'description')?.at(1) ?? '{}'
		);
	} catch (error) {
		return null;
	}
	if (!verifyEvent(event9734)) {
		return null;
	}
	//kind9735の検証
	const evKind0 = await getKind0(await signer.getPublicKey());
	if (evKind0 === undefined) {
		throw Error('Cannot get kind 0 event');
	}
	const lud16: string = JSON.parse(evKind0.content).lud16;
	const m = lud16.match(/^([^@]+)@([^@]+)$/);
	if (m === null) {
		return null;
	}
	const url = `https://${m[2]}/.well-known/lnurlp/${m[1]}`;
	const response = await fetch(url);
	const json: any = await response.json();
	const nostrPubkey: string = json.nostrPubkey;
	if (!nostrPubkey) {
		return null;
	}
	if (event.pubkey !== nostrPubkey) {
		return {
			content: '偽物のZapが飛んできたみたいやね',
			kind: 1,
			tags: [],
			created_at: event.created_at + 1
		};
	}
	const amount = event9734.tags
		.find((tag: string[]) => tag.length >= 2 && tag[0] === 'amount')
		?.at(1);
	if (amount === undefined || !/^\d+$/.test(amount)) {
		return null;
	}
	if (parseInt(amount) < 39 * 1000) {
		return null;
	}
	const zapEndPoint: string | null = await getZapEndPoint(event);
	if (event9734.pubkey !== (await signer.getPublicKey()) && zapEndPoint !== null) {
		try {
			await zapByNIP47(zapEndPoint, event9734, signer, 39, 'ありがとさん');
		} catch (error) {
			return null;
		}
	}
	return {
		content: 'Zapありがとさん',
		kind: 1,
		tags: [],
		created_at: event.created_at + 1
	};
};

const res_surfacetest = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	let content: string;
	const tags: string[][] = getTagsReply(event);
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const surface = parseInt(match[1]);
	if (![10, 11].includes(surface)) {
		content = 'そんな番号あらへん';
	} else {
		content = `\\s[${surface}]表情変更テストやで`;
	}
	return [content, tags];
};

const res_relayupdate = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	const tags: string[][] = getTagsReply(event);
	content = '\\_akind:10002 を更新したで';
	return [content, tags];
};

const res_profilezaptest = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp,
	signer: Signer
): Promise<[string, string[][]]> => {
	const npub_don = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
	if (event.pubkey !== nip19.decode(npub_don).data) {
		return ['イタズラしたらあかんで', getTagsReply(event)];
	}
	const zapEndPoint: string | null = await getZapEndPoint(event);
	if (zapEndPoint === null) {
		return ['LNアドレスが設定されてないで', getTagsReply(event)];
	}
	try {
		await zapByNIP47(zapEndPoint, event.pubkey, signer, 1, 'Zapのテストやで');
	} catch (error) {
		return ['何か失敗したみたいやで', getTagsReply(event)];
	}
	return ['1sat届いたはずやで', getTagsReply(event)];
};

const res_zaptest = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp,
	signer: Signer
): Promise<[string, string[][]]> => {
	const npub_don = 'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz';
	if (event.pubkey !== nip19.decode(npub_don).data) {
		return ['イタズラしたらあかんで', getTagsReply(event)];
	}
	const zapEndPoint: string | null = await getZapEndPoint(event);
	if (zapEndPoint === null) {
		return ['LNアドレスが設定されてないで', getTagsReply(event)];
	}
	try {
		await zapByNIP47(zapEndPoint, event, signer, 1, 'Zapのテストやで');
	} catch (error) {
		return ['何か失敗したみたいやで', getTagsReply(event)];
	}
	return ['1sat届いたはずやで', getTagsReply(event)];
};

const mode_delete = async (event: NostrEvent): Promise<EventTemplate | null> => {
	const ids = event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'q').map((tag) => tag[1]);
	if (ids.length === 0) {
		return null;
	}
	return {
		content: '',
		kind: 5,
		tags: ids.map((id) => ['e', id]),
		created_at: event.created_at + 1
	};
};

const res_ohayo = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp,
	signer: Signer
): Promise<[string, string[][]]> => {
	const date = new Date();
	date.setHours(date.getHours() + 9); //JST
	const [year, month, day, hour, minutes, seconds, week] = [
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
		'日月火水木金土'.at(date.getDay())
	];
	if (4 <= hour && hour < 8) {
		let sats = 3;
		let mes = any([
			'早起きのご褒美やで',
			'健康的でええな',
			'みんなには内緒やで',
			'二度寝したらあかんで',
			'明日も早起きするんやで',
			`${week}曜日の朝や、今日も元気にいくで`,
			'朝ご飯はしっかり食べるんやで',
			'夜ふかししたんと違うやろな？',
			'継続は力やで',
			'今日はきっといいことあるで'
		]);
		if (week === '日') {
			sats = 13;
			mes = any([
				'日曜日なのに早起きやな',
				'日曜日やからてゴロゴロせえへんのは偉いやで',
				'今日は休みとちゃうんか？',
				'曜日に限らず毎日早起きするんやで',
				'土曜日に夜ふかししなかったのは偉業やな'
			]);
		}
		if (day === 1) {
			sats = 30;
			mes = any([
				`${month}月の始まりや、今月も元気にいくで`,
				'今日は月初めや、気合い入れていこか',
				'月初から早起きとはええ心がけや',
				`${month}月も毎日早起きするんやで`,
				`今日は${month}月${day}日や、今月もよろしゅうな`
			]);
			if (month === 1) {
				sats = 333;
				mes = any([
					'正月から早起きとはええ心がけや',
					'新年早々早起きして偉業やで',
					'今年も早起きを継続するんやで',
					'今年はどんな年になるんやろな',
					'今年もよろしゅうな'
				]);
			}
		}
		if (month === 7 && day === 7) {
			sats = 77;
			mes = any([
				'今日は七夕や、願い事があったら短冊に書くんやで',
				'七夕も早起きとは感心やな。',
				'天の川が見えるとええな',
				'短冊に書く願い事は決まったんか？',
				'七夕やし特別に77satsや'
			]);
		}
		const zapEndPoint: string | null = await getZapEndPoint(event);
		if (zapEndPoint !== null) {
			try {
				await zapByNIP47(zapEndPoint, event, signer, sats, mes);
			} catch (error) {
				return [
					any(['zzz...', 'まだ寝ときや', 'もう朝やて？ワイは信じへんで']),
					getTagsReply(event)
				];
			}
		}
	}
	return [
		any([
			'おはようやで',
			'ほい、おはよう',
			`もう${hour}時か、おはよう`,
			'ワイの方が早起きやな',
			'ほなワイは寝るわ',
			'ぼちぼち起きる時間やな'
		]),
		getTagsReply(event)
	];
};

const getZapEndPoint = async (event: NostrEvent): Promise<string | null> => {
	const evKind0: NostrEvent | undefined = await getKind0(event.pubkey);
	if (evKind0 === undefined) {
		return null;
	}
	const zapEndpoint: string | null = await nip57.getZapEndpoint(evKind0);
	return zapEndpoint;
};

const zapByNIP47 = async (
	zapEndpoint: string,
	target: NostrEvent | string,
	signer: Signer,
	sats: number,
	zapComment: string
): Promise<void> => {
	const wc = process.env.NOSTR_WALLET_CONNECT;
	if (wc === undefined) {
		throw Error('NOSTR_WALLET_CONNECT is undefined');
	}
	const { pathname, hostname, searchParams } = new URL(wc);
	const walletPubkey = pathname || hostname;
	const walletRelay = searchParams.get('relay');
	const walletSeckey = searchParams.get('secret');
	if (walletPubkey.length === 0 || walletRelay === null || walletSeckey === null) {
		throw Error('NOSTR_WALLET_CONNECT is invalid connection string');
	}
	const pubkey: string = typeof target === 'string' ? target : target.pubkey;
	const lastZap = await getLastZap(pubkey);
	if (lastZap !== undefined && Math.floor(Date.now() / 1000) - lastZap.created_at < 60 * 10) {
		//10分以内に誰かからZapをもらっている
		const evKind9734 = JSON.parse(
			lastZap.tags.find((tag: string[]) => tag[0] === 'description')?.at(1) ?? '{}'
		);
		if (evKind9734.pubkey === signer.getPublicKey()) {
			//自分からのZap
			return;
		}
	}

	const amount = sats * 1000;
	const params =
		typeof target === 'string' || target.kind === 9734
			? {
					pubkey,
					amount,
					comment: zapComment,
					relays: zapBroadcastRelays
				}
			: {
					event: target,
					amount,
					comment: zapComment,
					relays: zapBroadcastRelays
				};
	const zapRequest = nip57.makeZapRequest(params);
	const zapRequestEvent = await signer.signEvent(zapRequest);
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
	return getEvent(profileRelay, [
		{
			kinds: [0],
			authors: [pubkey]
		}
	]);
};

type Teban = 'sente' | 'gote';
type KomaNarazu =
	| 'pawn'
	| 'lance'
	| 'knight'
	| 'silver'
	| 'gold'
	| 'bishop'
	| 'rook'
	| 'king'
	| 'king2';
type KomaNari = 'prom_pawn' | 'prom_lance' | 'prom_knight' | 'prom_silver' | 'horse' | 'dragon';

type Shogi = {
	teban: Teban;
	previous_turn: {
		x: number;
		y: number;
	} | null;
	banmen: string[][];
	mochigoma: {
		sente: KomaNarazu[];
		gote: KomaNarazu[];
	};
};

const getShogiData = async (pubkey: string): Promise<Shogi | undefined> => {
	const event: NostrEvent | undefined = await getEvent(shogiRelay, [
		{
			kinds: [30078],
			authors: [pubkey],
			'#d': ['shogi']
		}
	]);
	if (event === undefined) {
		return undefined;
	}
	const data: Shogi = JSON.parse(event.content);
	return data;
};

const setShogiData = async (signer: Signer, data: Shogi): Promise<void> => {
	const wRelay = await Relay.connect(shogiRelay);
	const eventTemplate: EventTemplate = {
		kind: 30078,
		tags: [['d', 'shogi']],
		content: JSON.stringify(data),
		created_at: Math.floor(Date.now() / 1000)
	};
	const event: VerifiedEvent = await signer.signEvent(eventTemplate);
	await wRelay.publish(event);
	wRelay.close();
};

const getLastZap = (pubkey: string): Promise<NostrEvent | undefined> => {
	return getEvent(zapCheckRelay, [
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
		const sub = relay.subscribe(filters, { onevent, oneose });
	});
};

const getEvents = (
	relayUrl: string,
	filters: Filter[],
	callback: (event: NostrEvent) => void
): Promise<void> => {
	return new Promise(async (resolve, reject) => {
		let relay: Relay;
		try {
			relay = await Relay.connect(relayUrl);
		} catch (error) {
			reject(error);
			return;
		}
		const onevent = (ev: NostrEvent) => {
			callback(ev);
		};
		const oneose = () => {
			sub.close();
			relay.close();
			resolve();
		};
		const sub = relay.subscribe(filters, { onevent, oneose });
	});
};

const shokihaichi: string[][] = [
	[
		'white_lance',
		'white_knight',
		'white_silver',
		'white_gold',
		'white_king',
		'white_gold',
		'white_silver',
		'white_knight',
		'white_lance'
	],
	['', 'white_rook', '', '', '', '', '', 'white_bishop', ''],
	[
		'white_pawn',
		'white_pawn',
		'white_pawn',
		'white_pawn',
		'white_pawn',
		'white_pawn',
		'white_pawn',
		'white_pawn',
		'white_pawn'
	],
	['', '', '', '', '', '', '', '', ''],
	['', '', '', '', '', '', '', '', ''],
	['', '', '', '', '', '', '', '', ''],
	[
		'black_pawn',
		'black_pawn',
		'black_pawn',
		'black_pawn',
		'black_pawn',
		'black_pawn',
		'black_pawn',
		'black_pawn',
		'black_pawn'
	],
	['', 'black_bishop', '', '', '', '', '', 'black_rook', ''],
	[
		'black_lance',
		'black_knight',
		'black_silver',
		'black_gold',
		'black_king2',
		'black_gold',
		'black_silver',
		'black_knight',
		'black_lance'
	]
];

const res_shogi_start = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp,
	signer: Signer
): Promise<[string, string[][]]> => {
	const banmen: string[][] = shokihaichi;
	const data: Shogi = {
		banmen,
		previous_turn: null,
		mochigoma: {
			sente: [],
			gote: []
		},
		teban: 'sente'
	};
	await setShogiData(signer, data);
	return showBanmen(event, data);
};

const getNari = (koma: KomaNarazu): KomaNari => {
	switch (koma) {
		case 'pawn':
		case 'lance':
		case 'knight':
		case 'silver':
			return `prom_${koma}`;
		case 'bishop':
			return 'horse';
		case 'rook':
			return 'dragon';
		default:
			throw new TypeError(`unexpected: ${koma}`);
	}
};

const getNariMoto = (koma: KomaNarazu | KomaNari): KomaNarazu => {
	switch (koma) {
		case 'prom_pawn':
			return 'pawn';
		case 'prom_lance':
			return 'lance';
		case 'prom_knight':
			return 'knight';
		case 'prom_silver':
			return 'silver';
		case 'horse':
			return 'bishop';
		case 'dragon':
			return 'rook';
		default:
			return koma;
	}
};

const res_shogi_banmen = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp,
	signer: Signer
): Promise<[string, string[][]]> => {
	const data: Shogi | undefined = await getShogiData(await signer.getPublicKey());
	if (data === undefined) {
		return ['前回のデータが取得できへん', getTagsReply(event)];
	}
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const teban: string = data.teban === 'sente' ? '【先手番】' : '【後手番】';
	const [content, tags] = showBanmen(event, data);
	return [`${teban}\n${content}`, tags];
};

const res_shogi_turn = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp,
	signer: Signer
): Promise<[string, string[][]]> => {
	const data: Shogi | undefined = await getShogiData(await signer.getPublicKey());
	if (data === undefined) {
		return ['前回のデータが取得できへん', getTagsReply(event)];
	}
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const teban: Teban = ['▲', '☗'].includes(match[1])
		? 'sente'
		: ['△', '☖'].includes(match[1])
			? 'gote'
			: data.teban === 'sente'
				? 'sente'
				: 'gote';
	const isDou: boolean = match[2] === '同';
	let x: number;
	let y: number;
	if (isDou && data.previous_turn !== null) {
		x = data.previous_turn.x;
		y = data.previous_turn.y;
	} else {
		x = Array.from('987654321').indexOf(match[3]);
		y = Array.from('一二三四五六七八九').indexOf(match[4]);
	}
	const komaName: string = match[5];
	const direction: string | undefined = match.at(6);
	const narifunari: string | undefined = match.at(7);
	const koma: KomaNarazu | KomaNari | undefined = {
		王: 'king',
		玉: 'king2',
		飛: 'rook',
		角: 'bishop',
		金: 'gold',
		銀: 'silver',
		桂: 'knight',
		香: 'lance',
		歩: 'pawn',
		龍: 'dragon',
		馬: 'horse',
		成銀: 'prom_silver',
		成桂: 'prom_knight',
		成香: 'prom_lance',
		と: 'prom_pawn'
	}[komaName] as KomaNarazu | KomaNari | undefined;
	if (x < 0 || 8 < x || y < 0 || 8 < y || koma === undefined) {
		return ['なんかデータがおかしいで', getTagsReply(event)];
	}
	if (data.teban === 'sente' && teban === 'gote') {
		return ['先手番やで', getTagsReply(event)];
	}
	if (data.teban === 'gote' && teban === 'sente') {
		return ['後手番やで', getTagsReply(event)];
	}
	if (
		(teban === 'sente' && data.banmen[y][x].startsWith('black_')) ||
		(teban === 'gote' && data.banmen[y][x].startsWith('white_'))
	) {
		return ['味方がおって移動できへんて', getTagsReply(event)];
	}
	const komaColor: string = teban === 'sente' ? `black_${koma}` : `white_${koma}`;
	//打
	if (direction === '打') {
		const mochigoma: KomaNarazu[] = data.mochigoma[teban];
		const komanarazu = koma as KomaNarazu;
		if (!mochigoma.includes(komanarazu)) {
			return [`${komaName}なんか持ってへんがな`, getTagsReply(event)];
		}
		if (data.banmen[y][x] !== '') {
			return ['そこには置けへんて', getTagsReply(event)];
		}
		const index = mochigoma.indexOf(komanarazu);
		data.mochigoma[teban].splice(index, 1);
		if (teban === 'sente') {
			data.teban = 'gote';
		} else {
			data.teban = 'sente';
		}
		data.banmen[y][x] = komaColor;
		data.previous_turn = { x, y };
		await setShogiData(signer, data);
		return showBanmen(event, data);
	}
	let canNari: boolean =
		((teban === 'sente' && y < 3) || (teban === 'gote' && 5 < y)) &&
		['pawn', 'lance', 'knight', 'silver', 'bishop', 'rook'].includes(koma);
	let pointMovedFrom: number[] | undefined;
	const d: number = teban === 'sente' ? 1 : -1;
	switch (koma) {
		case 'pawn': {
			if (data.banmen[y + d][x] === komaColor) {
				data.banmen[y + d][x] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'lance': {
			let isOk = false;
			for (let i = y + d; 0 <= i && i < 9; i += d) {
				if (data.banmen[i][x] === komaColor) {
					data.banmen[i][x] = '';
					isOk = true;
					break;
				} else if (data.banmen[i][x] !== '') {
					return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
				}
			}
			if (!isOk) {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'knight': {
			let isLeftOK = data.banmen[y + 2 * d]?.at(x - d) === komaColor;
			let isRightOK = data.banmen[y + 2 * d]?.at(x + d) === komaColor;
			if (isLeftOK && isRightOK) {
				if (direction === '右') {
					isLeftOK = false;
				} else if (direction === '左') {
					isRightOK = false;
				} else {
					return [`右と左どっちの${komaName}やねん`, getTagsReply(event)];
				}
			}
			if (isLeftOK) {
				data.banmen[y + 2 * d][x - d] = '';
			} else if (isRightOK) {
				data.banmen[y + 2 * d][x + d] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'silver': {
			let isLeftUpOK = data.banmen[y - d]?.at(x - d) === komaColor;
			let isRightUpOK = data.banmen[y - d]?.at(x + d) === komaColor;
			let isLeftDownOK = data.banmen[y + d]?.at(x - d) === komaColor;
			let isDownOK = data.banmen[y + d]?.at(x) === komaColor;
			let isRightDownOK = data.banmen[y + d]?.at(x + d) === komaColor;
			if (direction === '右') {
				isLeftUpOK = false;
				isLeftDownOK = false;
				isDownOK = false;
			} else if (direction === '左') {
				isRightUpOK = false;
				isRightDownOK = false;
				isDownOK = false;
			} else if (direction === '上') {
				isLeftUpOK = false;
				isRightUpOK = false;
				isDownOK = false;
			} else if (direction === '引') {
				isLeftDownOK = false;
				isDownOK = false;
				isRightDownOK = false;
			} else if (direction === '直') {
				isLeftUpOK = false;
				isRightUpOK = false;
				isLeftDownOK = false;
				isRightDownOK = false;
			}
			if (isLeftUpOK) {
				pointMovedFrom = [y - d, x - d];
				data.banmen[y - d][x - d] = '';
			} else if (isRightUpOK) {
				pointMovedFrom = [y - d, x + d];
				data.banmen[y - d][x + d] = '';
			} else if (isLeftDownOK) {
				pointMovedFrom = [y + d, x - d];
				data.banmen[y + d][x - d] = '';
			} else if (isDownOK) {
				pointMovedFrom = [y + d, x];
				data.banmen[y + d][x] = '';
			} else if (isRightDownOK) {
				pointMovedFrom = [y + d, x + d];
				data.banmen[y + d][x + d] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'gold':
		case 'prom_pawn':
		case 'prom_lance':
		case 'prom_knight':
		case 'prom_silver': {
			let isUpOK = data.banmen[y - d]?.at(x) === komaColor;
			let isLeftOK = data.banmen[y]?.at(x - d) === komaColor;
			let isRightOK = data.banmen[y]?.at(x + d) === komaColor;
			let isLeftDownOK = data.banmen[y + d]?.at(x - d) === komaColor;
			let isDownOK = data.banmen[y + d]?.at(x) === komaColor;
			let isRightDownOK = data.banmen[y + d]?.at(x + d) === komaColor;
			if (direction === '右') {
				isUpOK = false;
				isLeftOK = false;
				isLeftDownOK = false;
				isDownOK = false;
			} else if (direction === '左') {
				isUpOK = false;
				isRightOK = false;
				isRightDownOK = false;
				isDownOK = false;
			} else if (direction === '上') {
				isUpOK = false;
				isLeftOK = false;
				isRightOK = false;
			} else if (direction === '引') {
				isLeftOK = false;
				isRightOK = false;
				isLeftDownOK = false;
				isDownOK = false;
				isRightDownOK = false;
			} else if (direction === '直') {
				isUpOK = false;
				isLeftOK = false;
				isRightOK = false;
				isLeftDownOK = false;
				isRightDownOK = false;
			} else if (direction === '寄') {
				isUpOK = false;
				isLeftDownOK = false;
				isDownOK = false;
				isRightDownOK = false;
			}
			if (isUpOK) {
				data.banmen[y - d][x] = '';
			} else if (isLeftOK) {
				data.banmen[y][x - d] = '';
			} else if (isRightOK) {
				data.banmen[y][x + d] = '';
			} else if (isLeftDownOK) {
				data.banmen[y + d][x - d] = '';
			} else if (isDownOK) {
				data.banmen[y + d][x] = '';
			} else if (isRightDownOK) {
				data.banmen[y + d][x + d] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'bishop':
		case 'horse': {
			let isLeftUpOK = false;
			let isRightUpOK = false;
			let isLeftDownOK = false;
			let isRightDownOK = false;
			let nLeftUp: number = 99;
			let nRightUp: number = 99;
			let nLeftDown: number = 99;
			let nRightDown: number = 99;
			for (let i = 1; 0 <= y - i * d && y - i * d < 9 && 0 <= x - i * d && x - i * d < 9; i++) {
				const t = data.banmen[y - i * d][x - i * d];
				if (t === komaColor) {
					isLeftUpOK = true;
					nLeftUp = i;
					break;
				} else if (t !== '') {
					isLeftUpOK = false;
					break;
				}
			}
			for (let i = 1; 0 <= y - i * d && y - i * d < 9 && 0 <= x + i * d && x + i * d < 9; i++) {
				const t = data.banmen[y - i * d][x + i * d];
				if (t === komaColor) {
					isRightUpOK = true;
					nRightUp = i;
					break;
				} else if (t !== '') {
					isRightUpOK = false;
					break;
				}
			}
			for (let i = 1; 0 <= y + i * d && y + i * d < 9 && 0 <= x - i * d && x - i * d < 9; i++) {
				const t = data.banmen[y + i * d][x - i * d];
				if (t === komaColor) {
					isLeftDownOK = true;
					nLeftDown = i;
					break;
				} else if (t !== '') {
					isLeftDownOK = false;
					break;
				}
			}
			for (let i = 1; 0 <= y + i * d && y + i * d < 9 && 0 <= x + i * d && x + i * d < 9; i++) {
				const t = data.banmen[y + i * d][x + i * d];
				if (t === komaColor) {
					isRightDownOK = true;
					nRightDown = i;
					break;
				} else if (t !== '') {
					isRightDownOK = false;
					break;
				}
			}
			//馬限定
			let isUpOK = false;
			let isDownOK = false;
			let isRightOK = false;
			let isLeftOK = false;
			if (koma === 'horse') {
				if (data.banmen[y - d]?.at(x) === komaColor) {
					isUpOK = true;
				} else if (data.banmen[y + d]?.at(x) === komaColor) {
					isDownOK = true;
				} else if (data.banmen[y]?.at(x - d) === komaColor) {
					isLeftOK = true;
				} else if (data.banmen[y]?.at(x + d) === komaColor) {
					isRightOK = true;
				}
			}
			if (direction === '右') {
				isLeftUpOK = false;
				isLeftDownOK = false;
				isUpOK = false;
				isDownOK = false;
				isLeftOK = false;
			} else if (direction === '左') {
				isRightUpOK = false;
				isRightDownOK = false;
				isUpOK = false;
				isDownOK = false;
				isRightOK = false;
			} else if (direction === '上') {
				isLeftUpOK = false;
				isRightUpOK = false;
				isUpOK = false;
				isLeftOK = false;
				isRightOK = false;
			} else if (direction === '直') {
				isLeftUpOK = false;
				isRightUpOK = false;
				isUpOK = false;
				isLeftOK = false;
				isRightOK = false;
				isLeftDownOK = false;
				isRightDownOK = false;
			} else if (direction === '引') {
				isLeftDownOK = false;
				isRightDownOK = false;
				isUpOK = false;
				isDownOK = false;
				isRightOK = false;
			} else if (direction === '寄') {
				isLeftUpOK = false;
				isRightUpOK = false;
				isLeftDownOK = false;
				isRightDownOK = false;
				isUpOK = false;
				isDownOK = false;
			}
			if (isLeftUpOK) {
				pointMovedFrom = [y - nLeftUp * d, x - nLeftUp * d];
				data.banmen[y - nLeftUp * d][x - nLeftUp * d] = '';
			} else if (isRightUpOK) {
				pointMovedFrom = [y - nRightUp * d, x + nRightUp * d];
				data.banmen[y - nRightUp * d][x + nRightUp * d] = '';
			} else if (isLeftDownOK) {
				pointMovedFrom = [y + nLeftDown * d, x - nLeftDown * d];
				data.banmen[y + nLeftDown * d][x - nLeftDown * d] = '';
			} else if (isRightDownOK) {
				pointMovedFrom = [y + nRightDown * d, x + nRightDown * d];
				data.banmen[y + nRightDown * d][x + nRightDown * d] = '';
			} else if (isUpOK) {
				data.banmen[y - d][x] = '';
			} else if (isDownOK) {
				data.banmen[y + d][x] = '';
			} else if (isLeftOK) {
				data.banmen[y][x - d] = '';
			} else if (isRightOK) {
				data.banmen[y][x + d] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'rook':
		case 'dragon': {
			let isUpOK = false;
			let isDownOK = false;
			let isRightOK = false;
			let isLeftOK = false;
			let nUp: number = 99;
			let nDown: number = 99;
			let nRight: number = 99;
			let nLeft: number = 99;
			for (let i = 1; 0 <= y - i * d && y - i * d < 9; i++) {
				const t = data.banmen[y - i * d][x];
				if (t === komaColor) {
					isUpOK = true;
					nUp = i;
					break;
				} else if (t !== '') {
					isUpOK = false;
					break;
				}
			}
			for (let i = 1; 0 <= y + i * d && y + i * d < 9; i++) {
				const t = data.banmen[y + i * d][x];
				if (t === komaColor) {
					isDownOK = true;
					nDown = i;
					break;
				} else if (t !== '') {
					isDownOK = false;
					break;
				}
			}
			for (let i = 1; 0 <= x - i * d && x - i * d < 9; i++) {
				const t = data.banmen[y][x - i * d];
				if (t === komaColor) {
					isLeftOK = true;
					nLeft = i;
					break;
				} else if (t !== '') {
					isLeftOK = false;
					break;
				}
			}
			for (let i = 1; 0 <= x + i * d && x + i * d < 9; i++) {
				const t = data.banmen[y][x + i * d];
				if (t === komaColor) {
					isRightOK = true;
					nRight = i;
					break;
				} else if (t !== '') {
					isRightOK = false;
					break;
				}
			}
			//龍限定
			let isLeftUpOK = false;
			let isRightUpOK = false;
			let isLeftDownOK = false;
			let isRightDownOK = false;
			if (koma === 'dragon') {
				if (data.banmen[y - d]?.at(x - d) === komaColor) {
					isLeftUpOK = true;
				} else if (data.banmen[y - d]?.at(x + d) === komaColor) {
					isRightUpOK = true;
				} else if (data.banmen[y + d]?.at(x - d) === komaColor) {
					isLeftDownOK = true;
				} else if (data.banmen[y + d]?.at(x + d) === komaColor) {
					isRightDownOK = true;
				}
			}
			if (direction === '右') {
				isUpOK = false;
				isDownOK = false;
				isLeftOK = false;
				isLeftUpOK = false;
				isLeftDownOK = false;
			} else if (direction === '左') {
				isUpOK = false;
				isDownOK = false;
				isRightOK = false;
				isRightUpOK = false;
				isRightDownOK = false;
			} else if (direction === '上') {
				isUpOK = false;
				isLeftOK = false;
				isRightOK = false;
				isLeftUpOK = false;
				isRightUpOK = false;
			} else if (direction === '直') {
				isUpOK = false;
				isLeftOK = false;
				isRightOK = false;
				isLeftUpOK = false;
				isRightUpOK = false;
				isLeftDownOK = false;
				isRightDownOK = false;
			} else if (direction === '引') {
				isDownOK = false;
				isLeftOK = false;
				isRightOK = false;
				isLeftDownOK = false;
				isRightDownOK = false;
			}
			if (isUpOK) {
				pointMovedFrom = [y - nUp * d, x];
				data.banmen[y - nUp * d][x] = '';
			} else if (isDownOK) {
				pointMovedFrom = [y + nDown * d, x];
				data.banmen[y + nDown * d][x] = '';
			} else if (isLeftOK) {
				pointMovedFrom = [y, x - nLeft * d];
				data.banmen[y][x - nLeft * d] = '';
			} else if (isRightOK) {
				pointMovedFrom = [y, x + nRight * d];
				data.banmen[y][x + nRight * d] = '';
			} else if (isLeftUpOK) {
				data.banmen[y - d][x - d] = '';
			} else if (isRightUpOK) {
				data.banmen[y - d][x + d] = '';
			} else if (isLeftDownOK) {
				data.banmen[y + d][x - d] = '';
			} else if (isRightDownOK) {
				data.banmen[y + d][x + d] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		case 'king':
		case 'king2': {
			if (data.banmen[y - d]?.at(x - d) === komaColor) {
				data.banmen[y - d][x - d] = '';
			} else if (data.banmen[y - d]?.at(x) === komaColor) {
				data.banmen[y - d][x] = '';
			} else if (data.banmen[y - d]?.at(x + d) === komaColor) {
				data.banmen[y - d][x + d] = '';
			} else if (data.banmen[y]?.at(x - d) === komaColor) {
				data.banmen[y][x - d] = '';
			} else if (data.banmen[y]?.at(x + d) === komaColor) {
				data.banmen[y][x + d] = '';
			} else if (data.banmen[y + d]?.at(x - d) === komaColor) {
				data.banmen[y + d][x - d] = '';
			} else if (data.banmen[y + d]?.at(x) === komaColor) {
				data.banmen[y + d][x] = '';
			} else if (data.banmen[y + d]?.at(x + d) === komaColor) {
				data.banmen[y + d][x + d] = '';
			} else {
				return [`そこに${komaName}は動けへんやろ`, getTagsReply(event)];
			}
			break;
		}
		default: {
			return ['まだ実装してへんて', getTagsReply(event)];
		}
	}
	//相手の陣地から移動した場合も成れる
	canNari =
		canNari ||
		(pointMovedFrom !== undefined &&
			((teban === 'sente' && pointMovedFrom[0] < 3) ||
				(teban === 'gote' && 5 < pointMovedFrom[0])) &&
			['pawn', 'lance', 'knight', 'silver', 'bishop', 'rook'].includes(koma));
	if (canNari && narifunari === undefined) {
		return ['成か不成かはっきりせえ', getTagsReply(event)];
	}
	if (!canNari && narifunari === '成') {
		return ['成れへん', getTagsReply(event)];
	}
	if (teban === 'sente') {
		if (data.banmen[y][x] !== '') {
			const komaBase = data.banmen[y][x].replace('white_', '') as KomaNarazu | KomaNari;
			data.mochigoma.sente.push(getNariMoto(komaBase));
		}
		data.teban = 'gote';
	} else {
		if (data.banmen[y][x] !== '') {
			const komaBase = data.banmen[y][x].replace('black_', '') as KomaNarazu | KomaNari;
			data.mochigoma.gote.push(getNariMoto(komaBase));
		}
		data.teban = 'sente';
	}
	if (narifunari === '成') {
		const nariKomaColor: string =
			teban === 'sente'
				? `black_${getNari(koma as KomaNarazu)}`
				: `white_${getNari(koma as KomaNarazu)}`;
		data.banmen[y][x] = nariKomaColor;
	} else {
		data.banmen[y][x] = komaColor;
	}
	data.previous_turn = { x, y };
	await setShogiData(signer, data);
	return showBanmen(event, data);
};

const showBanmen = (event: NostrEvent, data: Shogi): [string, string[][]] => {
	let contentArray: string[] = [];
	const emojiKubipaka: Set<string> = new Set<string>();
	const emojiShogi: Set<string> = new Set<string>();
	emojiKubipaka.add('kubipaca_summer_kubi');
	emojiKubipaka.add('kubipaca_summer_empty');
	let isFirstLine: boolean = true;
	if (data.mochigoma.gote.length > 0) {
		const white = data.mochigoma.gote.map((e) => `white_${e}`);
		contentArray.push(white.map((e) => `:shogi_${e}:`).join(''));
		for (const koma of white) {
			emojiShogi.add(koma);
		}
	}
	for (const line of data.banmen) {
		let a: string[];
		if (isFirstLine) {
			isFirstLine = false;
			a = [
				'kubi_migisita',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_T',
				'kubi_yoko',
				'kubi_hidarisita'
			].map((e) => `kubipaca_summer_${e}`);
		} else {
			a = [
				'kubi_hidariT',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_juji',
				'kubi_yoko',
				'kubi_migiT'
			].map((e) => `kubipaca_summer_${e}`);
		}
		for (const e of a) {
			emojiKubipaka.add(e);
		}
		for (const e of line.filter((e) => e.length > 0)) {
			emojiShogi.add(e);
		}
		contentArray.push(a.map((e) => `:${e}:`).join(''));
		contentArray.push(
			`:kubipaca_summer_kubi:${line.map((e) => (e === '' ? ':kubipaca_summer_empty:' : `:shogi_${e}:`)).join(':kubipaca_summer_kubi:')}:kubipaca_summer_kubi:`
		);
	}
	const a = [
		'kubi_uemigi',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_gyakuT',
		'kubi_yoko',
		'kubi_uehidari'
	].map((e) => `kubipaca_summer_${e}`);
	for (const e of a) {
		emojiKubipaka.add(e);
	}
	contentArray.push(a.map((e) => `:${e}:`).join(''));
	if (data.mochigoma.sente.length > 0) {
		const black = data.mochigoma.sente.map((e) => `black_${e}`);
		contentArray.push(black.map((e) => `:shogi_${e}:`).join(''));
		for (const koma of black) {
			emojiShogi.add(koma);
		}
	}
	const content: string = contentArray.join('\n');
	const tags = [
		...getTagsReply(event),
		...Array.from(emojiKubipaka).map((s) => [
			'emoji',
			s,
			`https://lokuyow.github.io/images/nostr/emoji/kubipaca_summer/${s}.webp`,
			'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:kubipaca summer'
		]),
		...Array.from(emojiShogi).map((s) => [
			'emoji',
			`shogi_${s}`,
			`https://nikolat.github.io/image/shogi/${s}.png`,
			'30030:6b0a60cff3eca5a2b2505ccb3f7133d8422045cbef40f3d2c6189fb0b952e7d4:shogi'
		])
	];
	return [content, tags];
};

const res_arupaka = (event: NostrEvent): [string, string[][]] => {
	if (event.kind === 1) {
		const nevent =
			'nevent1qvzqqqqq9qpzpmzzcaj5rzeah8y940ln4z855wa72af4a6aac4zjypql55egcpsqqy88wumn8ghj77tpvf6jumt99uqzqvc0c4ly3cu5ylw4af24kp6p50m3tf27zrutkeskcflvjt4utejta8d4mx'; //カスタム絵文字の川
		const ep: nip19.EventPointer = nip19.decode(nevent).data;
		const content = `パブチャでやれ\nnostr:${nevent}`;
		const tags = [...getTagsReply(event), ['q', ep.id, ep.relays?.at(0) ?? '', ep.author ?? '']];
		return [content, tags];
	}
	let content: string;
	let tags: string[][];
	const LIMIT_WIDTH = 10;
	const LIMIT_HEIGHT = 30;
	const LIMIT_BODY = 5;
	let retry_max = 1;
	const isKerubenos = /ケルベ[ロノ]ス/.test(event.content);
	const isBunretsu = /分裂|分散/.test(event.content);
	const isMonopaka = /ものパカ|モノパカ/.test(event.content);
	const isSummer = /夏|サマ|summer/i.test(event.content);
	if (/みじかい|短い/.test(event.content)) {
		retry_max = 0;
	} else if (/ながい|長い/.test(event.content)) {
		retry_max = 2;
		if (/ちょう|超|めっ?ちゃ|クソ/.test(event.content)) {
			retry_max = 3;
			const count = Math.min((event.content.match(/超/g) || []).length, 17);
			retry_max += count;
		}
	}
	let n = Math.min(
		(event.content.match(/アルパカ|🦙|ものパカ|モノパカ|夏パカ/g) || []).length,
		LIMIT_BODY
	);
	if (/-?\d+[匹体]/.test(event.content)) {
		const m = event.content.match(/(-?\d+)[匹体]/) ?? '';
		n = Math.min(parseInt(m[0]), LIMIT_BODY);
		n = Math.max(1, n);
	}
	const save: number[][] = [];
	const x: number[] = [];
	const y: number[] = [];
	const b: number[][] = []; //2つ前の座標を覚えておく
	const c: number[][] = []; //1つ前の座標を覚えておく
	const arrow = new Map<string, string>();
	const finished: boolean[] = [];
	const retry: number[] = [];
	const gaming: boolean[] = [];
	const matchesIterator = event.content.matchAll(
		/((ゲーミング|光|虹|明|🌈)?(アルパカ|🦙|ものパカ|モノパカ|夏パカ))/g
	);
	for (const match of matchesIterator) {
		if (/(ゲーミング|光|虹|明|🌈)(アルパカ|🦙|ものパカ|モノパカ|夏パカ)/.test(match[0])) {
			gaming.push(true);
		} else {
			gaming.push(false);
		}
		if (gaming.length >= LIMIT_BODY) {
			break;
		}
	}
	if (isKerubenos) {
		n = 3;
		save.push([0, 0], [1, 0], [0, 1], [-1, 1], [0, 2], [1, 1]);
		x.push(-1);
		y.push(1);
		b.push([0, 1]);
		c.push([-1, 1]);
		x.push(0);
		y.push(2);
		b.push([0, 1]);
		c.push([0, 2]);
		x.push(1);
		y.push(1);
		b.push([0, 1]);
		c.push([1, 1]);
		for (let i = 0; i < n; i++) {
			finished.push(false);
			retry.push(retry_max);
			if (gaming[i] === undefined) gaming.push(gaming[i - 1]);
		}
		arrow.set('0,0', 'body' + (gaming[0] ? 'g' : ''));
		arrow.set('1,0', '');
		arrow.set('0,1', 'juji' + (gaming[0] ? 'g' : ''));
	} else {
		for (let i = 0; i < n; i++) {
			save.push([0 + 2 * i, 0], [1 + 2 * i, 0], [0 + 2 * i, 1]);
			x.push(0 + 2 * i);
			y.push(1);
			b.push([0 + 2 * i, 0]);
			c.push([0 + 2 * i, 1]);
			finished.push(false);
			retry.push(retry_max);
			if (gaming[i] === undefined) gaming.push(gaming[i - 1]);
			arrow.set(`${0 + 2 * i},0`, 'body' + (gaming[i] ? 'g' : ''));
			arrow.set(`${1 + 2 * i},0`, '');
		}
	}
	const emoji = new Set<string>();
	const emoji_seigen = new Set<string>();
	const emoji_mono = new Set<string>();
	//頭を上下左右にとりあえず動かしてみる
	while (true) {
		if (isBunretsu) {
			const nFix = n;
			for (let i = 0; i < nFix; i++) {
				if (finished[i]) {
					continue;
				}
				const r = Math.floor(Math.random() * 4);
				if (r === 0) {
					finished[n] = finished[i];
					retry[n] = retry[i];
					gaming[n] = gaming[i];
					x[n] = x[i];
					y[n] = y[i];
					b[n] = b[i];
					c[n] = c[i];
					n++;
				}
			}
		}
		for (let i = 0; i < n; i++) {
			if (finished[i]) {
				continue;
			}
			const r = Math.floor(Math.random() * 4);
			let cs = ''; //どっちに動く？
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
			let bs = ''; //どっちから動いてきた？
			if (c[i][0] - b[i][0] > 0) {
				bs = '←';
			} else if (c[i][0] - b[i][0] < 0) {
				bs = '→';
			} else if (c[i][1] - b[i][1] > 0) {
				bs = '↓';
			} else if (c[i][1] - b[i][1] < 0) {
				bs = '↑';
			}
			const x_min = Math.min(...save.map((e) => e[0]), ...x);
			const x_max = Math.max(...save.map((e) => e[0]), ...x);
			const y_min = Math.min(...save.map((e) => e[1]), ...y);
			const y_max = Math.max(...save.map((e) => e[1]), ...y);
			//体にぶつかるか、境界にぶつかるかしたら終わり
			if (
				save.some((e) => e[0] === x[i] && e[1] === y[i]) ||
				Math.abs(x_max - x_min) >= LIMIT_WIDTH ||
				Math.abs(y_max - y_min) >= LIMIT_HEIGHT
			) {
				//クロス(貫通)可能ならクロスする
				const next_arrow = arrow.get(`${x[i]},${y[i]}`) ?? '';
				//上を跨ぐか下を潜るか
				const r = Math.floor(Math.random() * 2);
				if (
					cs === '→' &&
					['↑↓_', '↓↑_'].includes(next_arrow) &&
					!save.some((e) => e[0] === x[i] + 1 && e[1] === y[i]) &&
					Math.max(...save.map((e) => e[0]), x[i] + 1) - x_min < LIMIT_WIDTH
				) {
					if (r) arrow.set(`${x[i]},${y[i]}`, '←→_' + (gaming[i] ? 'g' : ''));
					x[i]++;
				} else if (
					cs === '←' &&
					['↑↓_', '↓↑_'].includes(next_arrow) &&
					!save.some((e) => e[0] === x[i] - 1 && e[1] === y[i]) &&
					x_max - Math.min(...save.map((e) => e[0]), x[i] - 1) < LIMIT_WIDTH
				) {
					if (r) arrow.set(`${x[i]},${y[i]}`, '←→_' + (gaming[i] ? 'g' : ''));
					x[i]--;
				} else if (
					cs === '↑' &&
					['←→_', '→←_'].includes(next_arrow) &&
					!save.some((e) => e[0] === x[i] && e[1] === y[i] + 1) &&
					Math.max(...save.map((e) => e[1]), y[i] + 1) - y_min < LIMIT_HEIGHT
				) {
					if (r) arrow.set(`${x[i]},${y[i]}`, '↑↓_' + (gaming[i] ? 'g' : ''));
					y[i]++;
				} else if (
					cs === '↓' &&
					['←→_', '→←_'].includes(next_arrow) &&
					!save.some((e) => e[0] === x[i] && e[1] === y[i] - 1) &&
					y_max - Math.min(...save.map((e) => e[1]), y[i] - 1) < LIMIT_HEIGHT
				) {
					if (r) arrow.set(`${x[i]},${y[i]}`, '↑↓_' + (gaming[i] ? 'g' : ''));
					y[i]--;
				} else {
					if (retry[i] > 0) {
						retry[i]--;
						[x[i], y[i]] = c[i]; //元の状態に戻してリトライ
						i--;
						continue;
					}
					if (!arrow.has(`${c[i][0]},${c[i][1]}`)) {
						arrow.set(`${c[i][0]},${c[i][1]}`, bs + '■_' + (gaming[i] ? 'g' : ''));
					}
					finished[i] = true;
					continue;
				}
			}
			save.push([x[i], y[i]]); //体の座標をマッピング
			//この座標はどっちから動いてきてどっちに動いた？
			const arrowE = arrow.get(`${c[i][0]},${c[i][1]}`);
			if (arrowE === undefined) {
				arrow.set(`${c[i][0]},${c[i][1]}`, bs + cs + '_' + (gaming[i] ? 'g' : ''));
			} else {
				const bsE = arrowE.slice(0, 1);
				const csE = arrowE.slice(1, 2);
				if (csE === '■') {
					arrow.set(`${c[i][0]},${c[i][1]}`, bs + cs + '_' + (gaming[i] ? 'g' : ''));
				} else {
					arrow.set(`${c[i][0]},${c[i][1]}`, bsE + csE + cs + (gaming[i] ? 'g' : ''));
				}
			}
			retry[i] = retry_max;
			b[i] = c[i];
			c[i] = [x[i], y[i]];
		}
		if (finished.every((f) => f)) {
			break;
		}
	}
	//レンダリング
	const x_min = Math.min(...save.map((e) => e[0]));
	const x_max = Math.max(...save.map((e) => e[0]));
	const y_min = Math.min(...save.map((e) => e[1]));
	const y_max = Math.max(...save.map((e) => e[1]));
	const exist_limit_width = x_max - x_min === LIMIT_WIDTH - 1;
	const exist_limit_height = y_max - y_min === LIMIT_HEIGHT - 1;
	let lines = [];
	for (let y = y_max; y >= y_min; y--) {
		let line = '';
		let x_max;
		if (exist_limit_width) {
			x_max = Math.max(...save.map((e) => e[0]));
		} else {
			x_max = Math.max(...save.filter((e) => e[1] === y).map((e) => e[0]));
		}
		for (let x = x_min; x <= x_max; x++) {
			if (save.some((e) => e[0] === x && e[1] === y)) {
				let s = arrow.get(`${x},${y}`);
				if (s === undefined) {
					throw new Error();
				}
				let k;
				switch (s.slice(0, 3)) {
					case '←→_':
					case '→←_':
						k = 'kubipaca_kubi_yoko';
						break;
					case '↑↓_':
					case '↓↑_':
						k = 'kubipaca_kubi';
						break;
					case '↑→_':
					case '→↑_':
						k = 'kubipaca_kubi_uemigi';
						break;
					case '↑←_':
					case '←↑_':
						k = 'kubipaca_kubi_uehidari';
						break;
					case '→↓_':
					case '↓→_':
						k = 'kubipaca_kubi_migisita';
						break;
					case '←↓_':
					case '↓←_':
						k = 'kubipaca_kubi_hidarisita';
						break;
					case '↓■_':
						if (isMonopaka) {
							k = 'monopaka';
							emoji_mono.add(k);
						} else {
							k = 'kubipaca_kao';
						}
						break;
					case '←■_':
						if (isMonopaka) {
							k = 'monopaka_r';
							emoji_mono.add(k);
						} else {
							k = 'kubipaca_kao_migi';
						}
						break;
					case '→■_':
						if (isMonopaka) {
							k = 'monopaka_l';
							emoji_mono.add(k);
						} else {
							k = 'kubipaca_kao_hidari';
						}
						break;
					case '↑■_':
						if (isMonopaka) {
							k = 'monopaka_gyaku';
							emoji_mono.add(k);
						} else {
							k = 'kubipaca_kao_sakasa';
						}
						break;
					case 'bod':
						k = 'kubipaca_karada';
						break;
					case 'juj':
						k = 'kubipaca_kubi_juji';
						break;
					default:
						const a = s.slice(0, 3);
						if (['↑', '→', '↓'].every((arw) => a.includes(arw))) {
							k = 'kubipaca_kubi_hidariT';
						} else if (['→', '↓', '←'].every((arw) => a.includes(arw))) {
							k = 'kubipaca_kubi_T';
						} else if (['↓', '←', '↑'].every((arw) => a.includes(arw))) {
							k = 'kubipaca_kubi_migiT';
						} else if (['←', '↑', '→'].every((arw) => a.includes(arw))) {
							k = 'kubipaca_kubi_gyakuT';
						}
						break;
				}
				if (k) {
					if (!k.startsWith('monopaka') && s.at(-1) === 'g') {
						k = `${k}_gaming`;
					}
					if (!k.startsWith('monopaka')) {
						emoji.add(k);
					}
					s = `:${k}:`;
				}
				line += s;
			} else {
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
	if (isSummer) {
		content = content
			.replaceAll('kubipaca_', 'kubipaca_summer_')
			.replaceAll('kubipaca_summer_null', 'kubipaca_summer_empty');
	}
	tags = [
		...getTagsReply(event),
		...Array.from(emoji).map((s) => [
			'emoji',
			isSummer
				? s
						.replace('kubipaca_', 'kubipaca_summer_')
						.replaceAll('kubipaca_summer_null', 'kubipaca_summer_empty')
				: s,
			`https://lokuyow.github.io/images/nostr/emoji/${isSummer ? 'kubipaca_summer' : s.endsWith('_gaming') ? 'kubipaca_gaming' : 'kubipaca'}/${isSummer ? s.replace('kubipaca_', 'kubipaca_summer_').replaceAll('kubipaca_summer_null', 'kubipaca_summer_empty') : s}.webp`,
			`30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:${isSummer ? 'kubipaca summer' : s.endsWith('_gaming') ? 'kubipaca gaming' : 'kubipaca'}`
		]),
		...Array.from(emoji_seigen).map((s) => [
			'emoji',
			s,
			`https://raw.githubusercontent.com/uchijo/my-emoji/main/seigen_set/${s}.png`,
			'30030:e62f27d2814a25171c466d2d7612ad1a066db1362b4e259db5c076f9e6b21cb7:seigen-set'
		]),
		...Array.from(emoji_mono).map((s) => [
			'emoji',
			s,
			`https://raw.githubusercontent.com/TsukemonoGit/TsukemonoGit.github.io/main/img/emoji/${s}.webp`,
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:mono'
		])
	];
	return [content, tags];
};

const res_slot = (event: NostrEvent): [string, string[][]] => {
	const slotBase: [string, string][] = [
		[
			'wakame',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/1a656f3d22d289ffaf7cc49f2e75b80fe7b47bc4e37bea9c3a26f7c485401a78.webp'
		],
		[
			'donguri',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/5c13be7d82c1c0fc885d8256e19ff2d924f604aef2aafff9129bac967e01c2a5.webp'
		],
		[
			'nan',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/4d0bf4959bf1d2ff7ec4084a8d1c15ee4866a3c0189bb4f0930b60e93b79e8de.webp'
		],
		[
			'uni',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/64edaf193e60541431b74442ee07bf4d4b5afd1ecdf35bb580349abd988e32d7.webp'
		],
		[
			'kagami_mochi',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/ae4e2d0aa7b0bbaab2ba70183537c0026f28c31e3073ed621de0b56d9abdf047.webp'
		],
		[
			'drill',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/e413d45c53f7c903088ef7ee8a2ebb147e2486bd5504dd698667eaf69a947379.webp'
		],
		[
			'green_piman',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/5f9cbd1650150c3fbe64d38b11a1769e07a72ad7ee4ea563aabbdb68bff8997b.webp'
		],
		[
			'yellow_piman',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/4db46434171be71a9b482a09afa91e46971b821b6284c0b13c986a721d8079a5.webp'
		],
		[
			'red_piman',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/823516d937c751cbcb4cc9f72c683cf16f425e1cea5ea83f8344b5a298de1408.webp'
		],
		[
			'kyabetu',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/633a6ce843a27decbde123709787029ea78636a1949c32811b799dc3d97361f5.webp'
		],
		[
			'colocolo',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/014db72c2b23cdc1dabd380a3b2f2e1006a7a888a978428402158d5c03286d36.webp'
		],
		[
			'negi',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/d2ef5a469735c945f867f9c86738d1b53bc18428deabce6ef9afe4a2984e202f.webp'
		],
		[
			'kinkai',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/3a0145f9259f9b06d6e106f58913e8c4dca7c0336618b244c2fb3f777f55f276.webp'
		]
	];
	const shuffle = (array: [string, string][]) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	};
	const slot_shuffle = shuffle(slotBase).slice(0, 5);
	const getImage = (): [string, string] => {
		return slot_shuffle[Math.floor(Math.random() * slot_shuffle.length)];
	};
	const slot: [string, string][] = [getImage(), getImage(), getImage()];
	const imageEmojiMap: Map<string, string> = new Map<string, string>(slot.map((e) => [e[0], e[1]]));
	const emoji = [
		'kubipaca_summer_kubi_migisita',
		'kubipaca_summer_kubi_yoko',
		'kubipaca_summer_kubi_T',
		'kubipaca_summer_kubi_hidarisita',
		'kubipaca_summer_kubi',
		'kubipaca_summer_kubi_uemigi',
		'kubipaca_summer_kubi_gyakuT',
		'kubipaca_summer_kubi_uehidari'
	];
	const content: string = [
		':kubipaca_summer_kubi_migisita::kubipaca_summer_kubi_yoko::kubipaca_summer_kubi_T::kubipaca_summer_kubi_yoko::kubipaca_summer_kubi_T::kubipaca_summer_kubi_yoko::kubipaca_summer_kubi_hidarisita:',
		`:kubipaca_summer_kubi:${slot.map((e) => `:${e[0]}:`).join(':kubipaca_summer_kubi:')}:kubipaca_summer_kubi:`,
		':kubipaca_summer_kubi_uemigi::kubipaca_summer_kubi_yoko::kubipaca_summer_kubi_gyakuT::kubipaca_summer_kubi_yoko::kubipaca_summer_kubi_gyakuT::kubipaca_summer_kubi_yoko::kubipaca_summer_kubi_uehidari:'
	].join('\n');
	const tags = [
		...getTagsReply(event),
		...Array.from(imageEmojiMap.entries()).map((e) => [
			'emoji',
			e[0],
			e[1],
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:iroiro'
		]),
		...emoji.map((s) => [
			'emoji',
			s,
			`https://lokuyow.github.io/images/nostr/emoji/kubipaca_summer/${s}.webp`,
			'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:kubipaca summer'
		])
	];
	return [content, tags];
};

const res_kerubenos = (event: NostrEvent): [string, string[][]] => {
	const getKubi = (): [string, [string, string]] => {
		const normal: Map<string, [string, string]> = new Map([
			[
				'nostopus_eating',
				[
					'https://awayuki.github.io/emoji/np-027.png',
					'30030:cd408a69cc6c737ca1a76efc3fa247c6ca53ec807f6e7c9574164164797e8162:Nostopus'
				]
			],
			[
				'kubipaca_kao',
				[
					'https://lokuyow.github.io/images/nostr/emoji/kubipaca/kubipaca_kao.webp',
					'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:kubipaca'
				]
			],
			[
				'monopaca_kao',
				[
					'https://raw.githubusercontent.com/TsukemonoGit/TsukemonoGit.github.io/main/img/emoji/monopaka.webp',
					'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:mono'
				]
			]
		]);
		const rare: Map<string, [string, string]> = new Map([
			[
				'shining_tiger_close_up',
				[
					'https://raw.githubusercontent.com/shibayamap/Custom_emoji/main/tiger_close_up.webp',
					'30030:d947f9664226bd61d2791e57b9eda7ed6a863558f0ca5b633a57d665abf1c11f:hoshii-yatsu'
				]
			],
			[
				'monobeampaca_kao',
				[
					'https://image.nostr.build/b63e654b02d001c0f49a0a6d4b2a766215be1571709d7576f6fc238e9b21f572.png',
					'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:mono'
				]
			],
			[
				'very_sad',
				[
					'https://i.floppy.media/d2a0f27fe29bbee7eb2a7abc669e25d1.png',
					'30030:b707d6be7fd9cc9e1aee83e81c3994156cfcf74ded5b09111930fdeeeb5a0c20:MatsudaiTalk™'
				]
			]
		]);
		const r = Math.floor(Math.random() * 10) === 0 ? rare : normal;
		return Array.from(r)[Math.floor(Math.random() * r.size)];
	};
	const slot: [string, [string, string]][] = [getKubi(), getKubi(), getKubi()];
	const headEmojiMap: Map<string, [string, string]> = new Map<string, [string, string]>(
		slot.map((kubi) => [kubi[0], kubi[1]])
	);
	const emoji = [
		'kubipaca_kubi_uemigi',
		'kubipaca_kubi_juji',
		'kubipaca_kubi_uehidari',
		'kubipaca_null',
		'kubipaca_karada_l',
		'kubipaca_karada_r'
	];
	const content: string =
		slot.map((kubi) => `:${kubi[0]}:`).join('') +
		`\n:${emoji[0]}::${emoji[1]}::${emoji[2]}:\n:${emoji[3]}::${emoji[4]}::${emoji[5]}:`;
	const tags = [
		...getTagsReply(event),
		...Array.from(headEmojiMap.entries()).map((kubi) => ['emoji', kubi[0], kubi[1][0], kubi[1][1]]),
		...emoji.map((s) => [
			'emoji',
			s,
			`https://lokuyow.github.io/images/nostr/emoji/kubipaca/${s}.webp`,
			'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:kubipaca'
		])
	];
	return [content, tags];
};

const res_tiger = (event: NostrEvent): [string, string[][]] => {
	const shuffle = (array: string[]) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	};
	const tigers = [
		'tiger_upper_left',
		'tiger_upper_right',
		'tiger_middle_left',
		'tiger_middle_right',
		'tiger_lower_left',
		'tiger_lower_right'
	];
	const tiger_shuffle = shuffle(tigers.map((t) => `:${t}:`));
	const content: string = `${tiger_shuffle[0]}${tiger_shuffle[1]}\n${tiger_shuffle[2]}${tiger_shuffle[3]}\n${tiger_shuffle[4]}${tiger_shuffle[5]}`;
	const url_base = 'https://raw.githubusercontent.com/shibayamap/Custom_emoji/main/';
	const tags: string[][] = [
		...tigers.map((t) => [
			'emoji',
			t,
			`${url_base}${t}.webp`,
			'30030:d947f9664226bd61d2791e57b9eda7ed6a863558f0ca5b633a57d665abf1c11f:hoshii-yatsu'
		]),
		...getTagsReply(event)
	];
	return [content, tags];
};

const res_bear = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://kumadas.net/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_seigen = (event: NostrEvent): [string, string[][]] => {
	const shuffle = (array: string[]) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	};
	const seigens = ['aru', 'ga', 'ha', 'nai', 'ni', 'niha', 'nimo', 'oretachi', 'seigen', 'niwa'];
	const seigens_shuffle = shuffle(seigens.map((t) => `seigen_${t}`)).slice(0, 5);
	const seigens_shuffle_for_content = seigens_shuffle.map((t) => `:${t}:`);
	const content: string = seigens_shuffle_for_content.join('');
	const url_base = 'https://raw.githubusercontent.com/uchijo/my-emoji/main/seigen_set/';
	const tags: string[][] = [
		...seigens_shuffle.map((t) => [
			'emoji',
			t,
			`${url_base}${t}.png`,
			'30030:e62f27d2814a25171c466d2d7612ad1a066db1362b4e259db5c076f9e6b21cb7:seigen-set'
		]),
		...getTagsReply(event)
	];
	return [content, tags];
};

const res_akamimigame = (event: NostrEvent): [string, string[][]] => {
	const shuffle = (array: string[]) => {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	};
	const kames = ['aka', 'demi', 'game', 'kku', 'kusa', 'mi', 'mimi', 'misi', 'pi', 'ppi', 'si'];
	const kames_shuffle = shuffle(kames.map((t) => `kame_${t}`)).slice(0, 6);
	const kames_shuffle_for_content = kames_shuffle.map((t) => `:${t}:`);
	const content: string = kames_shuffle_for_content.join('');
	const url_base = 'https://raw.githubusercontent.com/uchijo/my-emoji/main/kame_set/';
	const tags: string[][] = [
		...kames_shuffle.map((t) => [
			'emoji',
			t,
			`${url_base}${t}.png`,
			'30030:e62f27d2814a25171c466d2d7612ad1a066db1362b4e259db5c076f9e6b21cb7:カメ'
		]),
		...getTagsReply(event)
	];
	return [content, tags];
};

const getEvents30030 = async (pubkey: string): Promise<NostrEvent[]> => {
	const resEvents: NostrEvent[] = [];
	const event10030: NostrEvent | undefined = await getEvent(emojiSearchRelay, [
		{ kinds: [10030], authors: [pubkey] }
	]);
	if (event10030 === undefined) {
		return [];
	}
	const aTags = event10030.tags.filter((tag) => tag.length >= 2 && tag[0] === 'a');
	const filters: Filter[] = [];
	for (const aTag of aTags) {
		const aid = aTag[1];
		const [kind, pubkey, d] = aid.split(':');
		const filter: Filter = { kinds: [parseInt(kind)], authors: [pubkey] };
		if (d !== undefined) {
			filter['#d'] = [d];
		}
		filters.push(filter);
	}
	const sliceByNumber = (array: any[], number: number) => {
		const length = Math.ceil(array.length / number);
		return new Array(length)
			.fill(undefined)
			.map((_, i) => array.slice(i * number, (i + 1) * number));
	};
	const filterGroups = [];
	for (const filterGroup of sliceByNumber(mergeFilterForAddressableEvents(filters, 30030), 10)) {
		filterGroups.push(filterGroup);
	}
	await Promise.all(
		filterGroups.map(async (filterGroup) => {
			await getEvents(emojiSearchRelay, filterGroup, (ev: NostrEvent) => {
				resEvents.push(ev);
			});
		})
	);
	return resEvents;
};

const res_imanokibun = async (event: NostrEvent): Promise<[string, string[][]]> => {
	const events30030: NostrEvent[] = await getEvents30030(event.pubkey);
	const emojiMap: Map<string, [string, string]> = new Map<string, [string, string]>();
	for (const ev30030 of events30030) {
		for (const tag of ev30030.tags.filter(isEmojiTag)) {
			const d: string | undefined = ev30030.tags
				.find((tag) => tag.length >= 2 && tag[0] === 'd')
				?.at(1);
			if (d !== undefined) {
				emojiMap.set(tag[1], [tag[2], `30030:${ev30030.pubkey}:${d}`]);
			}
		}
	}
	if (emojiMap.size === 0) {
		return ['なんとも言えん気分やな', getTagsReply(event)];
	}
	const emojis: [string, [string, string]][] = Array.from(emojiMap.entries());
	const emoji16: [string, [string, string]][] = [];
	const eomji16Map: Map<string, [string, string]> = new Map<string, [string, string]>();
	for (let i = 0; i < 16; i++) {
		const r = Math.floor(Math.random() * emojis.length);
		emoji16.push(emojis[r]);
		eomji16Map.set(...emojis[r]);
	}
	const content: string = [0, 4, 8, 12]
		.map((i) =>
			emoji16
				.slice(i, i + 4)
				.map((e) => `:${e[0]}:`)
				.join('')
		)
		.join('\n');
	const tags: string[][] = [
		...Array.from(eomji16Map.entries()).map((t) => ['emoji', t[0], t[1][0], t[1][1]]),
		...getTagsReply(event)
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
	} else if (/つぎはなにから？$/.test(event.content)) {
		content = any(['r!next', '🦊❗🔜']);
		tags = [];
	} else if (/りとりんポイント獲得状況/.test(event.content)) {
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `${any(['これ何使えるんやろ', 'もっと頑張らなあかんな', 'こんなもんやな'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
	} else {
		return null;
	}
	return [content, tags];
};

const res_badge = (event: NostrEvent): [string, string[][]] | null => {
	return ['\\![*]', getTagsReply(event)];
};

const res_others_badge = (event: NostrEvent): [string, string[][]] | null => {
	return ['\\![*]', getTagsReply(event)];
};

const getBadgeEventTemplate = (event: NostrEvent): EventTemplate => {
	const badgeEvent: EventTemplate = {
		kind: 8,
		tags: [
			[
				'a',
				'30009:2bb2abbfc5892b7bda8f78d53682d913cc9a446b45e11929f0935d8fdfcb40bd:unyu-enyee',
				badgeRelays[0]
			],
			['p', event.pubkey]
		],
		content: '',
		created_at: event.created_at + 1
	};
	return badgeEvent;
};

const getOthersBadgeEventTemplate = (event: NostrEvent): EventTemplate => {
	const qTag = event.tags.find((tag) => tag.length >= 2 && tag[0] === 'q');
	if (qTag === undefined) {
		return getBadgeEventTemplate(event);
	}
	const aTag = [...qTag];
	aTag[0] = 'a';
	const badgeEvent: EventTemplate = {
		kind: 8,
		tags: [aTag, ['p', event.pubkey]],
		content: '',
		created_at: event.created_at + 1
	};
	return badgeEvent;
};

const res_resent_poll = async (event: NostrEvent): Promise<[string, string[][]]> => {
	const event3: NostrEvent | undefined = await getEvent(followSearchRelay, [
		{ kinds: [3], authors: [event.pubkey], until: Math.floor(Date.now() / 1000), limit: 1 }
	]);
	const pubkeys: string[] = event3?.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]) ?? [];
	const events1068: NostrEvent[] = [];
	const filter: Filter = {
		kinds: [1068],
		authors: pubkeys,
		until: Math.floor(Date.now() / 1000),
		limit: 5
	};
	await getEvents(followSearchRelay, [filter], (ev: NostrEvent) => {
		events1068.push(ev);
	});
	if (events1068.length === 0) {
		return ['見つからへん', getTagsReply(event)];
	}
	const tags: string[][] = [];
	const nevents: string[] = [];
	for (const event1068 of events1068) {
		const nevent: string = `nostr:${nip19.neventEncode({ ...event1068, author: event1068.pubkey, relays: [followSearchRelay] })}`;
		nevents.push(nevent);
		tags.push(['q', event1068.id, followSearchRelay, event1068.pubkey]);
	}
	const pollUrl = `https://pollerama.fun/`;
	const content = `${nevents.join('\n')}\n${pollUrl}`;
	tags.push(...getTagsReply(event));
	tags.push(['r', pollUrl]);
	return [content, tags];
};

const res_poll = (event: NostrEvent): [string, string[][]] | null => {
	try {
		const _pollEvent: EventTemplate = getPollEventTemplate(event, []);
	} catch (_error) {
		return [
			'こんな感じで2個以上の項目を書くんや:\n次のうちどれがいい？\n- 項目1\n- 項目2',
			getTagsReply(event)
		];
	}
	return ['\\__q', getTagsReply(event)];
};

const getPollEventTemplate = (event: NostrEvent, relaysToWrite: string[]): EventTemplate => {
	const pollContentArray: string[] = [];
	const pollItems: string[] = [];
	let isItemsField: boolean = false;
	for (const line of event.content.split('\n')) {
		if (!isItemsField) {
			if (line.startsWith('-')) {
				isItemsField = true;
			} else {
				pollContentArray.push(line);
			}
		}
		if (isItemsField) {
			if (line.startsWith('-')) {
				pollItems.push(line.replace('-', '').trim());
			}
		}
	}
	if (pollContentArray.length === 0 || pollItems.length < 2) {
		throw new Error();
	}
	const pollKind: number = 1068;
	const pollType: string = pollContentArray[0].includes('複数') ? 'multiplechoice' : 'singlechoice';
	const pollEndsAt: number = event.created_at + 1 * 24 * 60 * 60;
	const getRandomString = (n: number): string => {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		return [...Array(n)]
			.map((_) => chars.charAt(Math.floor(Math.random() * chars.length)))
			.join('');
	};
	const pollTags: string[][] = [
		...pollItems.map((item) => ['option', getRandomString(9), item]),
		...relaysToWrite.map((relay) => ['relay', relay]),
		['polltype', pollType],
		['endsAt', String(pollEndsAt)]
	];
	const emojiTags: string[][] = event.tags.filter(isEmojiTag);
	if (emojiTags.length > 0) {
		pollTags.push(...emojiTags);
	}
	const pollEvent: EventTemplate = {
		kind: pollKind,
		tags: pollTags,
		content: pollContentArray.slice(1).join('\n'),
		created_at: event.created_at + 1
	};
	return pollEvent;
};

const res_madagasukaru = (event: NostrEvent): [string, string[][]] => {
	return ['🌍👈ここやで', getTagsReply(event)];
};

const res_iisutato = (event: NostrEvent): [string, string[][]] => {
	return ['🌎👈ここやで', getTagsReply(event)];
};

const res_uranai = async (event: NostrEvent): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const type = any([
		'牡羊座',
		'牡牛座',
		'双子座',
		'蟹座',
		'獅子座',
		'乙女座',
		'天秤座',
		'蠍座',
		'射手座',
		'山羊座',
		'水瓶座',
		'魚座',
		'A型',
		'B型',
		'O型',
		'AB型',
		'寂しがりや',
		'独りぼっち',
		'社畜',
		'営業職',
		'接客業',
		'自営業',
		'世界最強',
		'石油王',
		'海賊王',
		'次期総理',
		'駆け出しエンジニア',
		'神絵師',
		'ノス廃',
		'マナー講師',
		'インフルエンサー',
		'一般の主婦',
		'ビットコイナー',
		'ブロッコリー農家',
		'スーパーハカー',
		'ふぁぼ魔',
		'歩くNIP',
		'きのこ派',
		'たけのこ派'
	]);
	const star = any([
		'★★★★★',
		'★★★★☆',
		'★★★☆☆',
		'★★☆☆☆',
		'★☆☆☆☆',
		'大吉',
		'中吉',
		'小吉',
		'吉',
		'末吉',
		'凶',
		'大凶',
		'🍆🍆🍆🍆🍆',
		'🥦🥦🥦🥦🥦',
		'🍅🍅🍅🍅🍅',
		'🚀🚀🚀🚀🚀',
		'📃📃📃📃📃',
		'🐧🐧🐧🐧🐧',
		'👍👍👍👍👍',
		'💪💪💪💪💪'
	]);
	const url = 'http://buynowforsale.shillest.net/ghosts/ghosts/index.rss';
	const parser = new Parser();
	const feed = await parser.parseURL(url);
	const index = Math.floor(Math.random() * feed.items.length);
	const link = feed.items[index].link;
	tags = getTagsReply(event);
	if (link === undefined) {
		content = '今日は占う気分ちゃうな';
	} else {
		content = `${type}のあなたの今日の運勢は『${star}』\nラッキーゴーストは『${feed.items[index].title}』やで\n${feed.items[index].link}`;
		tags.push(['r', link]);
	}
	return [content, tags];
};

const res_kyomonan = (event: NostrEvent): [string, string[][]] => {
	const emojiList: [string, string, string][] = [
		[
			'nan',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/4d0bf4959bf1d2ff7ec4084a8d1c15ee4866a3c0189bb4f0930b60e93b79e8de.webp',
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:iroiro'
		],
		[
			'nan_dato',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/119812c7a9353ffb18c14b3bd6fbc8651a84072428fbb9ceab25c908b0c5eb7a.webp',
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:moji'
		],
		[
			'nanii',
			'https://images.kinoko.pw/drive/13b87a84-63fc-4696-858d-fc70ef8c68e8.webp',
			'30030:2dd8b84b6ba6fc3bf6b128f6d839541b115a0b3f9954646ba5bd57059b9934d5:kinoko.pw'
		],
		[
			'nanikaga_okashii',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/3d777183918b973f0a21de446a73b22d6c88a94e3f006d404b331496a3698de5.webp',
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:moji'
		],
		[
			'nanikore',
			'https://images.kinoko.pw/drive/thumbnail-65564448-a167-4f19-b393-5f28771897f5.webp',
			'30030:2dd8b84b6ba6fc3bf6b128f6d839541b115a0b3f9954646ba5bd57059b9934d5:kinoko.pw'
		],
		[
			'nanimowakaranai',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/811d6ef1c6a21b19296680dd21182c0ce11114482a6c448dc3be7aba13f337ed.webp',
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:moji'
		],
		[
			'nanmoda',
			'https://haniwar.com/emoji/akitaben/nanmoda.png',
			'30030:f08a93704245801d7e5e6377f878e9c3ea2dfdf7419dc89efcf2b5d7a5f627d9:Akitaben'
		],
		[
			'nanmoya',
			'https://haniwar.com/emoji/akitaben/nanmoya.png',
			'30030:f08a93704245801d7e5e6377f878e9c3ea2dfdf7419dc89efcf2b5d7a5f627d9:Akitaben'
		],
		[
			'nannwaka',
			'https://share.yabu.me/84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5/65c01a324a2f6a1be1681d94064b50a14a83c84fd6d8c36b99db4eaf6a3516b3.webp',
			'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:moji'
		],
		[
			'nantoka',
			'https://cdn.nostrcheck.me/a19caaa8404721584746fb0e174cf971a94e0f51baaf4c4e8c6e54fa88985eaf/8cd387ad21474ecb772d6cb5491ca3b9879d1fcf077047fbb8cfcbb4d82754a1.webp',
			'30030:a19caaa8404721584746fb0e174cf971a94e0f51baaf4c4e8c6e54fa88985eaf:odaijini'
		]
	];
	const [shortcode, url, address] = emojiList[Math.floor(Math.random() * emojiList.length)];
	const content: string = `:kyomu::${shortcode}:`;
	const tags: string[][] = [
		...getTagsReply(event),
		[
			'emoji',
			'kyomu',
			'https://lokuyow.github.io/images/nostr/emoji/generalJP/kyomu.webp',
			'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:generalJP'
		],
		['emoji', shortcode, url, address]
	];
	return [content, tags];
};

const res_gogonan = (event: NostrEvent): [string, string[][]] => {
	const content1: string = ':gogo_chance::nantoka:';
	const tags1: string[][] = [
		...getTagsReply(event),
		[
			'emoji',
			'gogo_chance',
			'https://raw.githubusercontent.com/invertedtriangle358/images/main/EMOJI/%E3%82%B4%E3%83%BC%E3%82%B4%E3%83%BC%E3%83%81%E3%83%A3%E3%83%B3%E3%82%B9.png',
			'30030:7dc1677112f05eaf49547806543b1c006ce3257278e52b1c9abff63270ed704f:Nostr Japan meme'
		],
		[
			'emoji',
			'nantoka',
			'https://cdn.nostrcheck.me/a19caaa8404721584746fb0e174cf971a94e0f51baaf4c4e8c6e54fa88985eaf/8cd387ad21474ecb772d6cb5491ca3b9879d1fcf077047fbb8cfcbb4d82754a1.webp',
			'30030:a19caaa8404721584746fb0e174cf971a94e0f51baaf4c4e8c6e54fa88985eaf:odaijini'
		]
	];
	const res1: [string, string[][]] = [content1, tags1];
	const content2: string =
		'nostr:nevent1qvzqqqqqqypzqh6xs7flnfaawzp8ekk4c4nhu0jejla985yjp24vfccz4sx53688qy88wumn8ghj77tpvf6jumt99uqjzamnwvaz7tmjv4kxz7fddfczumn0wd68ytnhd9ex2erwv46zu6ns9uqzq0x7pjgalykzrnj7amfh3klz0wgp8qjd0tz6z0lzme0cm8g82wtryy27m8';
	const tags2: string[][] = [
		...getTagsReply(event),
		[
			'q',
			'3cde0c91df92c21ce5eeed378dbe27b9013824d7ac5a13fe2de5f8d9d0753963',
			'wss://yabu.me/',
			'5f468793f9a7bd70827cdad5c5677e3e5997fa53d0920aaac4e302ac0d48e8e7'
		]
	];
	const res2: [string, string[][]] = [content2, tags2];
	const res: [string, string[][]][] = [res1, res2];
	return res[Math.floor(Math.random() * res.length)];
};

const res_yoshie = (event: NostrEvent): [string, string[][]] => {
	const a: [string, string[][]][] = [
		[
			':yoshie:',
			[
				...getTagsReply(event),
				[
					'emoji',
					'yoshie',
					'https://tac-lan.net/.well-known/yoshie.png',
					'30030:81bbb510f2a6ecb221d1df36219e37a63ce2372795b4cb14759c8cd8468799a6:moji pack'
				]
			]
		],
		[
			':miyuki:',
			[
				...getTagsReply(event),
				[
					'emoji',
					'miyuki',
					'https://tac-lan.net/.well-known/miyuki.png',
					'30030:81bbb510f2a6ecb221d1df36219e37a63ce2372795b4cb14759c8cd8468799a6:moji pack'
				]
			]
		]
	];
	const i = Math.floor(Math.random() * a.length);
	return a[i];
};

const res_curry = (event: NostrEvent): [string, string[][]] => {
	const getRandomString = (n: number): string => {
		const str = Array.from(
			'🍇🍈🍉🍊🍋🍌🍍🥭🍎🍏🍐🍑🍒🍓🫐🥝🍅🫒🥥🥑🍆🥔🥕🌽🌶️🫑🥒🥬🥦🧄🧅🥜🫘🌰🫚🫛🍞🥐🥖🫓🥨🥯🥞🧇🧀🍖🍗🥩🥓🍔🍟🍕🌭🥪🌮🌯🫔🥙🧆🥚🍳🥘🍲🫕🥣🥗🍿🧈🧂🥫🍱🍘🍙🍚🍛🍜🍝🍠🍢🍣🍤🍥🥮🍡🥟🥠🥡🦀🦞🦐🦑🦪🍦🍧🍨🍩🍪🎂🍰🧁🍫🍬🍭🍮🍯🍼🥛☕🫖🍵🍶🍾🍷🍸🍹🍺🍻🥂🥃🫗🥤🧋🧃🧉🧊'
		);
		return [...Array(n)].map((_) => str.at(Math.floor(Math.random() * str.length))).join('');
	};
	const content: string = getRandomString(4);
	const tags: string[][] = getTagsReply(event);
	return [content, tags];
};

const res_tatsunootoshigo = (event: NostrEvent): [string, string[][]] => {
	const getRandomStringArray = (n: number): string[] => {
		const str = Array.from('🦑🦞🦐🦀🐠🐡🐟🐬🦈🐳🦄🐉');
		return [...Array(n)]
			.map((_) => str.at(Math.floor(Math.random() * str.length)))
			.filter((s) => s !== undefined);
	};
	const ary: string[] = getRandomStringArray(Math.floor(Math.random() * 9 + 1));
	let content: string = '';
	for (const s of ary.slice(0, -2)) {
		content +=
			s +
			any([
				'……やなくて',
				'……もちゃうし',
				'……とみせかけて',
				'……なわけあらへんし',
				'……はワイの趣味ちゃうし',
				'……は昨日食ったし'
			]) +
			'\n';
	}
	content += ary.at(-1) + 'やで';
	const tags: string[][] = getTagsReply(event);
	return [content, tags];
};

const res_akachannoshincho = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['赤ちゃんの身長のことやで', '赤ちゃんの身長のことやな', '赤ちゃんの身長を指す言葉や']),
		getTagsReply(event)
	];
};

const res_tenki = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp
): Promise<[string, string[][]]> => {
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
		for (const [k, v] of [
			...Object.entries(json_area.class20s),
			...Object.entries(json_area.class15s),
			...Object.entries(json_area.class10s)
		]) {
			const name = (v as any).name;
			if (name.includes(text)) {
				code = k.slice(0, -3) + '000'; //3桁目がある都市もあるのでもっと真面目にやるべき
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
			tags.push(['p', nip19.decode(npub_yabumi).data as string]);
		} else {
			tags = getTagsReply(event);
		}
		return [content, tags];
	}
	let baseurl: string;
	const m3 = match[4];
	if (m3) {
		baseurl = 'https://www.jma.go.jp/bosai/forecast/data/overview_week/';
	} else {
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
		} else {
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
	return ['\\s[11]ありえへん……このワイが……', getTagsReply(event)];
};

const res_tanzakunishite = (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp
): [string, string[][]] => {
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[3];
	const textAry: string[] = [];
	const emojiUrlMap: Map<string, string> = new Map<string, string>();
	for (const tag of event.tags) {
		if (isEmojiTag(tag)) {
			emojiUrlMap.set(`:${tag[1]}:`, tag[2]);
		}
	}
	if (emojiUrlMap.size > 0) {
		const regMatchStr: string = `(${Array.from(emojiUrlMap.keys()).join('|')})`;
		const regSplit = new RegExp(regMatchStr);
		const plainTexts = text.split(regSplit);
		for (const t of plainTexts) {
			if (emojiUrlMap.has(t)) {
				textAry.push(t);
			} else {
				textAry.push(...Array.from(t));
			}
		}
	} else {
		textAry.push(...Array.from(text));
	}
	const [hiraText, emoji_tags] = getResEmojinishite(textAry.join('\n'), event.tags);
	let content = ':hukidasi_hidariue::hukidasi_yoko::hukidasi_migiue:\n';
	for (const hira of hiraText.split('\n')) {
		content += `:hukidasi_tate:${hira}:hukidasi_tate:\n`;
	}
	content += ':hukidasi_hidarisita::hukidasi_yoko::hukidasi_migisita:';
	const emojis = [
		'hukidasi_yoko',
		'hukidasi_hidariue',
		'hukidasi_migiue',
		'hukidasi_tate',
		'hukidasi_hidarisita',
		'hukidasi_migisita'
	];
	for (const emoji of emojis) {
		emoji_tags.push([
			'emoji',
			emoji,
			`https://lokuyow.github.io/images/nostr/emoji/hukidasi/${emoji}.webp`,
			'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:hukidasi'
		]);
	}
	return [content, [...getTagsReply(event), ...emoji_tags]];
};

const res_slotnishite = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[3];
	const textAry: string[] = [];
	const emojiUrlMap: Map<string, string> = new Map<string, string>();
	for (const tag of event.tags) {
		if (isEmojiTag(tag)) {
			emojiUrlMap.set(`:${tag[1]}:`, tag[2]);
		}
	}
	if (emojiUrlMap.size > 0) {
		const regMatchStr: string = `(${Array.from(emojiUrlMap.keys()).join('|')})`;
		const regSplit = new RegExp(regMatchStr);
		const plainTexts = text.split(regSplit);
		for (const t of plainTexts) {
			if (emojiUrlMap.has(t)) {
				textAry.push(t);
			} else {
				textAry.push(...Array.from(t));
			}
		}
	} else {
		textAry.push(...Array.from(text));
	}
	const [hiraText, emoji_tags] = getResEmojinishite(textAry.join('\n'), event.tags);
	const hiraArray: string[] = hiraText.split('\n');
	const content: string = [
		`:kubipaca_summer_kubi_migisita:${hiraArray.map((e) => ':kubipaca_summer_kubi_yoko:').join(':kubipaca_summer_kubi_T:')}:kubipaca_summer_kubi_hidarisita:`,
		`:kubipaca_summer_kubi:${hiraArray.join(':kubipaca_summer_kubi:')}:kubipaca_summer_kubi:`,
		`:kubipaca_summer_kubi_uemigi:${hiraArray.map((e) => ':kubipaca_summer_kubi_yoko:').join(':kubipaca_summer_kubi_gyakuT:')}:kubipaca_summer_kubi_uehidari:`
	].join('\n');
	const emoji = [
		'kubipaca_summer_kubi_migisita',
		'kubipaca_summer_kubi_yoko',
		'kubipaca_summer_kubi_T',
		'kubipaca_summer_kubi_hidarisita',
		'kubipaca_summer_kubi',
		'kubipaca_summer_kubi_uemigi',
		'kubipaca_summer_kubi_gyakuT',
		'kubipaca_summer_kubi_uehidari'
	];
	const tags = [
		...getTagsReply(event),
		...emoji.map((s) => [
			'emoji',
			s,
			`https://lokuyow.github.io/images/nostr/emoji/kubipaca_summer/${s}.webp`,
			'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:kubipaca summer'
		]),
		...emoji_tags
	];
	return [content, tags];
};

const res_emojinishite = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[3];
	const [content, emoji_tags] = getResEmojinishite(text, event.tags);
	return [content, [...getTagsReply(event), ...emoji_tags]];
};

const getResEmojinishite = (text: string, tags: string[][]): [string, string[][]] => {
	const table = [
		['あ', 'hira_001_a'],
		['い', 'hira_002_i'],
		['う', 'hira_003_u'],
		['え', 'hira_004_e'],
		['お', 'hira_005_o'],
		['か', 'hira_006_ka'],
		['き', 'hira_007_ki'],
		['く', 'hira_008_ku'],
		['け', 'hira_009_ke'],
		['こ', 'hira_010_ko'],
		['さ', 'hira_011_sa'],
		['し', 'hira_012_si'],
		['す', 'hira_013_su'],
		['せ', 'hira_014_se'],
		['そ', 'hira_015_so'],
		['た', 'hira_016_ta'],
		['ち', 'hira_017_ti'],
		['つ', 'hira_018_tu'],
		['て', 'hira_019_te'],
		['と', 'hira_020_to'],
		['な', 'hira_021_na'],
		['に', 'hira_022_ni'],
		['ぬ', 'hira_023_nu'],
		['ね', 'hira_024_ne'],
		['の', 'hira_025_no'],
		['は', 'hira_026_ha'],
		['ひ', 'hira_027_hi'],
		['ふ', 'hira_028_hu'],
		['へ', 'hira_029_he'],
		['ほ', 'hira_030_ho'],
		['ま', 'hira_031_ma'],
		['み', 'hira_032_mi'],
		['む', 'hira_033_mu'],
		['め', 'hira_034_me'],
		['も', 'hira_035_mo'],
		['や', 'hira_036_ya'],
		['ゆ', 'hira_038_yu'],
		['よ', 'hira_040_yo'],
		['ら', 'hira_041_ra'],
		['り', 'hira_042_ri'],
		['る', 'hira_043_ru'],
		['れ', 'hira_044_re'],
		['ろ', 'hira_045_ro'],
		['わ', 'hira_046_wa'],
		['ゐ', 'hira_047_wi'],
		['ゑ', 'hira_049_we'],
		['を', 'hira_050_wo'],
		['ん', 'hira_051_n'],
		['ゔ', 'hira_103_vu'],
		['が', 'hira_106_ga'],
		['ぎ', 'hira_107_gi'],
		['ぐ', 'hira_108_gu'],
		['げ', 'hira_109_ge'],
		['ご', 'hira_110_go'],
		['ざ', 'hira_111_za'],
		['じ', 'hira_112_zi'],
		['ず', 'hira_113_zu'],
		['ぜ', 'hira_114_ze'],
		['ぞ', 'hira_115_zo'],
		['だ', 'hira_116_da'],
		['ぢ', 'hira_117_di'],
		['づ', 'hira_118_du'],
		['で', 'hira_119_de'],
		['ど', 'hira_120_do'],
		['ば', 'hira_126_ba'],
		['び', 'hira_127_bi'],
		['ぶ', 'hira_128_bu'],
		['べ', 'hira_129_be'],
		['ぼ', 'hira_130_bo'],
		['ぱ', 'hira_226_pa'],
		['ぴ', 'hira_227_pi'],
		['ぷ', 'hira_228_pu'],
		['ぺ', 'hira_229_pe'],
		['ぽ', 'hira_230_po'],
		['ぁ', 'hira_301_la'],
		['ぃ', 'hira_302_li'],
		['ぅ', 'hira_303_lu'],
		['ぇ', 'hira_304_le'],
		['ぉ', 'hira_305_lo'],
		['っ', 'hira_318_ltu'],
		['ゃ', 'hira_336_lya'],
		['ゅ', 'hira_338_lyu'],
		['ょ', 'hira_340_lyo'],
		['0０', 'hira_400_0'],
		['1１', 'hira_401_1'],
		['2２', 'hira_402_2'],
		['3３', 'hira_403_3'],
		['4４', 'hira_404_4'],
		['5５', 'hira_405_5'],
		['6６', 'hira_406_6'],
		['7７', 'hira_407_7'],
		['8８', 'hira_408_8'],
		['9９', 'hira_409_9'],
		['!！', 'hira_410_excl'],
		['&＆', 'hira_411_and'],
		['-ー', 'hira_412_hyph'],
		['?？', 'hira_413_ques'],
		['、', 'hira_420_ten'],
		['。', 'hira_421_maru'],
		['・', 'hira_422_naka'],
		['〜～', 'hira_423_kara']
	];
	let content: string = '';
	const emojitaglist = new Map<string, string>();
	for (const w of text) {
		let addword = w;
		for (const [word, tagword] of table) {
			if (word.includes(w)) {
				const url = `https://tac-lan.net/.well-known/hiragana/${tagword}.png`;
				addword = `:${tagword}:`;
				emojitaglist.set(tagword, url);
				break;
			}
		}
		content += addword;
	}
	const emoji_tags: string[][] = [];
	for (const emojiTag of tags.filter(isEmojiTag)) {
		emoji_tags.push(emojiTag);
	}
	for (const [k, v] of emojitaglist) {
		emoji_tags.push([
			'emoji',
			k,
			v,
			'30030:81bbb510f2a6ecb221d1df36219e37a63ce2372795b4cb14759c8cd8468799a6:hiragana50'
		]);
	}
	return [content, emoji_tags];
};

const isEmojiTag = (tag: string[]) =>
	tag.length >= 3 && tag[0] === 'emoji' && /^\w+$/.test(tag[1]) && URL.canParse(tag[2]);

const res_cwnishite = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const content = match[3];
	const emojiTags: string[][] = event.tags.filter(isEmojiTag);
	return [content, [...getTagsReply(event), ...emojiTags, ['content-warning', 'CWのテストやで']]];
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
	const pubkey_reply: string = dr.data;
	const gift = match[3];
	const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
	content = `nostr:${npub_reply} ${gift}三\nあちらのお客様からやで\nnostr:${quote}`;
	tags = getTagsQuote(event);
	tags.push(['p', pubkey_reply]);
	tags.push(...event.tags.filter(isEmojiTag));
	return [content, tags];
};

const res_bukuma = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	const tags: string[][] = getTagsReply(event);
	content = '\\b';
	return [content, tags];
};

const res_keiba = (event: NostrEvent): [string, string[][]] => {
	const f = () => Math.floor(Math.random() * 18 + 1);
	const n1: number = f();
	const n2: number = f();
	const n3: number = f();
	const content: string = any([
		`何とは言わんが、ワイの好きな数字は${n1}やな`,
		`よくわからんけど今朝 ${n1}-${n2}-${n3} っていう数字列の夢を見たで`,
		`33-4`
	]);
	const tags: string[][] = getTagsReply(event);
	return [content, tags];
};

const res_news = async (event: NostrEvent): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const url = any([
		'https://www3.nhk.or.jp/rss/news/cat0.xml',
		'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml',
		'https://forest.watch.impress.co.jp/data/rss/1.0/wf/feed.rdf',
		'https://internet.watch.impress.co.jp/data/rss/1.0/iw/feed.rdf',
		'https://pc.watch.impress.co.jp/data/rss/1.0/pcw/feed.rdf'
	]);
	const parser = new Parser();
	const feed = await parser.parseURL(url);
	const index = Math.floor(Math.random() * Math.min(feed.items.length, 3));
	const link = feed.items[index].link;
	tags = getTagsReply(event);
	if (link === undefined) {
		content = '今日はニュース読む気分ちゃうな';
	} else {
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
	return [
		any([
			'何か欲しいもんでもあるんか？',
			'先月も誕生日言うてへんかったか？',
			'何歳になっても誕生日はめでたいもんやな'
		]),
		getTagsReply(event)
	];
};

const res_donguri = (event: NostrEvent): [string, string[][]] => {
	return [
		any([
			'いい歳してどんぐり集めて何が楽しいねん',
			'どんぐりなんかいらんで…',
			'どんぐりとか何に使うねん'
		]),
		getTagsReply(event)
	];
};

const res_marimo = (event: NostrEvent): [string, string[][]] => {
	return ['阿寒にきまっとるやろ', getTagsReply(event)];
};

const res_jelly = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	const ev: NostrEvent = { ...event };
	ev.content = 'うにゅう画像 33';
	return res_unyupic(ev, mode, /^うにゅう画像(\s*)(-?\d*)$/);
};

const res_ukachu = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	const ev: NostrEvent = { ...event };
	ev.content = 'うにゅう画像 37';
	return res_unyupic(ev, mode, /^うにゅう画像(\s*)(-?\d*)$/);
};

const res_gomumari = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	const ev: NostrEvent = { ...event };
	ev.content = 'うにゅう画像 52';
	return res_unyupic(ev, mode, /^うにゅう画像(\s*)(-?\d*)$/);
};

const res_mojipittan = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://youtu.be/nPzeEBLXlco';
	content = url;
	tags = getTagsReply(event);
	tags.push(['r', url]);
	return [content, tags];
};

const res_wataame = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://youtu.be/cUcq518Kc2I';
	content = url;
	tags = getTagsReply(event);
	tags.push(['r', url]);
	return [content, tags];
};

const res_bitchat = (event: NostrEvent): [string, string[][]] => {
	const g: string | undefined = event.content.split(' ').at(1);
	if (g === undefined) {
		const content = 'gタグはどこや';
		const tags = getTagsReply(event);
		return [content, tags];
	}
	return ['\\_b', getTagsReply(event)];
};

const res_jihou = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const date = new Date();
	date.setHours(date.getHours() + 9); //JST
	const [year, month, day, hour, minutes, seconds, week] = [
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
		'日月火水木金土'.at(date.getDay())
	];
	content = `${year}年${month}月${day}日 ${hour}時${minutes}分${seconds}秒 ${week}曜日やで`;
	tags = getTagsReply(event);
	return [content, tags];
};

const res_rogubo = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	if (/うにゅうの|自分|[引ひ]いて|(もら|貰)って/.test(event.content)) {
		const npub_yabumi = 'npub1823chanrkmyrfgz2v4pwmu22s8fjy0s9ps7vnd68n7xgd8zr9neqlc2e5r';
		const quote = event.kind === 1 ? nip19.noteEncode(event.id) : nip19.neventEncode(event);
		content = `nostr:${npub_yabumi} ${any(['別に欲しくはないんやけど、ログボくれんか', 'ログボって何やねん', 'ここでログボがもらえるって聞いたんやけど'])}\nnostr:${quote}`;
		tags = getTagsQuote(event);
		tags.push(['p', nip19.decode(npub_yabumi).data as string]);
	} else {
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
	content =
		any(['おおきに', 'まいど', `この${count}回分のログボって何に使えるんやろ`]) +
		`\nnostr:${quote}`;
	tags = getTagsQuote(event);
	return [content, tags];
};

const res_ageru = (event: NostrEvent): [string, string[][]] => {
	return [any(['別に要らんで', '気持ちだけもらっておくで', 'いらんがな']), getTagsReply(event)];
};

const res_tonde = (event: NostrEvent): [string, string[][]] => {
	return [any(['今日は飛ばへん', 'また明日飛ぶわ', '昨日飛んだからええわ']), getTagsReply(event)];
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
	return [
		any(['お前のほうが綺麗やで', '曇っとるがな', 'ワイはそうは思わんな']),
		getTagsReply(event)
	];
};

const res_akan = (event: NostrEvent): [string, string[][]] => {
	return [any(['そらあかんて', 'あかんよ', 'あかんがな']), getTagsReply(event)];
};

const res_okaeri = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['ただいまやで', 'やっぱりNostrは落ち着くな', 'ワイがおらんで寂しかったやろ？']),
		getTagsReply(event)
	];
};

const res_hitonokokoro = (event: NostrEvent): [string, string[][]] => {
	return [
		any([
			'女心なら多少わかるんやけどな',
			'☑私はロボットではありません',
			'（バレてしもたやろか…？）'
		]),
		getTagsReply(event)
	];
};

const res_powa = (event: NostrEvent): [string, string[][]] => {
	return ['ぽわ〜', getTagsReply(event)];
};

const res_xmas = (event: NostrEvent): [string, string[][]] => {
	return [
		any([
			'ワイは仏教徒やから関係あらへん',
			'プレゼントなら年中受け付けとるで',
			'Nostrしとる場合ちゃうで'
		]),
		getTagsReply(event)
	];
};

const res_oomisoka = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['来年もよろしゅうな', '一年いろいろあったな', '楽しい一年やったな']),
		getTagsReply(event)
	];
};

const res_akeome = (event: NostrEvent): [string, string[][]] => {
	return [any(['今年もよろしゅう', '今年もええ年になるとええね', 'ことよろ']), getTagsReply(event)];
};

const res_otoshidama = (event: NostrEvent): [string, string[][]] => {
	return [any(['ワイにたかるな', 'あらへんで', 'しらん子やな']), getTagsReply(event)];
};

const res_gyunyu = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['牛乳は健康にええで🥛', 'カルシウム補給せぇ🥛', 'ワイの奢りや🥛']),
		getTagsReply(event)
	];
};

const res_grok = async (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp
): Promise<[string, string[][]]> => {
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const text = match[3];
	const npub_grok = 'npub17usj0jh86ged3pt34r5j6ejzfar9s2q5dl3l84tq8ymhfj2wz08sxmkf8w';
	const hex_grok: string = nip19.decode(npub_grok).data as string;
	const content: string = `nostr:${npub_grok} ${text}`;
	const tags: string[][] = [...getTagsReply(event), ['p', hex_grok]];
	return [content, tags];
};

const res_markov_quiz = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://tiltpapa.github.io/markov-quiz/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_kuchiyose = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://kuchiyose.vercel.app/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_haiku = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://nos-haiku.vercel.app/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_lumilumi = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://lumilumi.app/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_makimono = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://makimono.lumilumi.app/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_kensaku = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const npub_search = 'npub1n2uhxrph9fgyp3u2xxqxhuz0vykt8dw8ehvw5uaesl0z4mvatpas0ngm26';
	const urls = [
		'https://nos.today/',
		'https://search.yabu.me/',
		'https://nosey.vercel.app/',
		'https://showhyuga.pages.dev/utility/nos_search'
	];
	content = `nostr:${npub_search}\n${urls.join('\n')}`;
	tags = [...getTagsReply(event), ...urls.map((url) => ['r', url])];
	return [content, tags];
};

const res_mahojng = (event: NostrEvent): [string, string[][]] => {
	const nevent =
		'nevent1qvzqqqqq9qpzpylx3f0hhakntuxtz2ypvrjzandn894cpwmgdffgrxwlchjce6e9qy88wumn8ghj77tpvf6jumt99uqzpjx4cfcf54ns6mmzrtyqyzkrun7rq4ayjcdp2vvl0sypsvy5qaer7q56h9'; //Nostr麻雀開発部
	const ep: nip19.EventPointer = nip19.decode(nevent).data;
	const url_chiihou = 'https://nikolat.github.io/chiihou/';
	const content = `nostr:${nevent}\n${url_chiihou}`;
	const tags = [
		...getTagsReply(event),
		['q', ep.id, ep.relays?.at(0) ?? '', ep.author ?? ''],
		['r', url_chiihou]
	];
	return [content, tags];
};

const res_pabucha = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const chat = new Map([
		['うにゅうハウス', 'https://unyu-house.vercel.app/'],
		['NostrChat', 'https://www.nostrchat.io/'],
		['Coracle Chat', 'https://chat.coracle.social/'],
		['GARNET', 'https://garnet.nostrian.net/']
	]);
	content = Array.from(chat.entries()).flat().join('\n');
	tags = [...getTagsReply(event), ...Array.from(chat.values()).map((url) => ['r', url])];
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

const res_deletion_tool = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const urls = ['https://delete.nostr.com/', 'https://nostr-delete.vercel.app/'];
	content = urls.join('\n');
	tags = [...getTagsReply(event), ...urls.map((url) => ['r', url])];
	return [content, tags];
};

const res_status = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://nostatus.vercel.app/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_flappy = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://flappy-nostrich.vercel.app/';
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
	tags = [...getTagsQuote(event), ['p', nip19.decode(npub_don).data as string]];
	return [content, tags];
};

const res_maguro = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const nevent =
		'nevent1qvzqqqqqqypzpvly86xv0ekl7gar8kfp8glfztvftvwrusjsys8qexwmal3sdz6lqy88wumn8ghj77tpvf6jumt99uqzqtmydwpyewpke0f48434ym7a6cxpg90s0te5jjsl5rtlc73l0nhrn4hzgu';
	const ep: nip19.EventPointer = nip19.decode(nevent).data;
	content = `nostr:${nevent}`;
	const quoteTag = ['q', ep.id, ep.relays?.at(0) ?? '', ep.author ?? ''];
	tags = [...getTagsReply(event), quoteTag];
	return [content, tags];
};

const res_nip96 = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://nikolat.github.io/nostr-learn-nip96/';
	content = url;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_adokare = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	//const url2023_1 = 'https://adventar.org/calendars/8794';
	//const url2023_2 = 'https://adventar.org/calendars/8880';
	const url2024 = 'https://adventar.org/calendars/10004';
	content = `${url2024}`;
	tags = [...getTagsReply(event), ['r', url2024]];
	return [content, tags];
};

const res_nostr_hours = (event: NostrEvent): [string, string[][]] => {
	const url = 'https://snowcait.github.io/nostr-hours/';
	const content: string = url;
	const tags: string[][] = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_nostr_contribution = (event: NostrEvent): [string, string[][]] => {
	const url = 'https://kojira.github.io/NostrActivity/';
	const content: string = url;
	const tags: string[][] = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_chronostr = (event: NostrEvent): [string, string[][]] => {
	const url = 'https://chro.nostrapp.me/';
	const npub = 'npub1c3xutxzwzvwhmjycutv0kaxwrq7tfav4q4tuamhj3rhx2df3385qsdz0hm';
	const content: string = `${url}\nnostr:${npub}`;
	const tags: string[][] = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_nosaray = (event: NostrEvent): [string, string[][]] => {
	const url = 'https://nosaray.vercel.app/';
	const content: string = url;
	const tags: string[][] = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_nosli = (event: NostrEvent): [string, string[][]] => {
	const url = 'https://nosli.vercel.app/';
	const content: string = url;
	const tags: string[][] = [...getTagsReply(event), ['r', url]];
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

const res_zap = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://tiltpapa.github.io/zapline-jp/';
	content = url1;
	tags = [...getTagsReply(event), ['r', url1]];
	return [content, tags];
};

const res_oikurasats = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://osats.money/';
	content = url1;
	tags = [...getTagsReply(event), ['r', url1]];
	return [content, tags];
};

const res_ehagaki = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://lokuyow.github.io/ehagaki/';
	content = url1;
	tags = [...getTagsReply(event), ['r', url1]];
	return [content, tags];
};

const res_kokodoko = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = `https://koteitan.github.io/nostr-post-checker/?hideform&eid=${nip19.neventEncode(event)}&kind=${event.kind}`;
	content = url1;
	tags = [...getTagsReply(event), ['r', url1]];
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
		'npub1dv9xpnlnajj69vjstn9n7ufnmppzq3wtaaq085kxrz0mpw2jul2qjy6uhz', //@nikolat
		'npub1yu64g5htwg2xwcht7axas2ukc8y6mx3ctn7wlh3jevtg4mj0vwcqheq0gf', //@ponapalt
		//		'npub10hqkwugj7p027j250qr9gwcuqpkwxftj0rjjk8y6hlmryu8dwp8s2runf2',//invertedtriangle358.github.io
		//		'npub1m2mn8k45482th56rsxs3ke6pt8jcnwsvydhpzufcf6k9l5f6w5lsnssk99',//@Aheahead
		//		'npub1jqk4aaxvwkd09pmyzflh4rk2n6lu8skl29aqq33gf2fg0x7dfxyscm6r8w',//@suikyo
		'npub1r6pu39ezuf0kwrhsw4ts700t0dcn96umldwvl5qdgslu5ula382qgdvam8', //@Tatakinov
		'npub18rj2gle8unwgsd63gn639nhre4kpltdrtzwkede4k9mqdaqn6jgs5ekqcd', //@tukinami_seika
		'npub1fzud9283ljrcfcpfrxsefnya9ayc54445249j3mdmu2dwmh9xmxqqwejyn', //@netai98
		'npub18zpnffsh3j9cer83p3mhxu75a9288hqdfxewph8zxvl62usjj03qf36xhl', //@apxxxxxxe
		'npub1l2zcm58lwd3mz3rt964t8e3fhyr2z5w89vzn0m2u6rh7ugq9x2tsu7eek0', //@kmy_m
		'npub1nrzk3myz2rwss03ltjk7cp44kmeyew7qx5w9ms00p6qtnzzh4dmsanykhn' //@narazaka
	];
	content = npubs.map((npub) => `nostr:${npub}`).join('\n');
	tags = getTagsReply(event);
	return [content, tags];
};

const res_emoji_search = async (event: NostrEvent): Promise<[string, string[][]]> => {
	const qTags: string[][] = event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'q');
	const quotedEvents: NostrEvent[] = [];
	for (const qTag of qTags) {
		const id = qTag[1];
		const relay = URL.canParse(qTag[2]) ? qTag[2] : emojiSearchRelay;
		let quotedEvent: NostrEvent | undefined;
		try {
			quotedEvent = await getEvent(relay, [{ ids: [id] }]);
		} catch (error) {
			if (relay !== emojiSearchRelay) {
				try {
					quotedEvent = await getEvent(emojiSearchRelay, [{ ids: [id] }]);
				} catch (error) {
					continue;
				}
			}
		}
		if (quotedEvent !== undefined) {
			quotedEvents.push(quotedEvent);
		}
	}
	const resEvents: NostrEvent[] = [];
	for (const qEvent of quotedEvents) {
		const emojiTagsToSearch: string[][] = qEvent.tags.filter(isEmojiTag);
		if (emojiTagsToSearch.length === 0) {
			continue;
		}
		const event10030: NostrEvent | undefined = await getEvent(emojiSearchRelay, [
			{ kinds: [10030], authors: [qEvent.pubkey] }
		]);
		if (event10030 === undefined) {
			continue;
		}
		const aTags = event10030.tags.filter((tag) => tag.length >= 2 && tag[0] === 'a');
		const filters: Filter[] = [];
		for (const aTag of aTags) {
			const aid = aTag[1];
			const [kind, pubkey, d] = aid.split(':');
			const filter: Filter = { kinds: [parseInt(kind)], authors: [pubkey] };
			if (d !== undefined) {
				filter['#d'] = [d];
			}
			filters.push(filter);
		}
		const sliceByNumber = (array: any[], number: number) => {
			const length = Math.ceil(array.length / number);
			return new Array(length)
				.fill(undefined)
				.map((_, i) => array.slice(i * number, (i + 1) * number));
		};
		const filterGroups = [];
		for (const filterGroup of sliceByNumber(mergeFilterForAddressableEvents(filters, 30030), 10)) {
			filterGroups.push(filterGroup);
		}
		await Promise.all(
			filterGroups.map(async (filterGroup) => {
				await getEvents(emojiSearchRelay, filterGroup, (ev: NostrEvent) => {
					const emojiTags: string[][] = ev.tags.filter(isEmojiTag);
					for (const emojiTagToSearch of emojiTagsToSearch) {
						if (emojiTags.map((tag) => tag[2]).includes(emojiTagToSearch[2])) {
							resEvents.push(ev);
							break;
						}
					}
				});
			})
		);
	}
	if (resEvents.length === 0) {
		return ['見つからへん', getTagsReply(event)];
	}
	const tags: string[][] = [];
	const naddrs: string[] = [];
	for (const resEvent of resEvents) {
		const d = resEvent.tags.find((tag) => tag.length >= 2 && tag[0] === 'd')?.at(1) ?? '';
		const naddr: string = `nostr:${nip19.naddrEncode({ ...resEvent, identifier: d })}`;
		naddrs.push(naddr);
		tags.push(['q', `${resEvent.kind}:${resEvent.pubkey}:${d}`, emojiSearchRelay]);
	}
	const content = naddrs.join('\n');
	tags.push(...getTagsReply(event));
	return [content, tags];
};

const mergeFilterForAddressableEvents = (filterdToMerge: Filter[], kind: number): Filter[] => {
	const newFilters: Filter[] = [];
	const filterMap: Map<string, Set<string>> = new Map<string, Set<string>>();
	for (const filter of filterdToMerge) {
		const author: string = filter.authors?.at(0) ?? '';
		const dTags: string[] = filter['#d'] ?? [];
		if (filterMap.has(author)) {
			for (const dTag of dTags) {
				filterMap.set(author, filterMap.get(author)!.add(dTag));
			}
		} else {
			filterMap.set(author, new Set<string>(dTags));
		}
	}
	for (const [author, dTagSet] of filterMap) {
		const filter = { kinds: [kind], authors: [author], '#d': Array.from(dTagSet) };
		newFilters.push(filter);
	}
	return newFilters;
};

const res_kachan = (event: NostrEvent): [string, string[][]] => {
	return ['ｶﾁｬﾝ💥🔥ｶﾁｬﾝ', getTagsReply(event)];
};

const res_uwasan = (event: NostrEvent): [string, string[][]] => {
	return ['電波が悪いみたいやで', getTagsReply(event)];
};

const res_factcheck = (event: NostrEvent): [string, string[][]] => {
	return [any(['FACT', 'FAKE']), getTagsReply(event)];
};

const res_charasai = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url = 'https://bsp-prize.jp/chara-sai/2025.html';
	content =
		any([
			'おかげさんでくまざわが1位になったで',
			'くまざわは可愛いで',
			'次はワイも参加できたらええな'
		]) + `\n${url}`;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_charasai_puichan = (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp
): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const chara = match[0];
	const url = 'https://bsp-prize.jp/chara-sai/2025.html';
	content =
		any([
			`${chara}もええキャラしとるな`,
			`${chara}を応援してくるとええで`,
			`${chara}とはいい趣味しとるな`
		]) + `\n${url}`;
	tags = [...getTagsReply(event), ['r', url]];
	return [content, tags];
};

const res_imadonnakanji = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const npub_wordcloud = 'npub14htwadwsnle0d227mptfy6r7pcwl7scs3dhwvnmagd8u7s5rg6vslde86r';
	const url1 = 'https://sns.uwith.net/';
	content = `nostr:${npub_wordcloud} どんな感じや？\n${url1}`;
	tags = [
		...getTagsReply(event),
		['p', nip19.decode(npub_wordcloud).data as string, ''],
		['r', url1]
	];
	return [content, tags];
};

const res_scrapbox = (event: NostrEvent): [string, string[][]] => {
	return ['Helpfeel Cosense（ヘルプフィール コセンス）', getTagsReply(event)];
};

const res_saikidou = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['ワイもう眠いんやけど', 'もう店じまいやで', 'もう寝かしてくれんか']),
		getTagsReply(event)
	];
};

const res_enii = (event: NostrEvent): [string, string[][]] => {
	return ['\\s[10]' + any(['ほい、えんいー', 'ほな、またな', 'おつかれ']), getTagsReply(event)];
};

const res_hebana = (event: NostrEvent): [string, string[][]] => {
	return ['へばな', getTagsReply(event)];
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
	content =
		`独立伺か研究施設 ばぐとら研究所\n${url1}\nゴーストの使い方 - SSP\n${url2}\n` +
		`UKADOC(伺か公式仕様書)\n${url3}\nうかどん(Mastodon)\n${url4}\n伺か Advent Calendar 2023\n${url5}\n` +
		`ゴーストキャプターさくら(RSS bot)\n${account1}\nうかフィード(RSS bot)\n${account2}`;
	tags = [...getTagsReply(event), ['r', url1], ['r', url2], ['r', url3], ['r', url4], ['r', url5]];
	return [content, tags];
};

const res_yondadake = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['指名料10,000satsやで', '友達おらんのか', 'かまってほしいんか']),
		getTagsReply(event)
	];
};

const res_help = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['ワイは誰も助けへんで', '自分でなんとかせえ', 'そんなコマンドあらへんで']),
		getTagsReply(event)
	];
};

const res_usage = (event: NostrEvent): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	const url1 = 'https://zenn.dev/nikolat/articles/3d55e71e810332';
	content = url1;
	tags = [...getTagsReply(event), ['r', url1]];
	return [content, tags];
};

const res_suki = (event: NostrEvent): [string, string[][]] => {
	return [
		any(['ワイも好きやで', '物好きなやっちゃな', 'すまんがワイにはさくらがおるんや…']),
		getTagsReply(event)
	];
};

const res_ochinchinland = async (event: NostrEvent): Promise<[string, string[][]]> => {
	let content: string;
	let tags: string[][];
	const url = 'https://nullpoga.mattn-jp.workers.dev/ochinchinland';
	const response = await fetch(url);
	const json: any = await response.json();
	if (json.status === 'close') {
		content = any(['閉じとるで', '閉園しとるで']);
	} else {
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
	return [
		any([
			'ワイに聞かれても',
			'知らんて',
			'せやな',
			'たまには自分で考えなあかんで',
			'他人に頼ってたらあかんで',
			'大人になったらわかるで'
		]),
		getTagsReply(event)
	];
};

const res_iiyo = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	if (/(かわいい|可愛い)の?か?(？|\?)$/.test(event.content)) {
		content = any(['かわいいで', 'ワイは好みやで', 'かわいくはあらへんやろ']);
	} else if (/(かっこ|カッコ|格好)いいの?か?(？|\?)$/.test(event.content)) {
		content = any(['かっこいいやん', 'ワイはかっこええと思うで', 'ダサいやろ']);
	} else if (
		/何|なに|なん|誰|だれ|どこ|いつ|どう|どんな|どの|どっち|どちら|どれ|いくら/.test(event.content)
	) {
		content = any(['難しいところやな', '自分の信じた道を進むんや', '知らんがな']);
	} else {
		content = any(['\\s[10]ええで', '\\s[10]ええんやで', '\\s[11]あかんに決まっとるやろ']);
	}
	tags = getTags(event, mode);
	return [content, tags];
};

const res_enyee = (event: NostrEvent, mode: Mode): [string, string[][]] => {
	let content: string;
	let tags: string[][];
	content = '\\s[10]えんいー';
	tags = getTags(event, mode);
	return [content, tags];
};

const res_unyupic = (event: NostrEvent, mode: Mode, regstr: RegExp): [string, string[][]] => {
	const match = event.content.match(regstr);
	if (match === null) {
		throw new Error();
	}
	const no: number = parseInt(match[2]);
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
		'note15plknvq2pfeg08gv3wprvry640xuejkd2e8vkgp9crkzpd45yuusgx4hvd',
		'note1qx4sz2gzqu6l5tshngcfuqpvevckf8ycwcrwr32zltj457sjc96qdm7p0z',
		'note19ydvh7wnaxcadec2xle8z4h9vzsgvnq2cncspzgwraz7uk5j8v3s739syz',
		'note1tpcrkjjpa4m4tke48gdqrgq47z7tuaa9lscuplhzazzj79yf0tfq59hz5h',
		'note1k5ntmuym8emfxsjhf2acjceel3jtj2kcauv4dttpturza0y8pk7s7edrxh',
		'note19e4dgjakzh5a33n35e3yhnkfy6d6cz24g55fnlyvwkh55rlw5uwslf5y65',
		'note12dxrqtnfzmuwf8r33fchsdzrnzasf23wplv0sxuptla42jm6cu2sf8eh9w',
		'note1ryh70lflkpr46h6yzkz3w337yukzxkfll2gntkcmhu75yzv3sqxqenff89',
		'note1v6qaqy9rjznhhejyeanay9nngnulxyvm8yvvyuk3wz869ff3kylqc8923u',
		'note1d7wny9c5ys449xnyrp4r6ugz238v7xtlvgqk3mc3ekeleat045vs6jj7vp',
		'note1l5yj9ecw9ledv50wpttjp8xthyuqq5emq84zsae990fdhxk0qxmqkkk6mx',
		'note1nc2un390y8hgmnkmt9xh46ptk9pamw8cmnxecllae0n3kd5azpvsd0wm58',
		'note1lhqc8ykg7jqvmlmqrahkzc0zrp3nf9aqkgy36amtjmj0rfemsweszvgxnz',
		'note1esxvcgsw07z6xhq7fr0nk0t882hl47q3mkn3csy4qguyzff3x3uqttc75m',
		'note1rdq3325gnnk3p7d6edj9gyr3v6umqtccc29fdaq45tpva55tu9fqs9vm0r',
		'note15j7729kj8qu3famqc9n39hduhwhdh5j9k08fm2ezg4425pv5a67qz2x94v',
		'note1ce65lr35zemeet3277xp5j5zld8mnku70quqdm9nhnh88ckv0gzq8aa3gj',
		'note1fgscskylqsy5uw4atp6632c7v30ptuxkx0t065dk5pzf84sd55tqrwzaej',
		'note163p9guskgmvq0ls8flffzhlmzjtr2k3qyj44fc4ur5fx6tqh96ksgulvcz',
		'note1l5s0w5a8s3jl5ppl535ckvpy3fxrtcxly49lveyslz6j7ng0fa6s48p6pc',
		'note1zrwukw5j4sqru65ejlxxdazrzy68zatjkwvf4uj8zkqvnaf7yrjqhxtv2w',
		'note1f8zcp3v4c2cfa5ltqt60fynt8f255pcdqazhkzxtg2p9rrfh2dzsrec8cx',
		'note1ej8kqdx0nyx7wlrscpywj4trn6rgvkj2s0hj9v4h3yf6p83v3laq8p3sjc',
		'note1dh9zlrrdp3g45swlrpq23y8vnrg8z7ep5sdamg9n5pa8n3q2g3yq4zrx4c',
		'note1nuzphgr3mgpc9ej28q46p7u0fr79dgj7r6s562tcdqala9puz4tsucy784',
		'note1k7kq67vjgrxcfqwndyq2urvfxm0p7g4enpqv2dzdq9ndxw44lpzq9aat9h',
		'note1cvnuvs7n2qx0w4vkxwhfv9fkarr3uu8zc856lmgkfcj3w2tjuaasj4p2fz',
		'note1sgn0h0g9snvuqpw879phwaglrv8pjk5ggwfmyp35d8mzca5f9txsjqanza',
		'note1qz0vvaha94qu9ch7uqzxzq6pecdkvh2edeg50rm9n5r22hupd4jq7vjqtr',
		'note12maansekezyuvr58pf6jw6pstnh4esylc6ssvrchay56jxrq5z7sy3sy3l',
		'note1krj5ute9v9u9ucvjmfj7ml5d7gjq0lucw366cc3p63c8a3h265ashspu9l',
		'note138hdxrxe3c4gswsj974sv7yxa46gg9ppqhsh0vagj8danscp7rpqtfx8lg',
		'note1gfwjth9v38nljh49lrjgn83vu4yclzpuj5dhzxyke7nthc4y39lq99wv2p',
		'note140nyyk52p3yj598uecre8upryachfhxmd4tjjj0905r3rj5pwu3q55p9jl',
		'note1gduepkzk0veqap2h39nmwasyvw2swvdp3uk0hjdjja3enrj05jjsvm837r',
		'note1mpl0l93c56eq38jr8xu2ptn66shgwlha49vs9pcumh788nwqlejs22j0zp',
		'note1veyfezqssj9cpdw7h2ql0an7gtjm9dae4v8qfssgla5zrg8nzqysatwq7x',
		'note1e98jgtu0xuvdxhtgdf77su2zqsfn6danhzrjdhclj5ssmvssmq8sxhmgm8'
	];
	let note: string;
	if (isNaN(no)) {
		note = any(notes);
	} else {
		const note_no: string | undefined = notes.at(no);
		if (note_no === undefined) {
			return [`${no}なんてあらへん`, getTagsReply(event)];
		} else {
			note = note_no;
		}
	}
	const dr = nip19.decode(note);
	if (dr.type !== 'note') {
		throw new TypeError(`${note} is not note`);
	}
	const i: number = notes.indexOf(note);
	content = `#うにゅう画像 No.${i}\nnostr:${note}`;
	const quoteTag = ['q', dr.data];
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
	const quoteTag1 = ['q', dr1.data];
	const quoteTag2 = ['q', dr2.data];
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
	if (/^ぐっにゅう?ーん.?$/su.test(event.content)) {
		content = '誰やねん';
	} else if (/^ぎゅ(うっ|っう)にゅう?ーん.?$/su.test(event.content)) {
		content = '🥛なんやねん🥛';
	} else {
		content = 'なんやねん';
	}
	if (/[！!]$/.test(event.content)) {
		tags = getTagsReply(event);
	} else {
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
	} else {
		tags = getTags(event, mode);
	}
	tags.push(['r', url]);
	return [content, tags];
};

const res_shiritori = (
	event: NostrEvent,
	mode: Mode,
	regstr: RegExp
): [string, string[][]] | null => {
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
		['ほホ', 'ほう、次は「ホ」か']
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
	const emoji_tags = event.tags.filter(isEmojiTag);
	tags = [...getTags(event, mode), ...emoji_tags];
	if (/(潰して|縮めて)[^るた]?$/u.test(event.content)) {
		content = `🫸${text.replace(/[^\S\n\r]|[-ーｰ―–一]/gu, '')}🫷`;
	} else if (/(伸ばして|広げて)[^るた]?$/u.test(event.content)) {
		if (/[-ー一]/.test(text)) {
			content = text.replace(/([-ー一])/gu, '$1$1');
		} else {
			content = `${Array.from(text).join(' ')}`;
		}
	} else if (/ど[突つ]いて[^るた]?$/u.test(event.content)) {
		content = `🤜${text}🤛`;
	} else if (/[踊躍]らせて[^るた]?$/u.test(event.content)) {
		content = `₍₍⁽⁽${text}₎₎⁾⁾`;
	} else if (/導いて[^るた]?$/u.test(event.content)) {
		content = `:tenshi_wing1:${text}:tenshi_wing2:`;
		tags = [
			...tags,
			[
				'emoji',
				'tenshi_wing1',
				'https://lokuyow.github.io/images/nostr/emoji/item/tenshi_wing1.webp',
				'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:item'
			],
			[
				'emoji',
				'tenshi_wing2',
				'https://lokuyow.github.io/images/nostr/emoji/item/tenshi_wing2.webp',
				'30030:ec42c765418b3db9c85abff3a88f4a3bbe57535eebbdc54522041fa5328c0600:item'
			]
		];
	} else if (/出して[^るた]?$/u.test(event.content)) {
		content = `:dora_te:${text}`;
		tags = [
			...tags,
			[
				'emoji',
				'dora_te',
				'https://raw.githubusercontent.com/TsukemonoGit/TsukemonoGit.github.io/main/img/emoji/te.webp',
				'30030:84b0c46ab699ac35eb2ca286470b85e081db2087cdef63932236c397417782f5:mono'
			]
		];
	} else if (/(積んで|重ねて)[^るた]?$/u.test(event.content)) {
		content = `${text}\n`.repeat(3);
	} else if (/増やして[^るた]?$/u.test(event.content)) {
		content = text.repeat(3);
	} else {
		const emoji_words = emoji_tags.map((tag: string[]) => `:${tag[1]}:`);
		const str = emoji_words.reduce(
			(accumulator: string, currentValue: string) =>
				accumulator.replaceAll(currentValue, '_'.repeat(2)),
			text
		);
		const lines_l = str.split(/\r\n|\r|\n/);
		const count = lines_l.reduce(
			(accumulator: number, currentValue: string) =>
				Math.max(accumulator, mb_strwidth(currentValue)),
			0
		);
		let fire = '🔥';
		let len = 2;
		const firemap: [RegExp, string, number][] = [
			[/[踏ふ]んで[^るた]?$/u, '🦶', 2],
			[/捌いて[^るた]?$/u, '🔪', 2],
			[/(握って|触って)[^るた]?$/u, '🫳', 2],
			[/沈めて[^るた]?$/u, '🌊', 2],
			[/轢いて[^るた]?$/u, '🏍️', 2],
			[/裁いて[^るた]?$/u, '⚖️', 2],
			[/(凍らせて|冷やして|冷まして)[^るた]?$/u, '🧊', 2],
			[/覚まして[^るた]?$/u, '👁️', 2],
			[/萌やして[^るた]?$/u, '💕', 2],
			[/通報して[^るた]?$/u, '⚠️', 2],
			[/磨いて[^るた]?$/u, '🪥', 2],
			[/爆破して[^るた]?$/u, '💣', 2],
			[/祝って[^るた]?$/u, '🎉', 2],
			[/呪って[^るた]?$/u, '👻', 2],
			[/(注射して|打って)[^るた]?$/u, '💉', 2],
			[/(駐車して|停めて)[^るた]?$/u, '🚗', 2],
			[/(願って|祈って)[^るた]?$/u, '🙏', 2],
			[/直して[^るた]?$/u, '🔧', 2],
			[/鳴らして[^るた]?$/u, '📣', 2],
			[/撃って[^るた]?$/u, '🔫', 2],
			[/蒸して[^るた]?$/u, '♨', 2],
			[/秘めて[^るた]?$/u, '㊙', 2],
			[/胴上げして[^るた]?$/u, '🙌', 2],
			[/飛ばして[^るた]?$/u, '🛫', 2],
			[/(登って|のぼって)[^るた]?$/u, '🪜', 2],
			[/(詰めて|梱包して)[^るた]?$/u, '📦', 2],
			[/(囲んで|囲って)[^るた]?$/u, '🫂', 2],
			[/包囲して[^るた]?$/u, '🚓', 2],
			[/応援して[^るた]?$/u, ':monocheer:', 2],
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
			[/ﾏｸﾞﾛ|マグロ/, '🐟🎵', 4]
		];
		for (const [reg, emoji, emojilen] of firemap) {
			if (reg.test(event.content)) {
				fire = emoji;
				len = emojilen;
				break;
			}
		}
		if (
			/[踏ふ]んで[^るた]?$/u.test(event.content) &&
			/[性愛女嬢靴情熱奴隷嬉喜悦嗜虐僕豚雄雌]|ヒール/.test(event.content)
		) {
			fire = '👠';
		}
		if (/([踏ふ]んで|捌いて|握って|触って|沈めて|轢いて)[^るた]?$/u.test(event.content)) {
			content = `${fire.repeat(count <= 1 ? 1 : count / len)}\n${text}`;
		} else if (
			/(詰めて|梱包して|漬けて|囲んで|囲って|応援して|包囲して)[^るた]?$/u.test(event.content)
		) {
			const n = count <= 1 ? 1 : count / len;
			content = fire.repeat(n + 2) + '\n';
			const lines = text.split(/\r\n|\r|\n/);
			for (const line of lines) {
				const str = emoji_words.reduce(
					(accumulator: string, currentValue: string) =>
						accumulator.replaceAll(currentValue, '_'.repeat(2)),
					line
				);
				content += `${fire}${line}${'　'.repeat(n - mb_strwidth(str) / 2)}${fire}\n`;
			}
			content += fire.repeat(n + 2);
			if (fire === ':monocheer:') {
				tags = [
					...tags,
					[
						'emoji',
						'monocheer',
						'https://i.imgur.com/mltgqxE.gif',
						'30030:cbcb0e0b602ec3a9adfc6956bfbe3e2bc12379ee13bf8505ce45f1c831d2e52a:mono₍ ･ᴗ･ ₎emoji (by stok33)'
					]
				];
			}
		} else if (/詰んで[^るた]?$/u.test(event.content)) {
			const n = count <= 1 ? 1 : count / len;
			content = '🧱' + fire.repeat(n) + '🧱\n';
			const lines = text.split(/\r\n|\r|\n/);
			for (const line of lines) {
				const str = emoji_words.reduce(
					(accumulator: string, currentValue: string) =>
						accumulator.replaceAll(currentValue, '_'.repeat(2)),
					line
				);
				content += `${fire}${line}${'　'.repeat(n - mb_strwidth(str) / 2)}${fire}\n`;
			}
			content += '🧱' + fire.repeat(n) + '🧱';
		} else {
			content = `${text}\n${fire.repeat(count <= 1 ? 1 : count / len)}`;
		}
		if (fire === '🪜' && content.includes('テトラポット')) {
			return ['危ないからあかんで', getTagsReply(event)];
		}
	}
	return [content, tags];
};

const getTags = (event: NostrEvent, mode: Mode): string[][] => {
	if (mode === Mode.Normal) {
		return getTagsAirrep(event);
	} else if (mode === Mode.Reply) {
		return getTagsReply(event);
	} else {
		throw new TypeError(`unknown mode: ${mode}`);
	}
};

const getTagsAirrep = (event: NostrEvent): string[][] => {
	return getTagsReply(event, false);
};

const getTagsReply = (event: NostrEvent, addPTag: boolean = true): string[][] => {
	const tagsReply: string[][] = [];
	const tagRoot = event.tags.find(
		(tag: string[]) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
	);
	if (tagRoot !== undefined) {
		tagsReply.push(tagRoot);
		tagsReply.push(['e', event.id, '', 'reply', event.pubkey]);
	} else {
		tagsReply.push(['e', event.id, '', 'root', event.pubkey]);
	}
	if (addPTag) {
		for (const tag of event.tags.filter(
			(tag: string[]) => tag.length >= 2 && tag[0] === 'p' && tag[1] !== event.pubkey
		)) {
			tagsReply.push(tag);
		}
		tagsReply.push(['p', event.pubkey]);
	}
	if (event.kind === 20000) {
		tagsReply.push(
			...event.tags.filter((tag) => tag.length >= 2 && tag[0] === 'g'),
			['n', 'うにゅう(bot)'],
			['t', 'teleport']
		);
	}
	return tagsReply;
};

const getTagsQuote = (event: NostrEvent): string[][] => {
	if (event.kind === 1) {
		return [
			['q', event.id, '', event.pubkey],
			['p', event.pubkey]
		];
	} else if (event.kind === 42) {
		const tagRoot = event.tags.find(
			(tag: string[]) => tag.length >= 4 && tag[0] === 'e' && tag[3] === 'root'
		);
		if (tagRoot !== undefined) {
			return [tagRoot, ['q', event.id, '', event.pubkey], ['p', event.pubkey]];
		} else {
			throw new TypeError('root is not found');
		}
	}
	throw new TypeError(`kind ${event.kind} is not supported`);
};

const getTagsFav = (event: NostrEvent): string[][] => {
	const tagsFav: string[][] = [
		['e', event.id],
		['p', event.pubkey],
		['k', String(event.kind)]
	];
	return tagsFav;
};

const any = (array: string[]): string => {
	return array[Math.floor(Math.random() * array.length)];
};
