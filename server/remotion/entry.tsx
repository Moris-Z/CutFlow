import React from 'react';
import {AbsoluteFill, Composition, OffthreadVideo, Sequence, getInputProps, registerRoot, useVideoConfig} from 'remotion';
import type {CompositionProps} from './props';

/** Fixed, reviewed React component. User and model text is data, never JSX/code. */
const Timeline:React.FC<CompositionProps> = ({clips}) => {
  const {width,height}=useVideoConfig();
  const size=Math.round(Math.min(width,height)*0.043);
  let cursor=0;
  const textStyle:React.CSSProperties={position:'absolute',left:'9%',width:'82%',color:'#fff',fontFamily:'PingFang SC, Noto Sans CJK SC, sans-serif',fontSize:size,lineHeight:1.28,fontWeight:600,textAlign:'center',whiteSpace:'pre-wrap',overflowWrap:'anywhere'};
  const box:React.CSSProperties={display:'inline-block',padding:'0.4em',backgroundColor:'rgba(0,0,0,0.6)',borderRadius:3};
  return <AbsoluteFill style={{backgroundColor:'#000'}}>{clips.map((clip,index)=>{
    const from=cursor;cursor+=clip.frames;
    return <Sequence key={index} from={from} durationInFrames={clip.frames} name={`Clip ${index+1}`}>
      <AbsoluteFill>
        <OffthreadVideo src={clip.src} style={{width:'100%',height:'100%',objectFit:'contain'}} />
        {clip.title&&<div style={{...textStyle,top:'3.5%'}}><span style={box}>{clip.title}</span></div>}
        {clip.cta&&<div style={{...textStyle,top:'15%',fontSize:Math.round(size*1.14)}}><span style={box}>{clip.cta}</span></div>}
        {clip.caption&&<div style={{...textStyle,bottom:'14%'}}><span style={box}>{clip.caption}</span></div>}
      </AbsoluteFill>
    </Sequence>;
  })}</AbsoluteFill>;
};
const defaults:CompositionProps={width:720,height:1280,fps:30,clips:[]};
const Root:React.FC=()=>{
  const props={...defaults,...getInputProps<CompositionProps>()};
  return <Composition id="CutflowTimeline" component={Timeline} width={props.width} height={props.height} fps={props.fps} durationInFrames={Math.max(1,props.clips.reduce((sum,clip)=>sum+clip.frames,0))} defaultProps={props}/>;
};
registerRoot(Root);
