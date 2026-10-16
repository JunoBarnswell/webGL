import * as THREE from 'three';
import type { Tour, Viewpoint } from '@studio/scene-schema';
import type { CameraPose, TourState } from './RuntimeState';

export class TourPlayback {
  private tour:Tour|null=null;
  private index=0;
  private elapsed=0;
  private holding=true;
  private status:TourState['status']='stopped';
  private phaseDuration=0;
  private points:CameraPose[]=[];
  private curve:THREE.CatmullRomCurve3|null=null;
  private sequenceTime=0;
  constructor(private resolve:(id:string)=>CameraPose,private apply:(pose:CameraPose)=>void,private changed:(state:TourState)=>void,private arrived:(viewpointId:string)=>void,private completed:(tourId:string)=>void){}
  get id():string{return this.tour?.id??'';}
  get state():TourState{return {id:this.id,status:this.status,progress:this.progress(),stopId:this.tour?.stops[this.index]?.id??''};}
  private travel(index:number):number{
    if(!this.tour||index===0&&!this.tour.loop)return 0;if(this.tour.stops[index].travel)return this.tour.stops[index].travel;
    const a=this.points[(index-1+this.points.length)%this.points.length],b=this.points[index],from=new THREE.Vector3().fromArray(a.position),to=new THREE.Vector3().fromArray(b.position);
    const turn=new THREE.Vector3().fromArray(a.target).sub(from).angleTo(new THREE.Vector3().fromArray(b.target).sub(to))/(Math.PI/3);
    return Math.max(from.distanceTo(to)/this.tour.speed,turn,Math.abs(a.fov-b.fov)/45);
  }
  private total():number{return this.tour?.stops.reduce((sum,s,i)=>sum+s.hold+this.travel(i),0)??0;}
  private progress():number{return this.status==='completed'?1:Math.min(1,this.sequenceTime/Math.max(.001,this.total()));}
  start(tour:Tour):void{
    if(tour.stops.length<2)throw new Error('巡航至少需要两个视点');this.tour=tour;this.points=tour.stops.map(s=>this.resolve(s.viewpointId));this.curve=new THREE.CatmullRomCurve3(this.points.map(p=>new THREE.Vector3().fromArray(p.position)),tour.loop,'centripetal');
    this.index=0;this.elapsed=0;this.sequenceTime=0;this.holding=true;this.phaseDuration=tour.stops[0].hold;this.status='playing';this.apply(this.points[0]);this.arrived(tour.stops[0].viewpointId);this.changed(this.state);
  }
  pause():void{if(this.status==='playing'){this.status='paused';this.changed(this.state);}}
  resume():void{if(this.status!=='paused')throw new Error('巡航当前未暂停');this.status='playing';this.changed(this.state);}
  stop():void{this.status='stopped';this.changed(this.state);}
  seek(progress:number):void{
    if(!this.tour)throw new Error('巡航尚未开始');const remainingStatus=this.status==='paused'?'paused':'playing';this.index=0;this.elapsed=0;this.sequenceTime=0;this.holding=true;this.phaseDuration=this.tour.stops[0].hold;this.status='playing';this.update(this.total()*Math.max(0,Math.min(1,progress)),false);if(this.state.status!=='completed')this.status=remainingStatus;this.changed(this.state);
  }
  update(dt:number,events=true):boolean{
    if(this.status!=='playing'||!this.tour)return false;
    let remaining=dt;let iterations=0;
    while(remaining>=0&&this.status==='playing'&&iterations++<1024){
      const consumed=Math.min(remaining,Math.max(0,this.phaseDuration-this.elapsed));this.elapsed+=consumed;this.sequenceTime+=consumed;remaining-=consumed;
      if(!this.holding){const t=this.phaseDuration?this.elapsed/this.phaseDuration:1;const smooth=t*t*(3-2*t),a=this.points[(this.index-1+this.points.length)%this.points.length],b=this.points[this.index];const position=this.curve!.getPoint((this.index===0?this.points.length-1+smooth:this.index-1+smooth)/(this.tour.loop?this.points.length:this.points.length-1));const target=new THREE.Vector3().fromArray(a.target).lerp(new THREE.Vector3().fromArray(b.target),smooth);this.apply({position:position.toArray(),target:target.toArray(),fov:THREE.MathUtils.lerp(a.fov,b.fov,smooth)});}
      if(this.elapsed+1e-9<this.phaseDuration)break;
      this.elapsed=0;
      if(!this.holding){if(this.tour.loop&&this.index===0)this.sequenceTime=0;this.holding=true;this.phaseDuration=this.tour.stops[this.index].hold;this.apply(this.points[this.index]);if(events)this.arrived(this.tour.stops[this.index].viewpointId);}
      else if(this.index+1<this.points.length){this.index++;this.holding=false;this.phaseDuration=this.travel(this.index);}
      else if(this.tour.loop){this.index=0;this.holding=false;this.phaseDuration=this.travel(0);if(this.total()===0)throw new Error('循环巡航不能全部为零时长');}
      else{this.status='completed';if(events)this.completed(this.tour.id);break;}
      if(remaining===0&&this.phaseDuration>0)break;
    }
    if(iterations>=1024)throw new Error('巡航零时长阶段过多');this.changed(this.state);return this.status==='playing';
  }
}
export function viewPose(view:Viewpoint):CameraPose{return {position:view.position,target:view.target,fov:view.fov};}
