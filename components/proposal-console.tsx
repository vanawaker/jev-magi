'use client';

import { memo, useState } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  initialValue: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export const ProposalConsole = memo(function ProposalConsole({ initialValue, busy, onChange, onSubmit }: Props) {
  // Keystrokes stay in the editor; the three units do not re-render for each letter.
  const [value, setValue] = useState(initialValue);
  // The opening example is only a demo: touching the editor clears it so typing starts fresh.
  const [example, setExample] = useState(true);
  const placeholder = '請輸入你需要抉擇的問題';
  return <form className="proposal-console" onSubmit={event => {
    event.preventDefault();
    if (busy || !value.trim()) return;
    event.currentTarget.querySelector('textarea')?.blur();
    onSubmit();
  }}>
    <div className="input-label"><label htmlFor="proposal"><span>magi@terminal:~$</span> 輸入議案</label><span>自由輸入 · 三方獨立判斷</span></div>
    <div className="proposal-input">
      <span className="input-prompt" aria-hidden="true">&gt;</span>
      <div className="proposal-editor">
        {/* Native wrapping sizes one or two lines without reading layout during input. */}
        <div className="proposal-mirror" aria-hidden="true">{(value || placeholder) + '\u200b'}</div>
        <Textarea id="proposal" rows={1} placeholder={placeholder} value={value} maxLength={1200} disabled={busy}
          onFocus={() => { if (example) { setExample(false); setValue(''); onChange(''); } }}
          onChange={event => { setValue(event.target.value); onChange(event.target.value); }}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (!busy) event.currentTarget.form?.requestSubmit();
            }
          }}/>
      </div>
      <Button type="submit" className="submit-button" aria-label={busy ? '議決中' : '開始議決'} disabled={busy || !value.trim()}>
        {busy ? <LoaderCircle className="spin" size={17}/> : <ArrowUpRight size={19}/>}<span>{busy ? '議決中' : '開始議決'}</span>
      </Button>
    </div>
  </form>;
});
