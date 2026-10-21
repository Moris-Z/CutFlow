import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { callModel } from '../server/model.js';
import { config } from '../server/settings.js';
test('model adapter sends documented JSON shape and rejects invalid structured output',async()=>{
 let calls=0;const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);assert.equal(req.url,'/v1/chat/completions');assert.equal(body.response_format.type,'json_object');assert.equal(body.messages[0].role,'system');assert.equal(body.model,'test-fixture');assert.equal(req.headers.authorization,'Bearer test-only');calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:calls===1?'{"value":42}':'{"wrong":true}'}}]}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const previous={...config};Object.assign(config,{apiKey:'test-only',model:'test-fixture',baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`});
 try{assert.deepEqual(await callModel('test',{evidence:'fixture'},z.object({value:z.number()})),{value:42});await assert.rejects(()=>callModel('test',{},z.object({value:z.number()})),{code:'MODEL_SCHEMA_INVALID'});}finally{Object.assign(config,previous);await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
