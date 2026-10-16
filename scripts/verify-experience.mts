import assert from 'node:assert/strict';
import { createAction, createBehavior, createDocument, validateDocument, type Behavior } from '@studio/scene-schema';
import { EditorSession, bindContent, addEntity } from '@studio/editor-core';
import { RuleExecutor, TourPlayback } from '@studio/scene-runtime';
import { RuntimeState, type CameraPose as Pose } from '../packages/scene-runtime/src/RuntimeState';

const doc=createDocument('创作语义验收');
const session=new EditorSession(doc);session.execute(addEntity());const entityId=session.document.entities[0].id;session.execute(bindContent(entityId,'Hotspot'));
assert.equal(session.document.contents.length,1);const contentId=session.document.contents[0].id;session.execute(bindContent(entityId,'Artwork'));
assert.equal(session.document.contents.length,1);assert.equal(session.document.entities[0].components.find(c=>c.type==='Artwork')!.data.contentId,contentId);
const assets=session.document.assets,ui=session.document.ui;session.execute({label:'修改内容',mutate:d=>{d.contents[0].body='同一条资料';}});assert.equal(session.document.assets,assets);assert.equal(session.document.ui,ui);session.undo();assert.equal(session.document.contents[0].body,'');session.redo();assert.equal(session.document.contents[0].body,'同一条资料');
const invalid=structuredClone(session.document);invalid.ui.nodes[0].parentId=invalid.ui.nodes[0].id;assert.ok(validateDocument(invalid).some(e=>e.includes('环')));
const badContent=structuredClone(session.document);badContent.contents[0].imageAssetId='missing';assert.ok(validateDocument(badContent).some(e=>e.includes('asset')));

const views:Pose[]=[{position:[0,1000,0],target:[0,1000,-1000],fov:45},{position:[2000,1200,0],target:[2000,1200,-1000],fov:90},{position:[4000,1000,0],target:[4000,1000,-1000],fov:60}];
let pose=views[0],arrivals=0,completed=0;
const tour=new TourPlayback(id=>views[Number(id)],value=>{pose=value;},()=>{},()=>arrivals++,()=>completed++);
const route={id:'tour',name:'三站',loop:false,speed:1000,stops:views.map((_,i)=>({id:'stop'+i,viewpointId:String(i),hold:3,travel:2}))};
tour.start(route);tour.update(4);assert.ok(pose.fov>45&&pose.fov<90);const progress=tour.state.progress,pausedPose=structuredClone(pose);tour.pause();tour.update(8);assert.equal(tour.state.progress,progress);assert.deepEqual(pose,pausedPose);tour.resume();tour.update(1);assert.equal(tour.state.stopId,'stop1');tour.stop();const stopped=structuredClone(pose);tour.update(100);assert.deepEqual(pose,stopped);tour.start(route);assert.equal(tour.state.progress,0);tour.update(20);assert.equal(tour.state.status,'completed');assert.equal(completed,1);assert.deepEqual(pose,views[2]);assert.ok(arrivals>=4);

const runtime=new RuntimeState();runtime.patch({mode:'play',variables:{flag:false,count:0}});const rulesDoc=createDocument();let count=0;
const executor=new RuleExecutor(runtime,()=>rulesDoc,async(action,signal)=>{if(action.type==='SetVariable'){const value=action.data.value;runtime.patch({variables:{...runtime.getSnapshot().variables,[action.targetId]:value as boolean|number}});await executor.emit('variableChange',action.targetId,'variable',signal);}else if(action.type==='Hide')throw new Error('缺失目标');else count++;});
const rule=(name:string):Behavior=>({...createBehavior(name),sourceKind:'scene',event:'ready'});
const waiting=rule('等待并忽略重复');waiting.actions=[{...createAction('Delay'),data:{seconds:.02}},createAction('Show')];const one=executor.run(waiting);await executor.run(waiting);await one;assert.equal(count,1);
const branch=rule('条件分支');branch.actions=[{...createAction('If'),condition:{type:'compare',source:'variable',key:'flag',operator:'eq',value:false},then:[createAction('Show')],else:[createAction('Hide')]}];await executor.run(branch);assert.equal(count,2);
const failure=rule('失败停止');failure.actions=[createAction('Hide'),createAction('Show')];await assert.rejects(executor.run(failure),/缺失目标/);assert.equal(count,2);
const cancellable=rule('取消延时');cancellable.actions=[{...createAction('Delay'),data:{seconds:30}},createAction('Show')];const running=executor.run(cancellable);await new Promise(r=>setTimeout(r,1));executor.cancel(cancellable.id);await running;assert.equal(count,2);assert.ok(runtime.getSnapshot().trace.some(t=>t.ruleId===cancellable.id&&t.status==='cancelled'));
const queued=rule('排队取消');queued.concurrency='queue';queued.actions=[{...createAction('Delay'),data:{seconds:30}},createAction('Show')];const queuedOne=executor.run(queued),queuedTwo=executor.run(queued);await new Promise(r=>setTimeout(r,1));executor.cancel(queued.id);await Promise.all([queuedOne,queuedTwo]);assert.equal(count,2);
const resetting=rule('停止会话取消排队');resetting.concurrency='queue';resetting.actions=[{...createAction('Delay'),data:{seconds:30}},createAction('Show')];const resetOne=executor.run(resetting),resetTwo=executor.run(resetting);await new Promise(r=>setTimeout(r,1));executor.reset();await Promise.all([resetOne,resetTwo]);assert.equal(count,2);
const loop=rule('循环规则');loop.event='variableChange';loop.sourceKind='variable';loop.sourceId='flag';loop.actions=[{...createAction('SetVariable'),targetId:'flag',data:{value:true}}];rulesDoc.behaviors=[loop];await assert.rejects(executor.emit('variableChange','flag','variable'),/循环触发/);
console.log('Pass: shared content, inverse history, reference integrity, three-stop camera interpolation, pause/resume/stop/replay, conditions, duplicate trigger, failure, cancellation, causal loop detection.');
