import { existsSync,mkdirSync } from 'node:fs';
import { readFile,unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Load environment before settings module is dynamically loaded.
if(existsSync('.env'))process.loadEnvFile('.env');
const { createApp }=await import('./server.js');
const port=Number(process.env.PORT||4318);
const {app}=createApp(path.resolve(process.env.CUTFLOW_DATA_DIR||'.local/data'));
const server=app.listen(port,'127.0.0.1',()=>console.log(`CutFlow API: http://127.0.0.1:${port}`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
