import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, KeyRound, Power, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProposalConsole } from '@/components/proposal-console';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CrtEffects } from '@/components/crt-effects';
import { UNIT_IDS, UNITS, type Outcome, type UnitId, type Verdict } from '@/lib/magi';
import { commandSchema, evaluateJev, JevError } from '@/lib/jev';
import { clearKey, loadKey, native, openExternal, saveKey, transport } from '@/lib/native';

// Everyday yes-or-no dilemmas; each visit opens with one at random.
const EXAMPLES = [
  '想養一隻貓，但每天加班到十點，現在該養嗎？',
  '喜歡的人三天沒回消息了，我要主動再找他嗎？',
  '同事升職了，我比他早來兩年，要找老闆談加薪嗎？',
  '健身卡還剩半年沒去過幾次，要轉讓出去嗎？',
  '剛買的手機降價一千，還能七天無理由退貨，要退了重買嗎？',
  '朋友又找我借兩萬塊，上次的還沒還，這次還要借嗎？',
  '房東要漲租兩成，搬家要折騰一個月，我該搬嗎？',
  '年假只剩兩天，老闆說項目很急，我還要按原計劃去旅行嗎？',
  '爸媽催我回老家考編，我在大城市月薪一萬，要回去嗎？',
  '存款夠付首付了，但要背三十年房貸，現在該買房嗎？',
];
const pickExample = () => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];

type Phase = 'idle' | 'evaluating' | 'revealing' | 'complete';
// The screen is laid out at a reference size and scaled as one piece: tall screens use the phone
// composition (388×666 inside the frame, an iPhone), wide screens the desktop one (1252×772).
// Wider screens widen the input and panels while the three units keep their proportions.
type Stage = { k: number; width: number; height: number };
function fitStage(width: number, height: number): Stage {
  const wide = width >= height * 0.9;
  const [refWidth, refHeight] = wide ? [1252, 772] : [388, 666];
  let k = Math.max(Math.min(width / refWidth, height / refHeight), wide ? 0.6 : 0.8);
  // Tall screens stay within the phone breakpoint so they keep the phone composition.
  if (!wide) k = Math.max(k, width / 600);
  return { k, width: width / k, height: height / k };
}
export type Reply = { status: number; data: Partial<Verdict> & { invalid?: boolean; error?: string; code?: string } };
// A page hosting MAGI on its own server can swap the server protocol and the copy around the
// screen; everything else stays the same.
export type Host = {
  status?: () => Promise<{ configured: boolean }>;
  vote?: (proposal: string, key: string, signal: AbortSignal) => Promise<Reply>;
  keyCodes?: string[];
  badge?: ReactNode;
  keyLabel?: (state: { apiKey: boolean; verified: boolean; connected: boolean }) => ReactNode;
  notice?: (state: { apiKey: boolean }) => ReactNode;
  dialog?: { title?: ReactNode; description?: ReactNode; placeholder?: string; note?: ReactNode; requireKey?: boolean };
  footer?: ReactNode;
};
const serverStatus = () => fetch('/api/status').then(r => r.json() as Promise<{ configured?: boolean }>).then(d => ({ configured: d.configured === true }));
// The web build asks its own server; the packaged app calls TypeSafe directly.
async function requestVote(proposal: string, key: string, signal: AbortSignal): Promise<Reply> {
  if (!native) {
    const response = await fetch('/api/evaluate', { method:'POST', headers:{'Content-Type':'application/json',...(key ? {'X-TypeSafe-Key':key} : {})}, body:JSON.stringify({proposal}), signal });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('連接已失效，請重新載入頁面後重試。');
    return { status: response.status, data: await response.json() };
  }
  const input = commandSchema.safeParse({ proposal });
  if (!input.success) return { status: 400, data: { error: '請輸入 1–1200 字的議案。' } };
  try { return { status: 200, data: await evaluateJev(input.data, key, transport) }; }
  catch (e) {
    if (!(e instanceof JevError)) throw e;
    return { status: e.status, data: e.status === 401 ? { error: '這個 API Key 無效或不可用，請檢查後重新填寫。', code: 'INVALID_KEY' } : { error: e.message } };
  }
}
const DecisionUnit = memo(function DecisionUnit({ id, vote, phase, visible }: { id: UnitId; vote: boolean | 'error' | undefined; phase: Phase; visible: boolean }) {
  const unit = UNITS[id];
  const ready = visible && vote !== undefined;
  return <section className={`decision-unit unit-${id} ${ready ? vote === true ? 'vote-yes' : 'vote-no' : ''} ${phase === 'evaluating' || (phase === 'revealing' && !ready) ? 'unit-thinking' : ''}`} aria-label={`${unit.name} · ${unit.dimension}`}>
    <div className="unit-body">
      <div className="unit-ident"><span>{unit.identity}</span><b>{unit.number}</b></div>
      <h2>{unit.name}<span>{unit.dimension}</span></h2>
      <div className={`unit-answer ${ready ? 'answer-revealed' : ''}`} aria-label={ready ? (vote === 'error' ? '錯誤' : vote ? '是' : '否') : phase === 'idle' ? '待命' : '判斷中'}>{ready ? (vote === 'error' ? <span style={{fontSize:'.62em'}}>錯誤</span> : vote ? '是' : '否') : <span className="standby">{phase === 'idle' ? '待命' : '判斷中'}</span>}</div>
      <div className="unit-foot"><span>{unit.description}</span><i/><i/><i/></div>
    </div>
  </section>;
});
export default function Home({ host = {} }: { host?: Host }) {
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [example] = useState(pickExample);
  const proposalRef = useRef(example);
  const [phase, setPhase] = useState<Phase>('idle');
  const [verdict, setVerdict] = useState<Outcome | null>(null);
  const [visible, setVisible] = useState(0);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [serverReady, setServerReady] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [verified, setVerified] = useState(false);
  const pendingRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  useLayoutEffect(() => {
    const host = stageRef.current?.parentElement;
    if (!host) return;
    const update = () => setStage(fitStage(host.clientWidth, host.clientHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const controllerRef = useRef<AbortController | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = phase === 'evaluating' || phase === 'revealing';
  const connected = Boolean(apiKey || serverReady);
  useEffect(() => {
    let active = true;
    if (native) loadKey().then(saved => { if (active && saved) setApiKey(saved); }).catch(() => {});
    else (host.status ?? serverStatus)().then(d => { if (active) setServerReady(d.configured); }).catch(() => {});
    return () => { active = false; controllerRef.current?.abort(); timers.current.forEach(clearTimeout); };
  }, []);
  const changeProposal = useCallback((value: string) => {
    proposalRef.current = value;
    if (error) setError('');
    if (phase === 'complete') { setPhase('idle'); setVerdict(null); setVisible(0); }
  }, [error, phase]);
  function openConnection() { setKeyDraft(apiKey); setQueued(false); setConnectionOpen(true); }
  async function submit(keyOverride?: string) {
    const text = proposalRef.current.trim();
    if (!text || pendingRef.current) return;
    const key = keyOverride ?? apiKey;
    if (!key && !serverReady) { setQueued(true); setKeyDraft(''); setConnectionOpen(true); return; }
    pendingRef.current = true; setPhase('evaluating'); setError(''); setVerdict(null); setVisible(0);
    const controller = new AbortController(); controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const { status, data } = await (host.vote ?? requestVote)(text, key, controller.signal);
      if (status !== 200) {
        if (status === 401) { setVerified(false); if (native) void clearKey().catch(() => {}); }
        if ((host.keyCodes ?? ['KEY_REQUIRED','INVALID_KEY']).includes(data.code || '')) { setKeyDraft(key); setQueued(true); setConnectionOpen(true); }
        throw new Error(data.error || '通信異常，請重新發起議決。');
      }
      if (data.invalid !== true && (!UNIT_IDS.every(id => typeof data.votes?.[id] === 'boolean') || typeof data.approved !== 'boolean')) throw new Error('答覆不完整，本次議決未成立。');
      setVerified(true); setVerdict(data.invalid === true ? { invalid: true } : { votes: data.votes as Verdict['votes'], approved: data.approved === true }); setPhase('revealing');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      timers.current.forEach(clearTimeout);
      timers.current = UNIT_IDS.map((_, i) => setTimeout(() => setVisible(i + 1), reduced ? 0 : i * 180));
      timers.current.push(setTimeout(() => { setPhase('complete'); pendingRef.current = false; }, reduced ? 0 : 640));
    } catch (e) {
      setError(controller.signal.aborted ? '回應逾時，請重新發起議決。' : e instanceof Error ? e.message : '通信中斷，請重試。');
      setPhase('idle'); pendingRef.current = false;
    } finally { clearTimeout(timeout); controllerRef.current = null; }
  }
  const failed = verdict !== null && 'invalid' in verdict;
  const approved = verdict !== null && !('invalid' in verdict) && verdict.approved;
  const yes = verdict && !('invalid' in verdict) ? UNIT_IDS.filter(id => verdict.votes[id]).length : 0;
  return <div className={`crt-shell ${crtEnabled ? 'crt-on' : 'crt-off'}`}>
    <CrtEffects/>
    <div className="crt-picture"><div className="crt-scroll"><div ref={stageRef} className="magi-stage" style={stage ? { width: stage.width, height: stage.height, transform: `scale(${stage.k})` } : undefined}><main className="magi-app">
    <header className="system-header">{host.badge ?? <a className="system-name" href="/" aria-label="MAGI 首頁"><span className="system-emblem" aria-hidden="true">M</span><span className="system-title"><small>MAGI://</small>人格模擬系統</span></a>}<Button variant="ghost" className={`connection-button ${verified?'connection-live':''}`} onClick={openConnection} disabled={busy}><i/>{host.keyLabel?.({ apiKey: Boolean(apiKey), verified, connected }) ?? (verified?'JEV 在線':connected?'密鑰已就緒':'連接密鑰')}<KeyRound size={15}/></Button></header>
    {host.notice && <p className="access-summary">{host.notice({ apiKey: Boolean(apiKey) })}</p>}
    <div className="terminal">
      <div className="terminal-heading"><div className="wordmark"><h1><span className="magi-logotype">MAGI</span><span className="terminal-cursor" aria-hidden="true"/></h1><p className="episode-title" aria-label="超高智能即時決策系統"><span>超高智能</span><span>即時決策系統</span></p></div><div className="protocol"><span>THREE MINDS.</span><span>ONE DECISION.</span></div></div>
      <ProposalConsole initialValue={example} busy={busy} onChange={changeProposal} onSubmit={submit}/>
      <div className="board-frame">
        <div className={`decision-board ${busy?'board-active':''}`} aria-busy={busy}>
          <svg className="decision-circuits" viewBox="0 0 960 340" preserveAspectRatio="none" aria-hidden="true"><path d="M480 120V222M210 242H390L480 222L570 242H750"/><path className="circuit-secondary" d="M455 140V200L365 221H225M505 140V200L595 221H735"/><circle cx="480" cy="222" r="16"/><path d="M473 222h14M480 215v14"/></svg>
          {UNIT_IDS.map((id, i)=><DecisionUnit key={id} id={id} vote={!verdict ? undefined : 'invalid' in verdict ? 'error' : verdict.votes[id]} phase={phase} visible={visible>i}/>)}
        </div>
      </div>
      <section className={`consensus ${phase==='complete' ? approved?'consensus-yes':'consensus-no':''}`} aria-label="最終議決" aria-live="polite" aria-atomic="true">
        <span className="consensus-label">綜合判定<span>FINAL DECISION</span></span>
        <div className="consensus-result">{phase==='complete'?failed?<strong>錯誤</strong>:<><strong>{approved?'議案通過':'議案否決'}</strong><span>{yes} 票是 <i/> {3-yes} 票否</span></>:<><strong>{busy?'正在議決':'等待你的議案'}</strong><span>{busy?'三個人格正在形成各自的判斷':'兩個「是」，即可通過'}</span></>}</div>
        <span className="decision-stamp" aria-hidden="true">{phase==='complete'?(failed?'ERROR':approved?'ACCEPTED':'REJECTED'):'STANDBY'}</span>
      </section>
      {error && <p className="transmission-note transmission-error" role="status"><Radio size={13}/><span>{error}</span></p>}
    </div>
    <footer className="system-footer"><span>{host.footer ?? '娛樂性投票'}</span><a href="https://docs.typesafe.ai/primitives/noul" target="_blank" rel="noreferrer" onClick={openExternal}>POWERED BY JEV <ArrowUpRight size={12}/></a><button type="button" className="crt-toggle" aria-pressed={crtEnabled} onClick={()=>setCrtEnabled(value=>!value)}>CRT / {crtEnabled?'開啟':'關閉'}</button></footer>
    </main></div></div></div>
    <Dialog open={connectionOpen} onOpenChange={value=>{setConnectionOpen(value);if(!value){setQueued(false);setKeyDraft('');}}}>
      <DialogContent className={`connection-dialog ${crtEnabled?'dialog-crt':''}`}>
        <DialogHeader><span className="dialog-eyebrow"><Power size={15}/> SYSTEM CONNECTION</span><DialogTitle>{host.dialog?.title ?? '喚醒三個判斷單元'}</DialogTitle><DialogDescription>{host.dialog?.description ?? '填入 TypeSafe API Key。每次議決都會把你的需求發送給 Jev，從三個維度獨立投票。'}</DialogDescription></DialogHeader>
        {error && <p className="key-error" role="alert">{error}</p>}
        <label htmlFor="typesafe-key" className="key-label">TYPE SAFE / API KEY</label>
        <Input id="typesafe-key" type="password" autoComplete="off" spellCheck={false} maxLength={512} value={keyDraft} onChange={e=>{setKeyDraft(e.target.value);setError('');}} placeholder={host.dialog?.placeholder ?? (serverReady?'伺服器密鑰已就緒，可留空':'貼上你的 API Key')}/>
        <p className="key-note">{host.dialog?.note ?? (native ? 'Key 只保存在這台裝置上，只用於向 TypeSafe 發送議決。' : 'Key 僅在當前頁面記憶體中保留，重新載入即清除。議案與 Key 經本服務轉發至 TypeSafe，本服務不保存。')}</p>
        <Button className="activate-button" disabled={!keyDraft.trim()&&(host.dialog?.requireKey||!serverReady)} onClick={()=>{const key=keyDraft.trim();const run=queued;setApiKey(key);if(native&&key)void saveKey(key).catch(()=>{});setKeyDraft('');setVerified(false);setConnectionOpen(false);setQueued(false);setError('');if(run)void submit(key);}}>{queued?'使用此 Key 並開始議決':'使用此 Key'}<ArrowUpRight size={16}/></Button>
        {apiKey && <Button variant="ghost" className="clear-key-button" onClick={()=>{setApiKey('');if(native)void clearKey().catch(()=>{});setKeyDraft('');setVerified(false);setConnectionOpen(false);setQueued(false);setError('');}}>清除個人 Key</Button>}
        <a className="key-help" href="https://console.typesafe.ai/keys" target="_blank" rel="noreferrer" onClick={openExternal}>獲取自己的 TypeSafe API Key <ArrowUpRight size={12}/></a>
      </DialogContent>
    </Dialog>
  </div>;
}
