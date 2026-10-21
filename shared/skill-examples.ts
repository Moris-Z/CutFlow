import type {RecipeId} from './recipes.js';
export interface SkillExample {provider?:'youtube'|'douyin';poster?:string;endSeconds?:number;videoId:string;brand:string;title:string;description:string;source:string;category:string}
export function exampleEmbedUrl(example:SkillExample):string {
 if(example.provider==='douyin'){
  if(!/^\d{16,22}$/.test(example.videoId))throw new Error('Invalid Douyin example ID');
  return `https://open.douyin.com/player/video?vid=${example.videoId}&autoplay=1`;
 }
 if(!/^[\w-]{11}$/.test(example.videoId))throw new Error('Invalid YouTube example ID');
 return `https://www.youtube.com/embed/${example.videoId}?autoplay=1&playsinline=1&rel=0${example.endSeconds?`&end=${example.endSeconds}`:''}`;
}
export function examplePosterUrl(example:SkillExample):string|undefined {
 return example.poster||(example.provider==='douyin'?undefined:`https://i.ytimg.com/vi/${example.videoId}/hqdefault.jpg`);
}
// Brand-published examples, selected 2026-10-05. These are references, never input footage.
export const skillExamples:Record<Exclude<RecipeId,'auto'>,SkillExample>={
 pain_solution:{videoId:'ZUG9qYTJMsI',brand:'Dollar Shave Club',title:'品牌首发广告',description:'用一个熟悉的麻烦抓住注意，再用产品和演示给出解决方法。',source:'https://www.youtube.com/watch?v=ZUG9qYTJMsI',category:'转化'},
 demo:{videoId:'qg1ckCkm8YI',brand:'Blendtec',title:'Will It Blend? · iPhone',description:'围绕一个明确操作，保留过程与结果，让观众亲眼看到产品能力。',source:'https://www.youtube.com/watch?v=qg1ckCkm8YI',category:'产品'},
 testimonial:{videoId:'Yb7dBpndfiM',brand:'Dollar Shave Club',title:'会员真实体验广告',description:'让使用者讲自己的体验，用实际使用画面支撑评价。',source:'https://www.youtube.com/watch?v=Yb7dBpndfiM',category:'信任'},
 before_after:{videoId:'gY40xkRLpHA',brand:'OxiClean',title:'Carpet Commercial',description:'把同一对象的前后状态放在一起，完整展示变化过程。',source:'https://www.oxiclean.com/en/products/around-the-home/oxiclean-carpet-area-rug-stain-remover',category:'信任'},
 unboxing:{videoId:'_9sBc08FYEU',brand:'Samsung',title:'Galaxy S25 · 官方开箱',description:'从打开包装到产品亮相，再进入细节与使用体验，逐步兑现期待。',source:'https://www.youtube.com/watch?v=_9sBc08FYEU',category:'产品'},
 detail:{videoId:'cyuPTeHW7sM',brand:'Nespresso',title:'Vertuo Pop · 15 秒产品广告',description:'放大产品与体验的细节，利用特写和节奏建立质感。',source:'https://www.youtube.com/watch?v=cyuPTeHW7sM',category:'产品'},
 story:{videoId:'nnsSUqgkDwU',brand:'Google',title:'Parisian Love',description:'用有前因后果的小故事串联画面，让产品自然参与其中。',source:'https://www.youtube.com/watch?v=nnsSUqgkDwU',category:'故事'},
 benefits:{videoId:'ja6jlafz-w0',brand:'DJI',title:'Osmo Action 4 · 产品介绍',description:'一个片段讲清一个卖点，用对应的真实场景和演示强化记忆。',source:'https://www.youtube.com/watch?v=ja6jlafz-w0',category:'转化'},
 offer:{videoId:'MenJ51rBmJY',brand:'Samsung',title:'Black Friday Sale',description:'先让观众看懂活动，再展示产品与购买理由，以明确行动收束。',source:'https://www.youtube.com/watch?v=MenJ51rBmJY',category:'转化'},
};
