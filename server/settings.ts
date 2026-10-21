import type { Settings } from '../shared/types.js';
import { z } from 'zod';
import { AppError } from './errors.js';
export interface ModelConfig {apiKey:string;baseUrl:string;model:string}
export const config:ModelConfig={apiKey:process.env.MODEL_API_KEY||'',baseUrl:process.env.MODEL_BASE_URL||'https://api.openai.com/v1',model:process.env.MODEL_NAME||''};
let renderer=process.env.RENDERER==='remotion'?'remotion':'ffmpeg';
export function settings():Settings{return {confirm_text_plan:true,model_configured:!!(config.apiKey&&config.model),model_name:config.model,model_base_url:config.baseUrl,renderer,capabilities:[
{id:'media.probe',name:'素材探测与证据索引',status:'ready',description:'真实元数据、哈希、缩略图；可补充带时间码的人工标注'},
{id:'vlm.segment_label',name:'视觉帧分析',status:config.apiKey&&config.model?'ready':'requires_model',description:'有序多帧分析关键动作候选，核对保存后参与规划；不是完整视频或语音理解'},
{id:'edl.build',name:'结构化剪辑计划',status:'ready',description:'有模型时按证据规划；优先保留已标注的关键动作与收尾，未标注内容明确待审阅'},
{id:'render.preview',name:'预览与高清导出',status:'ready',description:'FFmpeg / Remotion 受控渲染、SRT、封面、交付清单'},
{id:'audio.bgm',name:'背景音乐与有声交付',status:'ready',description:'默认或指定配乐、授权音频导入、循环混音与人声避让；拦截无声输出'},
{id:'edl.patch',name:'对话修改与版本回退',status:'ready',description:'变更预览、锁定保护、旧版本保留、可回退'},
{id:'qa.editorial',name:'关键动作完整性检查',status:'ready',description:'检查已标注动作、起势和收尾是否被保留；未标注素材需要审阅，不等于自动理解连续视频'},
{id:'qa.technical',name:'实际文件技术质检',status:'ready',description:'时长、画幅、解码、黑帧、音量；内容与版权需人工审阅'},
{id:'asr.transcribe',name:'语音转写与口播剪辑',status:config.apiKey?'ready':'requires_model',description:'使用已配置服务的 audio/transcriptions 接口或人工逐字稿；ASR_MODEL 默认 whisper-1'},
{id:'beat.align',name:'音乐卡点与参考片节奏',status:'ready',description:'分析实际音频重音和参考片切镜；保护完整动作和口播'},
{id:'workflow.variants',name:'多版本与多尺寸',status:'ready',description:'生成独立可审阅项目，检查重复版本，各版本分别确认和导出'}]};}
const UpdateSchema=z.object({default_bgm_id:z.string().max(100).optional(),confirm_text_plan:z.boolean().optional(),model_api_key:z.string().max(1000).optional(),model_base_url:z.string().url().optional(),model_name:z.string().max(200).optional(),renderer:z.enum(['ffmpeg','remotion']).optional()}).strict();
export function updateSettings(input:unknown){const v=UpdateSchema.parse(input);if(v.model_base_url){const url=new URL(v.model_base_url);if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol))throw new AppError('INVALID_MODEL_URL','模型地址应为不含账号、查询参数的 HTTP(S) API 根路径');if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new AppError('INSECURE_MODEL_URL','远程模型服务必须使用 HTTPS');const changed=config.baseUrl!==v.model_base_url.replace(/\/$/,'');config.baseUrl=v.model_base_url.replace(/\/$/,'');if(changed&&!v.model_api_key)config.apiKey='';}if(v.model_api_key!==undefined)config.apiKey=v.model_api_key;if(v.model_name!==undefined)config.model=v.model_name;if(v.renderer)renderer=v.renderer;return settings();}
