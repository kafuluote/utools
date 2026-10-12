import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Download, RefreshCw, X } from 'lucide-react';
import { version } from '../package.json';
import './updates.css';

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  downloadUrl: string;
  releaseUrl: string;
  notes: string;
};

// Share the startup request across React StrictMode's effect remounts.
let startupCheck: Promise<UpdateInfo> | undefined;

export function UpdateChecker() {
  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    locked.current = true;
    setChecking(true);
    startupCheck ??= invoke<UpdateInfo>('check_app_update');
    startupCheck.then((result) => {
      if (active) { setUpdate(result); setVisible(result.available); }
    }).catch(() => { /* Startup failures stay quiet; manual checks report errors. */ })
      .finally(() => { if (active) { locked.current = false; setChecking(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!visible) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    return () => { (returnFocus.current ?? button.current)?.focus(); };
  }, [visible]);

  async function check() {
    if (locked.current) return;
    if (!isTauri()) { setMessage('请在桌面程序中检查软件更新。'); return; }
    locked.current = true;
    setChecking(true);
    setMessage('');
    try {
      const result = await invoke<UpdateInfo>('check_app_update');
      setUpdate(result);
      setVisible(result.available);
      if (!result.available) setMessage(result.latestVersion ? `当前版本 v${result.currentVersion} 已是最新版本。` : '仓库暂无可用的正式发布版。');
    } catch (error) { setMessage(String(error)); }
    finally { locked.current = false; setChecking(false); }
  }

  async function download(url: string) {
    if (opening) return;
    setOpening(true);
    setMessage('');
    try { await invoke('open_update_download', { url }); }
    catch (error) { setMessage(String(error)); }
    finally { setOpening(false); }
  }

  return <>
    <div className="update-toolbar">
      <span>v{update?.currentVersion ?? version}</span>
      <button ref={button} onClick={check} disabled={checking} title="检查 GitHub 最新正式发布版">
        <RefreshCw size={13} className={checking ? 'spin' : ''} />{checking ? '检查中' : '检查更新'}
      </button>
      {update?.available && <button className="update-available" onClick={() => { setMessage(''); setVisible(true); }}><Download size={13} />新版本 v{update.latestVersion}</button>}
      {message && !visible && <div className="update-notice" role="status"><span>{message}</span><button aria-label="关闭更新提示" onClick={() => setMessage('')}><X size={14} /></button></div>}
    </div>
    {visible && update?.available && <div className="modal-backdrop update-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setVisible(false); }}>
      <section ref={dialog} className="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title" onKeyDown={(event) => {
        if (event.key === 'Escape') setVisible(false);
        if (event.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="modal-title"><h2 id="update-title">发现新版本 v{update.latestVersion}</h2><button ref={closeButton} className="icon-button" aria-label="关闭更新提示" onClick={() => setVisible(false)}><X size={18} /></button></div>
        <p className="modal-help">当前版本 v{update.currentVersion}。点击下载会打开浏览器，下载完成后请关闭本软件并运行安装包，或解压便携版使用。</p>
        {update.notes && <pre className="update-notes">{update.notes}</pre>}
        {message && <div className="error" role="alert">{message}</div>}
        <div className="modal-actions">
          <button className="cancel" onClick={() => setVisible(false)}>稍后</button>
          {update.downloadUrl !== update.releaseUrl && <button className="cancel" disabled={opening} onClick={() => download(update.releaseUrl)}>发布说明</button>}
          <button className="primary" disabled={opening} onClick={() => download(update.downloadUrl)}>{opening ? '打开中…' : '前往下载'}</button>
        </div>
      </section>
    </div>}
  </>;
}
