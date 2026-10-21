export interface CompositionClip {src:string;frames:number;caption:string;title:string;cta:string}
export interface CompositionProps extends Record<string, unknown> {width:number;height:number;fps:number;clips:CompositionClip[]}
