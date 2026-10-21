/** Explicit, versioned execution surface: no arbitrary model-authored code. */
export const skillRegistry=[
 {id:'media.probe',version:'1.0.0',owner:'cutflow',input:'local video',output:'AssetManifest',timeout_ms:60000,side_effects:['artifact.write'],cost:'local',failure:'INVALID_MEDIA'},
 {id:'edl.build',version:'1.1.0',owner:'cutflow',input:'Brief + ShotIndex',output:'EDLSchema@1.0',timeout_ms:90000,side_effects:[],cost:'local_or_model',failure:'MODEL_SCHEMA_INVALID'},
 {id:'workflow.plan',version:'1.0.0',owner:'cutflow',input:'skill + Brief + sources + options',output:'reviewable plan group',timeout_ms:300000,side_effects:['task.write'],cost:'local_or_model',failure:'SKILL_PREREQUISITE_MISSING'},
 {id:'audio.transcribe',version:'1.0.0',owner:'cutflow',input:'source audio + configured provider',output:'timestamped speech shots',timeout_ms:180000,side_effects:['network.audio'],cost:'provider',failure:'ASR_FAILED'},
 {id:'rhythm.detect',version:'1.0.0',owner:'cutflow',input:'reference cuts or selected music',output:'measured cut / onset timestamps',timeout_ms:180000,side_effects:['artifact.write'],cost:'local',failure:'RHYTHM_NOT_FOUND'},
 {id:'voice.generate',version:'1.0.0',owner:'cutflow',input:'approved narration + language + duration',output:'audible fitted voice cache',timeout_ms:90000,side_effects:['network.text','artifact.write'],cost:'online_voice',failure:'NARRATION_FAILED'},
 {id:'edl.patch',version:'1.0.0',owner:'cutflow',input:'approved EDL + feedback',output:'EDLPatch',timeout_ms:90000,side_effects:[],cost:'local_or_model',failure:'LOCK_CONFLICT'},
 {id:'render.video',version:'1.0.0',owner:'cutflow',input:'approved EDLSchema@1.0',output:'MP4 + SRT + cover',timeout_ms:1200000,side_effects:['artifact.write'],cost:'local',failure:'RENDER_FAILED'},
 {id:'qa.editorial',version:'1.0.0',owner:'cutflow',input:'EDL + reviewed key-action windows',output:'QAReport',timeout_ms:1000,side_effects:[],cost:'local',failure:'KEY_ACTION_CUT'},
 {id:'qa.technical',version:'1.0.0',owner:'cutflow',input:'RenderResult + EDL',output:'QAReport',timeout_ms:180000,side_effects:[],cost:'local',failure:'QA_FAILED'},
 {id:'trace.build',version:'1.0.0',owner:'cutflow',input:'Task + delivery manifest',output:'Trace@1.0',timeout_ms:10000,side_effects:['artifact.write'],cost:'local',failure:'TRACE_WRITE_FAILED'}
] as const;
