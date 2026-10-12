import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { AlertCircle, Check, ClipboardPaste, Copy, Download, Image as ImageIcon, LoaderCircle, ShieldCheck, Upload, X } from 'lucide-react';

type Code = { text: string; encoding: string; version: number; bounds: [number, number][] };
type Report = { source: string; width: number; height: number; preview: string | null; codes: Code[]; warning: string | null; error: string | null };
type Notice = { text: string; error?: boolean };

export function QrDecoder({ active }: { active: boolean }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const locked = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const desktop = isTauri();
  const total = reports.reduce((count, report) => count + report.codes.length, 0);

  const notify = useCallback((value: Notice) => {
    clearTimeout(noticeTimer.current);
    setNotice(value);
    noticeTimer.current = setTimeout(() => setNotice(null), value.error ? 8000 : 3500);
  }, []);

  useEffect(() => () => { clearTimeout(noticeTimer.current); clearTimeout(copyTimer.current); }, []);

  const decode = useCallback(async (command: string, args?: Record<string, unknown>) => {
    if (locked.current) return;
    if (!desktop) { notify({ text: '本地解码需在打包后的桌面程序中使用。', error: true }); return; }
    locked.current = true;
    setBusy(true);
    setNotice(null);
    setCopied(null);
    setDragging(false);
    try {
      const result = await invoke<Report[] | null>(command, args);
      // Cancelling the file picker keeps the previous results.
      if (result !== null) {
        setReports(result);
        const count = result.reduce((sum, report) => sum + report.codes.length, 0);
        if (count > 0) notify({ text: `已完成：${result.length} 张图片，识别 ${count} 个二维码` });
      }
    } catch (error) {
      setReports([]);
      notify({ text: String(error), error: true });
    } finally { locked.current = false; setBusy(false); }
  }, [desktop, notify]);

  useEffect(() => {
    if (!active) { setDragging(false); return; }
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
        event.preventDefault();
        void decode('decode_qr_clipboard');
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file || locked.current) return;
      event.preventDefault();
      if (file.size > 20 * 1024 * 1024) { notify({ text: '图片不能超过 20 MB。', error: true }); return; }
      // Native paste can provide encoded image bytes without an OS clipboard image.
      void file.arrayBuffer().then((buffer) => decode('decode_qr_bytes', { bytes: Array.from(new Uint8Array(buffer)), source: '粘贴图片' })).catch((error) => notify({ text: String(error), error: true }));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (desktop) {
      void getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (disposed || locked.current) return;
        if (event.payload.type === 'enter' || event.payload.type === 'over') setDragging(true);
        else {
          setDragging(false);
          if (event.payload.type === 'drop') void decode('decode_qr_paths', { paths: event.payload.paths });
        }
      }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((error) => notify({ text: `拖放不可用：${String(error)}，可使用选择图片。`, error: true }));
    }
    return () => { disposed = true; unlisten?.(); window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, [active, desktop, decode, notify]);

  async function copy(text: string, key: string) {
    if (locked.current) return;
    locked.current = true;
    try {
      await invoke('copy_qr_text', { text });
      setCopied(key);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
      notify({ text: '已复制到剪贴板' });
    } catch (error) { notify({ text: String(error), error: true }); }
    finally { locked.current = false; }
  }

  async function save() {
    if (locked.current || total === 0) return;
    locked.current = true;
    setBusy(true);
    const text = reports.filter((report) => report.codes.length).map((report) =>
      `${report.source}\r\n${report.codes.map((code, index) => `二维码 ${index + 1}（${code.encoding}）\r\n${code.text}`).join('\r\n\r\n')}`
    ).join('\r\n\r\n────────────\r\n\r\n');
    try {
      const path = await invoke<string | null>('save_qr_text', { text });
      if (path) notify({ text: `已保存：${path}` });
    } catch (error) { notify({ text: String(error), error: true }); }
    finally { locked.current = false; setBusy(false); }
  }

  function reset() { if (!locked.current) { setReports([]); setNotice(null); setCopied(null); } }

  return <main className="qr-shell" aria-busy={busy}>
    <header className="qr-header">
      <h2>二维码解码器</h2>
      <button className="qr-quiet" disabled={busy} onClick={() => void decode('decode_qr_clipboard')} title="复制图片或截图后，按 Ctrl+V"><ClipboardPaste size={15} />粘贴图片<span className="qr-shortcut">Ctrl+V</span></button>
    </header>
    <section className={`qr-zone${dragging ? ' is-dragging' : ''}${reports.length ? ' has-results' : ''}`} aria-label="图片解码" onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
      {busy && <div className="qr-loading" role="status"><LoaderCircle size={28} className="qr-spin" /><span>正在处理，请稍候…</span><small>图片在本机解码</small></div>}
      {!busy && reports.length === 0 && <button className="qr-upload" onClick={() => void decode('pick_qr_images')}>
        <Upload size={31} strokeWidth={1.7} />
        <strong>{dragging ? '松开鼠标，开始解码' : '图片解码'}</strong>
        <span>可拖拽、粘贴图片，支持一次选择多图批量解码</span>
        <small>PNG / JPG / WebP / BMP / GIF / TIFF / ICO</small>
      </button>}
      {!busy && reports.length > 0 && <div className={`qr-results${reports.length === 1 && total <= 1 ? ' is-single' : ''}`}>
        <div className="qr-result-heading">{total > 0 ? '解码结果' : '解码未完成'}{reports.length > 1 && <small>{reports.length} 张图片 · {total} 个二维码</small>}</div>
        <div className="qr-report-list">
          {reports.map((report, fileIndex) => <article className="qr-report" key={fileIndex}>
            <div className="qr-source" title={report.source}><ImageIcon size={13} /><span>{report.source}</span>{report.width > 0 && <small>{report.width} × {report.height}</small>}</div>
            {report.error && <div className="qr-file-error" role="alert"><AlertCircle size={17} /><span>{report.error}</span></div>}
            {report.codes.map((code, codeIndex) => {
              const key = `${fileIndex}-${codeIndex}`;
              return <div className="qr-code" key={codeIndex}>
                {(total > 1 || code.encoding !== 'UTF-8') && <div className="qr-code-meta">二维码 {codeIndex + 1} · {code.encoding}</div>}
                <div className="qr-content-row"><pre className="qr-content" tabIndex={0} aria-label={`二维码 ${codeIndex + 1} 内容`}>{code.text || '（空内容二维码）'}</pre><button className="qr-copy" disabled={busy} aria-label={`复制二维码 ${codeIndex + 1} 内容`} title="复制原始内容" onClick={() => void copy(code.text, key)}>{copied === key ? <Check size={16} /> : <Copy size={15} />}</button></div>
              </div>;
            })}
            {report.warning && <div className="qr-warning"><AlertCircle size={14} />{report.warning}</div>}
            {report.preview && <details className="qr-preview"><summary>查看原图{report.codes.length > 0 ? ` · QR 版本 ${report.codes.map((code) => code.version).join(' / ')}` : ''}</summary><img src={report.preview} alt={`${report.source} 预览`} /></details>}
          </article>)}
        </div>
        <div className="qr-actions">
          {total > 0 && <button className="qr-outline" onClick={() => void save()} disabled={busy}><Download size={14} />导出文本</button>}
          <button className="qr-primary" onClick={reset} disabled={busy}>继续解码</button>
        </div>
      </div>}
      {dragging && reports.length > 0 && <div className="qr-drop-overlay"><Upload size={30} />松开鼠标，解码新图片</div>}
    </section>
    <div className="qr-footnote"><span><ShieldCheck size={13} />本地解析 · 图片不上传</span><span>每次最多 32 张 · 单张 ≤ 20 MB</span></div>
    {notice && <div className={`qr-notice${notice.error ? ' is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <AlertCircle size={16} /> : <Check size={16} />}<span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={14} /></button></div>}
  </main>;
}
