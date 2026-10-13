import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { AlertCircle, Check, Copy, Download, LoaderCircle, QrCode, ShieldCheck, Trash2 } from 'lucide-react';
import './qr-generator.css';

type Parameters = { text: string; size: number; correction: string };
type Generated = { preview: string; size: number; bytes: number; version: number; pixelsPerModule: number; parameters: Parameters };

export function QrGenerator({ active }: { active: boolean }) {
  const [text, setText] = useState('');
  const [size, setSize] = useState(512);
  const [correction, setCorrection] = useState('M');
  const [result, setResult] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const bytes = new TextEncoder().encode(text).length;

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);

  function invalidate() { setResult(null); setError(''); setNotice(''); }

  async function generate() {
    if (locked.current || !text.trim() || bytes > 2953) return;
    if (!isTauri()) { setError('请在桌面程序中使用本地二维码生成。'); return; }
    locked.current = true;
    setBusy(true);
    invalidate();
    const parameters = { text, size, correction };
    try {
      const image = await invoke<Omit<Generated, 'parameters'>>('generate_qr', parameters);
      setResult({ ...image, parameters });
    } catch (error) { setError(String(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  async function exportImage(copy: boolean) {
    if (!result || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (copy) {
        await invoke('copy_generated_qr', result.parameters);
        setNotice('二维码图片已复制，可直接粘贴到本地二维码解码器或其他应用。');
      } else {
        const path = await invoke<string | null>('save_generated_qr', result.parameters);
        if (path) setNotice(`已保存：${path}`);
      }
    } catch (error) { setError(String(error)); }
    finally { locked.current = false; setBusy(false); }
  }

  return <main className="qrg-shell" aria-label="二维码生成器" aria-busy={busy}>
    <header className="qrg-header"><h2>二维码生成器</h2><span><ShieldCheck size={13} />本地生成 · 内容不上传</span></header>
    <div className="qrg-layout">
      <section className="qrg-form" aria-label="生成内容与设置">
        <label htmlFor="qrg-text">文本或网址</label>
        <textarea id="qrg-text" value={text} disabled={busy} spellCheck={false} placeholder="输入文本、网址或多行内容…" onChange={(event) => { setText(event.target.value); invalidate(); }} onKeyDown={(event) => {
          if (active && event.ctrlKey && event.key === 'Enter') { event.preventDefault(); void generate(); }
        }} />
        <div className={`qrg-counter${bytes > 2953 ? ' over-limit' : ''}`} aria-live="polite"><span>保留原始内容和换行</span><span>{bytes} / 2953 字节</span></div>
        {bytes > 2953 && <div className="qrg-error" role="alert">内容过长，请缩短至 2953 个 UTF-8 字节以内。</div>}
        <div className="qrg-settings">
          <label htmlFor="qrg-size">图片尺寸<select id="qrg-size" value={size} disabled={busy} onChange={(event) => { setSize(Number(event.target.value)); invalidate(); }}><option value={256}>256 × 256</option><option value={512}>512 × 512</option><option value={1024}>1024 × 1024</option></select></label>
          <label htmlFor="qrg-correction">纠错级别<select id="qrg-correction" value={correction} disabled={busy} onChange={(event) => { setCorrection(event.target.value); invalidate(); }}><option value="L">L · 低</option><option value="M">M · 中（推荐）</option><option value="Q">Q · 较高</option><option value="H">H · 高</option></select></label>
        </div>
        <p className="qrg-help">纠错越高，可容纳的内容越少。内容较多时建议选择较大的图片尺寸。</p>
        <div className="qrg-form-actions"><button className="qr-primary" disabled={busy || !text.trim() || bytes > 2953} onClick={() => void generate()}>{busy ? <LoaderCircle size={14} className="qr-spin" /> : <QrCode size={15} />}生成二维码</button><button className="qrg-clear" disabled={busy || !text} onClick={() => { setText(''); invalidate(); }}><Trash2 size={14} />清空</button><small>Ctrl+Enter</small></div>
      </section>
      <section className="qrg-preview" aria-label="二维码预览">
        {result ? <>
          <img src={result.preview} alt="已生成的二维码" width={result.size} height={result.size} />
          <div className="qrg-image-meta">{result.size} × {result.size} px · PNG · QR 版本 {result.version}</div>
          {result.pixelsPerModule < 3 && <div className="qrg-density">二维码较密集，建议使用 512 或 1024 像素。</div>}
          <div className="qrg-export-actions"><button className="qr-outline" disabled={busy} onClick={() => void exportImage(true)}><Copy size={14} />复制图片</button><button className="qr-primary" disabled={busy} onClick={() => void exportImage(false)}><Download size={14} />保存 PNG</button></div>
        </> : <div className="qrg-empty"><QrCode size={48} strokeWidth={1.2} /><strong>二维码预览</strong><span>输入内容后点击“生成二维码”</span></div>}
      </section>
    </div>
    {error && <div className="qrg-error" role="alert"><AlertCircle size={16} />{error}</div>}
    {notice && <div className="qrg-notice" role="status"><Check size={16} />{notice}</div>}
  </main>;
}
