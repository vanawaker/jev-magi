import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, UNIT_IDS } from '../lib/magi.ts';
import { commandSchema, buildEvaluation, evaluateJev } from '../lib/jev.ts';
const input = { proposal:'今晚不加班，回家打游戏。' };
const form = binary => ({type:'choice',choice:binary>.5?'binary':'open',confidence:1,probabilities:{binary,choice:0,open:1-binary,none:0}});
const fixture = (a=.9,b=.7,c=.2,binary=1) => ({ answers:{form:form(binary),...Object.fromEntries(UNIT_IDS.map((id,i)=>[id,{type:'noul',noul:[a,b,c][i]}]))} });
test('all eight voting combinations use majority rule',()=>{
 for(let mask=0;mask<8;mask++) {
  const votes=Object.fromEntries(UNIT_IDS.map((id,i)=>[id,Boolean(mask&(1<<i))]));
  const expected=[3,5,6,7].includes(mask);
  assert.equal(decide(votes).approved,expected);
 }
});
test('proposal validation rejects missing, whitespace and oversized text',()=>{
 for(const value of [{},{proposal:'   '},{proposal:'x'.repeat(1201)},{proposal:'hello',roles:'override'}]) assert.equal(commandSchema.safeParse(value).success,false);
 assert.equal(commandSchema.parse({proposal:'  我想休息一天。  '}).proposal,'我想休息一天。');
 const request=buildEvaluation(input);
 assert.deepEqual(Object.keys(request.questions),['form',...UNIT_IDS]);
 assert.ok(UNIT_IDS.every(id=>request.questions[id].type==='noul'));
 assert.equal(request.questions.form.type,'choice');
 assert.deepEqual(Object.keys(request.questions.form.criteria),['binary','choice','open','none']);
 assert.ok(request.questions.melchior.instructions.includes('rational scientist'));
 assert.ok(request.questions.balthasar.instructions.includes('protective guardian'));
 assert.ok(request.questions.casper.instructions.includes('independent self'));
});
test('real transport converts three judgments to only booleans; ties vote no',async()=>{
 const result=await evaluateJev(input,'test-only-key',async(url,options)=>{
  assert.equal(url,'https://api.typesafe.ai/v1/systemone');
  assert.equal(options.headers.Authorization,'Bearer test-only-key');
  assert.equal(JSON.parse(options.body).state.proposal,input.proposal);
  return Response.json(fixture(.51,.5,.49));
 });
 assert.deepEqual(result,{votes:{melchior:true,balthasar:false,casper:false},approved:false});
});
test('anything that is not clearly a yes-or-no proposal gets no vote',async()=>{
 for(const binary of [.5,.3,0]) assert.deepEqual(await evaluateJev(input,'test',async()=>Response.json(fixture(.9,.9,.9,binary))),{invalid:true});
 assert.deepEqual(await evaluateJev(input,'test',async()=>Response.json(fixture(.9,.9,.9,.51))),{votes:{melchior:true,balthasar:true,casper:true},approved:true});
});
test('partial, malformed or failed replies cannot become a vote',async()=>{
 const {form:_,...noForm}=fixture().answers;
 for(const data of [{answers:{}},fixture(2),fixture(NaN),fixture(.9,.9,.9,NaN),{answers:noForm},{...fixture(),answers:{...fixture().answers,casper:{type:'choice',noul:.9}}}]) {
  await assert.rejects(evaluateJev(input,'test',async()=>Response.json(data)),/答覆不完整/);
 }
 for(const [status,message] of [[401,/密鑰無效/],[429,/額度/],[503,/無法完成/]]) await assert.rejects(evaluateJev(input,'test',async()=>new Response('',{status})),message);
 await assert.rejects(evaluateJev(input,'test',async()=>{throw Error('network')}),/通信中斷/);
});
test('redirects are refused and the key is never sent on',async()=>{
 let calls=0;
 await assert.rejects(evaluateJev(input,'test',async(url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{Location:'https://elsewhere.example/'}});}),/跳轉/);
 assert.equal(calls,1);
});
