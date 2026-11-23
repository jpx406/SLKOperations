import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { hasSig, type Sig } from '../../shared/jobLogForm';
import { Button, cx } from '../components/ui';

// A signature for the Job log (6z.51): drawn with a finger, a pen or the mouse, or the full name typed.

export function SignaturePad({ value, onChange, by, disabled, label = 'Signature' }: { value: Sig | null; onChange: (v: Sig | null) => void; by: string; disabled?: boolean; label?: string }) {
  const [mode, setMode] = useState<null | 'draw' | 'type'>(null);
  const [typed, setTyped] = useState(value?.text ?? '');
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false), dirty = useRef(false);

  useEffect(() => {
    if (mode !== 'draw' || !canvas.current) return;
    const c = canvas.current, dpr = window.devicePixelRatio || 1, r = c.getBoundingClientRect();
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, r.width, r.height);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#102040';
  }, [mode]);

  const at = (e: PointerEvent<HTMLCanvasElement>) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: PointerEvent<HTMLCanvasElement>) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const ctx = canvas.current!.getContext('2d')!; const p = at(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e: PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const ctx = canvas.current!.getContext('2d')!; const p = at(e); ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true; };
  const up = () => { drawing.current = false; };
  const acceptDrawn = () => { if (!dirty.current) return; onChange({ img: canvas.current!.toDataURL('image/png'), text: null, by, at: new Date().toISOString() }); setMode(null); dirty.current = false; };
  const acceptTyped = () => { if (!typed.trim()) return; onChange({ img: null, text: typed.trim(), by, at: new Date().toISOString() }); setMode(null); };

  return (
    <div>
      <p className="mb-1 font-mono text-label font-semibold tracking-wide text-text-muted uppercase">{label}</p>
      <div className={cx('flex min-h-24 items-center justify-center overflow-hidden rounded-md border border-border bg-white')}>
        {mode === 'draw' ? (
          <canvas ref={canvas} aria-label="Draw the signature here" className="h-32 w-full cursor-crosshair touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        ) : mode === 'type' ? (
          <input autoFocus aria-label="Full name" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && acceptTyped()}
            placeholder="Type the full name" className="w-[90%] border-0 bg-transparent p-2 font-serif text-2xl text-[#102040] italic outline-none" />
        ) : hasSig(value) ? (
          value!.img ? <img src={value!.img} alt="Signature" className="max-h-28 max-w-full" /> : <span className="font-serif text-3xl text-[#102040] italic">{value!.text}</span>
        ) : <span className="text-sm text-[#6b7480]">Not signed yet</span>}
      </div>
      {hasSig(value) && !mode && <p className="mt-1 text-xs text-text-subtle">Signed{value!.by ? ` by ${value!.by}` : ''}{value!.at ? ` · ${new Date(value!.at).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {mode === 'draw' ? <>
          <Button size="sm" variant="primary" onClick={acceptDrawn}>Use signature</Button><Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
        </> : mode === 'type' ? <>
          <Button size="sm" variant="primary" onClick={acceptTyped}>Use name</Button><Button size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
        </> : <>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setMode('draw')}>Draw</Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setMode('type')}>Type name</Button>
          <Button size="sm" variant="ghost" disabled={disabled || !hasSig(value)} onClick={() => { onChange(null); setTyped(''); }}>Clear</Button>
        </>}
      </div>
    </div>
  );
}
