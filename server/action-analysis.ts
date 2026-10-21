import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ShotIntentSchema,type Asset,type Shot} from '../shared/types.js';
import {assert} from './errors.js';
import {callModel,modelAvailable} from './model.js';
import {sampleActionFrames} from './media.js';
import {protectedRange} from './editorial.js';

const ResponseSchema=z.object({summary:z.string().max(1500),uncertainties:z.array(z.string().max(500)).max(12),intent:ShotIntentSchema.nullable()});
/** Temporal model output is a proposal. It is never silently promoted to approved evidence. */
export async function proposeActionAnalysis(asset:Asset,assetsDir:string){
 assert(modelAvailable(),'MODEL_NOT_CONFIGURED','请先配置支持图像输入的模型，或直接人工标注关键动作',409);
 const sampled=await sampleActionFrames(asset.file_path,asset.duration_ms,path.join(assetsDir,asset.id,'action-samples'));
 const images=await Promise.all(sampled.map(async f=>`data:image/jpeg;base64,${(await readFile(f.path)).toString('base64')}`));
 const result=await callModel('你是视频选段分析员。输入图片按源片时间顺序排列，每张对应 source_frames 同序时间码。先判断观众应理解的核心信息，再识别动作开始、完成结果与反应，不能只凭第一帧决定选段。返回 {summary,uncertainties:[],intent:null或{message,key_action,action_start_ms,action_end_ms,pre_roll_ms,post_roll_ms,priority,required,evidence:{description,observed_at_ms:[]}}}。时间均为源片毫秒。observed_at_ms只能引用实际提供的采样时间，至少两张不同采样，并包围动作起点和完成点。动作及前后余量不能超出源片。priority为1到5，required默认true。动作未发生、看不出完成、跨越多场景、采样太稀或对白含义未知时，intent必须null，并明确不确定性。不根据字幕或文件名编造动作，不把举杯等同于喝下，不把接触等同于完成。描述是候选意见，仍需用户观看完整片段确认。',{source_name:asset.name,duration_ms:asset.duration_ms,source_frames:sampled.map(f=>f.time_ms),sampling_limit:'最多16张有序静帧，不是完整视频推理；快动作和音频未验证'},ResponseSchema,images);
 const shot:Shot={id:randomUUID(),asset_id:asset.id,start_ms:0,end_ms:asset.duration_ms,summary:result.summary,evidence:{type:'model_vision',description:'有序多帧模型建议，尚未人工确认',confidence:0.6}};
 if(result.intent){assert(result.intent.evidence.observed_at_ms.every(t=>sampled.some(f=>f.time_ms===t)),'MODEL_UNKNOWN_FRAME','模型引用了未提供的帧时间；请手动标注或重试',422);shot.intent=result.intent;protectedRange(shot);}
 // Existing manual labels remain intact. The modal allows the user to review an additional proposal.
 const existing=asset.shots.filter(s=>s.evidence.type==='user_annotation');
 return {...asset,file_path:'',shots:[...existing,shot],warnings:[...asset.warnings,'多帧分析仅为建议；请核对动作开始、完成和收尾，保存注释后才用于新方案。',...result.uncertainties]};
}
