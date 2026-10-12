import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { AlertCircle, Braces, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download, FileUp, ListOrdered, Maximize, Minimize, Moon, Sun, Trash2, WrapText, X } from 'lucide-react';
import { containerPositions, formatJson, JsonParseError, jsonRows, jsonToken, parseJson, replaceJsonValue, type JsonNode } from './json';
import './json.css';

const sample = '{\n  "name": "实用工具",\n  "version": "0.3.0",\n  "enabled": true,\n  "tools": ["汇率换算", "本地二维码", "JSON 解析器"],\n  "settings": {\n    "theme": "light",\n    "timeout": 30,\n    "note": null\n  }\n}';

export function JsonParser({ active }: { active: boolean }) {
  const [source, setSource] = useState('');
  const [preserveEscapes, setPreserveEscapes] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [dark, setDark] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ node: JsonNode; value: string; error: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);
  const locked = useRef(false);
  const parsed = useMemo(() => {
    if (/^[\x20\t\r\n]*$/.test(source)) return { root: null, error: null };
    try { return { root: parseJson(source), error: null }; }
    catch (error) { return { root: null, error: error instanceof Error ? error : new Error(String(error)) }; }
  }, [source]);
  const output = useMemo(() => parsed.root ? formatJson(parsed.root, { preserveEscapes }) : '', [parsed.root, preserveEscapes]);
  const view = useMemo(() => parsed.root ? jsonRows(parsed.root, collapsed) : { rows: [], truncated: false }, [parsed.root, collapsed]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!active) { setExpanded(false); return; }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpanded(false); setEditing(null); } };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active]);

  function changeSource(value: string) {
    fileVersion.current++;
    setSource(value);
    setCollapsed(new Set());
    setEditing(null);
    setNotice('');
  }
  function toggle(node: JsonNode) {
    setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.start)) next.delete(node.start); else next.add(node.start); return next; });
  }
  function format(compact: boolean) {
    if (parsed.root) changeSource(formatJson(parsed.root, { compact, preserveEscapes }));
  }
  function commitEdit() {
    if (!editing) return;
    try { changeSource(replaceJsonValue(source, editing.node, editing.value)); }
    catch (error) { setEditing({ ...editing, error: error instanceof Error ? error.message : String(error) }); }
  }
  async function copy() {
    if (!output || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (isTauri()) await invoke('copy_json_text', { text: output });
      else await navigator.clipboard.writeText(output);
      setNotice('已复制完整 JSON');
    } catch (error) { setNotice(`复制失败：${String(error)}`); }
    finally { locked.current = false; setBusy(false); }
  }
  async function save() {
    if (!output || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (isTauri()) {
        const path = await invoke<string | null>('save_json_text', { text: output });
        if (path) setNotice(`已保存：${path}`);
      } else {
        const url = URL.createObjectURL(new Blob([output], { type: 'application/json;charset=utf-8' }));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = '解析结果.json'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice('已导出完整 JSON');
      }
    } catch (error) { setNotice(`导出失败：${String(error)}`); }
    finally { locked.current = false; setBusy(false); }
  }
  async function loadFile(file: File | undefined) {
    if (!file) return;
    const version = ++fileVersion.current;
    try {
      if (file.size > 3_000_000) throw new Error('文件不能超过 3 MB');
      const text = await file.text();
      if (version !== fileVersion.current) return;
      changeSource(text.replace(/^\uFEFF/, ''));
    } catch (error) { if (version === fileVersion.current) setNotice(`导入失败：${String(error)}`); }
  }
  const actionDisabled = !parsed.root || busy;
  const iconButton = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false, pressed?: boolean) =>
    <button type="button" className="json-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>{icon}</button>;

  return <main className={`json-shell${dark ? ' json-dark' : ''}${expanded ? ' json-expanded' : ''}`} aria-label="JSON 解析器">
    <div className="json-workspace">
      <section className="json-input-pane" aria-label="JSON 输入区">
        <textarea ref={inputRef} className="json-input" aria-label="JSON 输入" placeholder="请输入json数据..." value={source} maxLength={1_000_000} onChange={(event) => changeSource(event.target.value)} spellCheck={false} autoComplete="off" onKeyDown={(event) => {
          if (event.key === 'Tab' && !event.shiftKey) {
            event.preventDefault();
            const start = event.currentTarget.selectionStart;
            const end = event.currentTarget.selectionEnd;
            if (source.length - (end - start) + 2 > 1_000_000) return;
            changeSource(source.slice(0, start) + '  ' + source.slice(end));
            requestAnimationFrame(() => inputRef.current?.setSelectionRange(start + 2, start + 2));
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); format(false); }
        }} />
        <div className="json-input-status"><span>{source.length.toLocaleString()} 字符</span><span>Ctrl+Enter 格式化</span></div>
      </section>
      <section className="json-output-pane" aria-label="JSON 解析结果">
        <div className="json-toolbar" role="toolbar" aria-label="JSON 工具栏">
          <div className="json-toolbar-group">
            {iconButton('格式化', <Braces size={16} />, () => format(false), actionDisabled)}
            {iconButton('压缩', <WrapText size={16} />, () => format(true), actionDisabled)}
            {iconButton('显示行号', <ListOrdered size={16} />, () => setLineNumbers(!lineNumbers), false, lineNumbers)}
            {iconButton('清空', <Trash2 size={16} />, () => { changeSource(''); inputRef.current?.focus(); }, !source || busy)}
            {iconButton('导入 JSON 文件', <FileUp size={16} />, () => fileRef.current?.click(), busy)}
            {iconButton('导出 JSON', <Download size={16} />, () => void save(), actionDisabled)}
            {iconButton('复制 JSON', <Copy size={16} />, () => void copy(), actionDisabled)}
            {iconButton('折叠全部', <ChevronsDownUp size={16} />, () => { if (parsed.root) setCollapsed(new Set(containerPositions(parsed.root))); }, actionDisabled)}
            {iconButton('展开全部', <ChevronsUpDown size={16} />, () => setCollapsed(new Set()), actionDisabled)}
            {iconButton(dark ? '浅色主题' : '深色主题', dark ? <Sun size={16} /> : <Moon size={16} />, () => setDark(!dark))}
          </div>
          <label className="json-escape"><input type="checkbox" checked={preserveEscapes} onChange={(event) => setPreserveEscapes(event.target.checked)} />保留转义</label>
          <div className="json-toolbar-end"><button className="json-sample" onClick={() => changeSource(sample)} disabled={busy}>示例数据</button>{iconButton(expanded ? '退出全屏' : '全屏编辑', expanded ? <Minimize size={16} /> : <Maximize size={16} />, () => setExpanded(!expanded))}</div>
        </div>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(event) => { void loadFile(event.target.files?.[0]); event.target.value = ''; }} />
        <div className="json-result-status" aria-live="polite">{parsed.error ? <span className="json-invalid"><AlertCircle size={13} />解析失败</span> : parsed.root ? <span className="json-valid"><Check size={13} />有效 JSON</span> : <span>等待输入</span>}<span>点击值可编辑</span></div>
        {parsed.error && <div className="json-parse-error" role="alert"><span>{parsed.error.message}</span>{parsed.error instanceof JsonParseError && <button onClick={() => { const position = (parsed.error as JsonParseError).position; inputRef.current?.focus(); inputRef.current?.setSelectionRange(position, position + 1); }}>定位错误</button>}</div>}
        <div className="json-code" tabIndex={0} aria-label="格式化 JSON 结果">
          {view.rows.map((row, index) => {
            const { node } = row;
            const container = node.type === 'object' || node.type === 'array';
            const open = node.type === 'object' ? '{' : '[';
            const close = node.type === 'object' ? '}' : ']';
            return <div className="json-line" key={`${node.start}-${row.closing ? 'end' : 'start'}`}>
              {lineNumbers && <span className="json-line-number" aria-hidden="true">{index + 1}</span>}
              <div className="json-line-body" style={{ paddingLeft: row.depth * 18 }}>
                <span className="json-fold-slot">{container && node.children.length > 0 && !row.closing && <button aria-label={row.folded ? '展开节点' : '折叠节点'} aria-expanded={!row.folded} onClick={() => toggle(node)}>{row.folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>}</span>
                {row.key && <><span className="json-key">{jsonToken(row.key, preserveEscapes)}</span><span>: </span></>}
                {row.closing ? close : container ? <>{open}{row.folded ? <><button className="json-fold-summary" onClick={() => toggle(node)} title="展开节点">… {node.children.length} 项</button>{close}</> : !node.children.length ? close : ''}</> : editing?.node.start === node.start ?
                  <span className="json-edit"><input autoFocus aria-label="编辑 JSON 值" value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value, error: '' })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitEdit(); } else if (event.key === 'Escape') setEditing(null); }} /><button aria-label="保存值" onClick={commitEdit}><Check size={14} /></button><button aria-label="取消编辑" onClick={() => setEditing(null)}><X size={14} /></button>{editing.error && <span className="json-edit-error" role="alert">{editing.error}</span>}</span> :
                  <button className={`json-value json-${node.type}`} title="点击编辑值，字符串需保留双引号" onClick={() => setEditing({ node, value: jsonToken(node, preserveEscapes), error: '' })}>{jsonToken(node, preserveEscapes)}</button>}
                {row.comma && ','}
              </div>
            </div>;
          })}
          {view.truncated && <div className="json-truncated">仅显示前 3000 行，可折叠节点查看。复制和导出包含完整数据。</div>}
        </div>
        <div className="json-output-status"><span>本地解析 · 数据不上传</span><span>{parsed.root ? `${view.rows.length.toLocaleString()} 行` : 'JSON'}</span></div>
      </section>
    </div>
    {notice && <div className="json-notice" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </main>;
}
