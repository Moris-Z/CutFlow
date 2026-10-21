import express,{type Request,type Response} from 'express';
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Run the public demo in a separate process. Never load the local .env or data directory.
for(const key of ['MODEL_API_KEY','MODEL_NAME','MODEL_BASE_URL','DOUYIN_API_KEY','LARK_APP_ID','LARK_APP_SECRET'])delete process.env[key];
process.env.CUTFLOW_SHARE_MODE='1';
const {createApp}=await import('./server.js');

const root=path.resolve(process.env.CUTFLOW_SHARE_DATA_DIR||'.local/share-data');
mkdirSync(root,{recursive:true,mode:0o700});
const secretPath=path.join(root,'.cookie-secret');
if(!existsSync(secretPath))writeFileSync(secretPath,randomBytes(32),{flag:'wx',mode:0o600});
const secret=readFileSync(secretPath);
const maxSessions=Number(process.env.CUTFLOW_SHARE_MAX_SESSIONS||60);
const sessions=new Map<string,ReturnType<typeof createApp>['app']>();
const cookieName='cutflow_share';
const sign=(id:string)=>createHmac('sha256',secret).update(id).digest('hex');
function sessionId(req:Request){
 const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
 const match=/^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(cookie||'');
 if(!match)return undefined;
 const [id,mac]=[match[1],match[2]];
 return timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(sign(id),'hex'))?id:undefined;
}
function blocked(req:Request,res:Response){
 let route:string;
 try{route=decodeURIComponent(req.path).toLowerCase();}
 catch{res.status(400).json({error:{code:'INVALID_PATH',message:'请求路径无效'}});return true;}
 if(route.startsWith('/api/source-connections')){
  res.status(403).json({error:{code:'SHARE_DISABLED',message:'公开体验版不连接企业素材来源'}});return true;
 }
 if(req.method==='POST'&&route==='/api/settings'){
  res.status(403).json({error:{code:'SHARE_DISABLED',message:'公开体验版不能修改服务端模型配置'}});return true;
 }
 return false;
}

export function createShareApp(){
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{
  if(blocked(req,res))return;
  let id=sessionId(req);
  if(!id){
   if(sessions.size>=maxSessions)return res.status(503).json({error:{code:'SHARE_FULL',message:'体验空间已满，请稍后再试'}});
   id=randomUUID();
   res.setHeader('Set-Cookie',`${cookieName}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=1209600`);
  }
  let instance=sessions.get(id);
  if(!instance){
   if(sessions.size>=maxSessions)return res.status(503).json({error:{code:'SHARE_FULL',message:'体验空间已满，请稍后再试'}});
   instance=createApp(path.join(root,'sessions',id),{search:{}}).app;
   sessions.set(id,instance);
  }
  instance(req,res,next);
 });
 return app;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const port=Number(process.env.CUTFLOW_SHARE_PORT||4320);
 createShareApp().listen(port,'127.0.0.1',()=>console.log(`CutFlow share server: http://127.0.0.1:${port}`));
}
