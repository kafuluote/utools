import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeftRight, ChevronDown, RefreshCw, Settings, X } from 'lucide-react';
import { convertAmount, getRate, isValidAmount, type Side } from './conversion';
import './styles.css';
import { QrDecoder } from './QrDecoder';
import { JsonParser } from './JsonParser';
import { UnixTimeConverter } from './UnixTimeConverter';
import { UpdateChecker } from './UpdateChecker';
import './tools.css';

type Provider = 'open' | 'exchangerate' | 'fixer' | 'currencyapi';
type Config = { provider: Provider; apiKey: string };
const currencies = [
  { code: 'USD', name: '美元' }, { code: 'CNY', name: '人民币' },
  { code: 'EUR', name: '欧元' }, { code: 'JPY', name: '日元' },
  { code: 'GBP', name: '英镑' }, { code: 'HKD', name: '港币' },
  { code: 'KRW', name: '韩元' }, { code: 'AUD', name: '澳元' },
  { code: 'CAD', name: '加元' }, { code: 'SGD', name: '新加坡元' },
];
const defaults: Record<string, number> = { USD: 1, CNY: 6.6922, EUR: 0.92, JPY: 157.2, GBP: 0.78, HKD: 7.78, KRW: 1380, AUD: 1.53, CAD: 1.37, SGD: 1.35 };
const providerNames: Record<Provider, string> = { open: 'ExchangeRate-API 开放接口', exchangerate: 'ExchangeRate-API', fixer: 'Fixer.io', currencyapi: 'CurrencyAPI' };
const currency = (code: string) => currencies.find((item) => item.code === code) ?? currencies[0];

function loadConfig(): Config {
  try {
    const provider = localStorage.getItem('provider') as Provider;
    return { provider: provider in providerNames ? provider : 'open', apiKey: localStorage.getItem('apiKey') || '' };
  } catch { return { provider: 'open', apiKey: '' }; }
}

function App() {
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('CNY');
  const [input, setInput] = useState({ side: 'left' as Side, value: '1' });
  const [quote, setQuote] = useState({ rates: defaults, updatedAt: '', provider: 'open' as Provider });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [draft, setDraft] = useState(config);
  const liveRate = getRate(quote.rates, from, to);
  const rate = liveRate ?? getRate(defaults, from, to)!;
  const isExample = from !== to && (!quote.updatedAt || liveRate === undefined);
  const fromInfo = currency(from);
  const toInfo = currency(to);
  const amounts = useMemo(() => {
    const converted = convertAmount(input.value, rate, input.side);
    return input.side === 'left' ? { left: input.value, right: converted } : { left: converted, right: input.value };
  }, [input, rate]);

  function editAmount(side: Side, value: string) {
    if (isValidAmount(value)) setInput({ side, value });
  }

  async function refresh() {
    if (loading) return;
    setError('');
    if (from === to) return;
    setLoading(true);
    try {
      const key = encodeURIComponent(config.apiKey.trim());
      if (config.provider !== 'open' && !key) throw new Error('请先在设置中填写 API 密钥');
      let url: string;
      if (config.provider === 'open') url = `https://open.er-api.com/v6/latest/${from}`;
      else if (config.provider === 'exchangerate') url = `https://v6.exchangerate-api.com/v6/${key}/latest/${from}`;
      else if (config.provider === 'fixer') url = `https://data.fixer.io/api/latest?access_key=${key}&base=EUR&symbols=${from},${to}`;
      else url = `https://api.currencyapi.com/v3/latest?apikey=${key}&base_currency=${from}&currencies=${to}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`接口请求失败（HTTP ${response.status}）`);
      const data = await response.json();
      let rates: Record<string, number>;
      if (config.provider === 'open') {
        if (data.result !== 'success') throw new Error(data['error-type'] || '汇率请求失败');
        rates = { ...data.rates, [from]: 1 };
      } else if (config.provider === 'exchangerate') {
        if (data.result !== 'success') throw new Error(data['error-type'] || 'ExchangeRate-API 请求失败');
        rates = { ...data.conversion_rates, [from]: 1 };
      } else if (config.provider === 'fixer') {
        if (!data.success) throw new Error(data.error?.info || 'Fixer 请求失败');
        rates = { ...data.rates, EUR: 1 };
      } else {
        if (!data.data) throw new Error('CurrencyAPI 没有返回汇率');
        rates = { [from]: 1, [to]: Number(data.data[to]?.value) };
      }
      if (getRate(rates, from, to) === undefined) throw new Error('接口没有返回有效汇率');
      setQuote({ rates, updatedAt: new Date().toLocaleString('zh-CN'), provider: config.provider });
    } catch (err) {
      setError(err instanceof Error && err.name === 'TimeoutError' ? '请求超时，请稍后重试' : err instanceof Error ? err.message : '刷新失败');
    } finally { setLoading(false); }
  }

  function swap() {
    setFrom(to);
    setTo(from);
    setInput({ side: input.side === 'left' ? 'right' : 'left', value: input.value });
    setError('');
  }

  function saveSettings() {
    try {
      const saved = { ...draft, apiKey: draft.apiKey.trim() };
      localStorage.setItem('provider', saved.provider);
      localStorage.setItem('apiKey', saved.apiKey);
      setConfig(saved);
      setSettingsOpen(false);
      setError('');
    } catch { setError('无法保存配置，请检查本地存储权限'); }
  }

  return <main className="app-shell">
    <header className="topbar">
      <h1>汇率换算</h1>
      <div className="toolbar">
        <button className="refresh-button" onClick={refresh} disabled={loading || from === to} title="仅点击时请求最新汇率"><RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? '刷新中' : '刷新汇率'}</button>
        <button className="icon-button" aria-label="API 配置" title="API 密钥配置" onClick={() => { setDraft(config); setSettingsOpen(true); }}><Settings size={17} /></button>
      </div>
    </header>
    <section aria-label="双向汇率" className="rate-lines" aria-live="polite">
      <div>1 {fromInfo.name} ≈ {rate.toFixed(4)} {toInfo.name}</div>
      <div>1 {toInfo.name} ≈ {(1 / rate).toFixed(4)} {fromInfo.name}</div>
    </section>
    <section className="converter-row" aria-label="双向金额换算">
      <CurrencyAmount side="left" code={from} amount={amounts.left} onCurrency={(code) => { setFrom(code); setError(''); }} onAmount={editAmount} disabled={loading} />
      <button className="swap-button" disabled={loading} onClick={swap} aria-label="交换货币" title="交换两侧货币与金额"><ArrowLeftRight size={18} /></button>
      <CurrencyAmount side="right" code={to} amount={amounts.right} onCurrency={(code) => { setTo(code); setError(''); }} onAmount={editAmount} disabled={loading} />
    </section>
    <footer aria-live="polite">{from === to ? '相同货币，汇率为 1' : isExample ? '示例汇率 · 点击刷新获取最新数据' : `更新于 ${quote.updatedAt} · ${providerNames[quote.provider]}`}<span>两侧金额均可输入</span></footer>
    {error && <div className="error" role="alert">{error}</div>}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSettingsOpen(false)}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="config-title" onKeyDown={(e) => e.key === 'Escape' && setSettingsOpen(false)}>
        <div className="modal-title"><h2 id="config-title">API 密钥配置</h2><button className="icon-button" aria-label="关闭配置" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
        <p className="modal-help">选择开放接口可免密钥使用。保存后，点击刷新汇率获取数据。</p>
        <label className="form-label" htmlFor="provider">汇率服务</label>
        <select id="provider" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value as Provider })} autoFocus>
          <option value="open">开放接口（无需密钥）</option><option value="exchangerate">ExchangeRate-API</option><option value="fixer">Fixer.io</option><option value="currencyapi">CurrencyAPI</option>
        </select>
        <label className="form-label" htmlFor="api-key">API 密钥</label>
        <input id="api-key" className="text-input" type="password" value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="请输入 API Key" />
        <div className="modal-actions"><button className="cancel" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary" onClick={saveSettings}>保存配置</button></div>
      </section>
    </div>}
  </main>;
}

function CurrencyAmount({ side, code, amount, onCurrency, onAmount, disabled }: {
  side: Side; code: string; amount: string; onCurrency: (code: string) => void;
  onAmount: (side: Side, value: string) => void; disabled: boolean;
}) {
  const item = currency(code);
  const position = side === 'left' ? '左侧' : '右侧';
  return <div className="currency-amount">
    <div className="currency-selector">
      <select aria-label={`${position}货币`} value={code} onChange={(e) => onCurrency(e.target.value)} disabled={disabled}>
        {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
      <div className="currency-display" aria-hidden="true"><Flag code={code} /><span><b>{item.code}</b><small>{item.name}</small></span><ChevronDown size={16} /></div>
    </div>
    <input className="amount-input" aria-label={`${position}金额`} title={`${item.name}金额`} value={amount} onChange={(e) => onAmount(side, e.target.value)} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0" />
  </div>;
}

// Use SVG for the reference flags: Windows does not display flag emoji.
function Flag({ code }: { code: string }) {
  if (code === 'USD') return <svg className="flag" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff" />{Array.from({ length: 7 }, (_, i) => <rect key={i} y={i * 3.08} width="30" height="1.54" fill="#bd2040" />)}<rect width="13" height="10.8" fill="#244581" />{Array.from({ length: 20 }, (_, i) => <circle key={i} cx={1.6 + (i % 5) * 2.45} cy={1.7 + Math.floor(i / 5) * 2.4} r=".55" fill="#fff" />)}</svg>;
  if (code === 'CNY') return <svg className="flag" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#ee1c25" /><path d="m6 3 .8 2.4h2.5l-2 1.5.8 2.4L6 7.8 3.9 9.3l.8-2.4-2-1.5h2.5Z" fill="#ffde00" />{[[11, 3], [13, 5], [13, 8], [11, 10]].map(([x, y]) => <path key={`${x}-${y}`} d="m0-1 .3.7h.8l-.6.5.2.8L0 .5l-.7.5.2-.8-.6-.5h.8Z" transform={`translate(${x} ${y})`} fill="#ffde00" />)}</svg>;
  if (code === 'JPY') return <svg className="flag" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="6" fill="#bc002d" /></svg>;
  if (code === 'EUR') return <svg className="flag" viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#003399" />{Array.from({ length: 12 }, (_, i) => <circle key={i} cx={15 + 6 * Math.cos(i * Math.PI / 6)} cy={10 + 6 * Math.sin(i * Math.PI / 6)} r=".8" fill="#ffcc00" />)}</svg>;
  return <span className="flag fallback-flag" aria-hidden="true">{code.slice(0, 2)}</span>;
}

type ToolTab = 'exchange' | 'qr' | 'json' | 'unix';
const toolTabs: ToolTab[] = ['exchange', 'qr', 'json', 'unix'];
const lastTabKey = 'exchangetools.lastTab';

function loadLastTab(): ToolTab {
  try {
    const saved = localStorage.getItem(lastTabKey);
    return toolTabs.includes(saved as ToolTab) ? saved as ToolTab : 'exchange';
  } catch { return 'exchange'; }
}

function ToolsApp() {
  const [tab, setTab] = useState<ToolTab>(loadLastTab);
  function selectTab(next: ToolTab, focus = false) {
    setTab(next);
    try { localStorage.setItem(lastTabKey, next); } catch { /* Keep switching usable when storage is unavailable. */ }
    if (focus) document.getElementById(`tab-${next}`)?.focus();
  }
  return <div className="tools-app" data-active={tab}>
    <nav className="tool-tabs" role="tablist" aria-label="工具选项卡" onKeyDown={(event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        selectTab(event.key === 'Home' ? toolTabs[0] : event.key === 'End' ? toolTabs[toolTabs.length - 1] : toolTabs[(toolTabs.indexOf(tab) + direction + toolTabs.length) % toolTabs.length], true);
      }
    }}>
      <button id="tab-exchange" role="tab" aria-controls="panel-exchange" aria-selected={tab === 'exchange'} tabIndex={tab === 'exchange' ? 0 : -1} onClick={() => selectTab('exchange')}>汇率换算</button>
      <button id="tab-qr" role="tab" aria-controls="panel-qr" aria-selected={tab === 'qr'} tabIndex={tab === 'qr' ? 0 : -1} onClick={() => selectTab('qr')}>本地二维码</button>
      <button id="tab-json" role="tab" aria-controls="panel-json" aria-selected={tab === 'json'} tabIndex={tab === 'json' ? 0 : -1} onClick={() => selectTab('json')}>JSON 解析器</button>
      <button id="tab-unix" role="tab" aria-controls="panel-unix" aria-selected={tab === 'unix'} tabIndex={tab === 'unix' ? 0 : -1} onClick={() => selectTab('unix')}>Unix 时间转换</button>
      <span className="tool-caption">实用工具</span>
    </nav>
    <UpdateChecker />
    <section id="panel-exchange" role="tabpanel" aria-labelledby="tab-exchange" hidden={tab !== 'exchange'}><App /></section>
    <section id="panel-qr" role="tabpanel" aria-labelledby="tab-qr" hidden={tab !== 'qr'}><QrDecoder active={tab === 'qr'} /></section>
    <section id="panel-json" role="tabpanel" aria-labelledby="tab-json" hidden={tab !== 'json'}><JsonParser active={tab === 'json'} /></section>
    <section id="panel-unix" role="tabpanel" aria-labelledby="tab-unix" hidden={tab !== 'unix'}><UnixTimeConverter active={tab === 'unix'} /></section>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ToolsApp /></React.StrictMode>);
