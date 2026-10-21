/** Keep named products intact: game footage must not degrade into generic stock. */
export interface SearchIntent {subject:string;kind:'game'|'general';exact:boolean;aliases:string[]}
const games:[RegExp,string,string][]=[
 [/植物大战僵尸.*(?:重植|重制)|plants\s*vs\.?\s*zombies.*replanted/i,'植物大战僵尸：重植版','plants-vs-zombies-replanted'],
 [/植物大战僵尸.*(?:花园战争\s*2)|plants\s*vs\.?\s*zombies.*garden warfare 2/i,'植物大战僵尸：花园战争 2','plants-vs-zombies-garden-warfare-2'],
 [/植物大战僵尸.*和睦小镇|plants\s*vs\.?\s*zombies.*battle for neighborville/i,'植物大战僵尸：和睦小镇保卫战','plants-vs-zombies-battle-for-neighborville'],
 [/植物大战僵尸\s*(?:2|二代)|plants\s*vs\.?\s*zombies\s*2\b/i,'植物大战僵尸 2','plants-vs-zombies-2'],
 [/植物大战僵尸\s*(?:3|三代)|plants\s*vs\.?\s*zombies\s*3\b/i,'植物大战僵尸 3','plants-vs-zombies-3'],
 [/植物大战僵尸|plants\s*(?:vs\.?|versus)\s*zombies|\bpvz\b/i,'植物大战僵尸','plants-vs-zombies'],
 [/王者荣耀|honor of kings/i,'王者荣耀','honor-of-kings'],
 [/原神|genshin impact/i,'原神','genshin-impact'],
];
export function searchIntent(request:string,product=''):SearchIntent {
 // An explicit new subject in a follow-up takes precedence over the original subject.
 const pieces=request.split(/\n补充需求：/),latest=pieces.at(-1)!.trim();
 const subjectFrom=(text:string)=>text.match(/(?:宣传|推广)(?:的)?(?:产品|游戏|品牌)?(?:是|为|叫)?[：:\s]*[《“]?([^，。；\n》”]{1,60}?)(?:[》”]|的(?:广告|宣传)(?:视频|片)?|[，。；\n]|$)/)?.[1]
  ||text.match(/(?:制作|生成|做|剪)(?:一(?:个|支|条|段))?[《“]?([^，。；\n》”]{1,60}?)(?:[》”]?(?:的)?(?:广告|宣传)(?:视频|片)?)/)?.[1];
 const specified=pieces.length>1?subjectFrom(latest):undefined;
 const text=specified||product.trim()||request;
 const game=games.find(([pattern])=>pattern.test(text));
 if(game)return {subject:game[1],kind:'game',exact:true,aliases:[game[2]]};
 const subject=(specified||product.trim()||subjectFrom(request)||'').replace(/^(?:帮我|请|一个|一支|一条)\s*/,'').replace(/(?:的)?(?:游戏|手游)$/,'').replace(/的$/,'').trim();
 const vague=/^(?:广告|视频|宣传|产品|商品|游戏|手游|一段|有趣|好看|精彩|有趣的故事性|有趣又有故事性)$/;
 const bare=latest.length<=40&&!/[，。；！？\n]/.test(latest)&&!/(帮我|请|视频|广告|剪辑|有趣|故事|上传|重试|继续|下载|立即|点击|宣传|推广|风格|随便|好看)/.test(latest)?latest:'';
 const named=(subject||bare)&&!vague.test(subject||bare)?subject||bare:'';
 return {subject:named,kind:/游戏|手游|game\b/i.test(text)?'game':'general',exact:!!named,aliases:[]};
}
