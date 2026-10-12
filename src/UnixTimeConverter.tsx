import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { CalendarClock, Check, Copy, X } from 'lucide-react';
import { beijingToTimestamp, compactBeijing, currentTimestamp, getBeijingParts, quickBeijingToTimestamp, timestampToBeijing, type BeijingDateParts, type TimestampUnit } from './unixTime';
import './unix-time.css';

type ConversionResult = { value: string; error: string };
const emptyResult: ConversionResult = { value: '', error: '' };
const dateFields: { key: keyof BeijingDateParts; label: string; length: number }[] = [
  { key: 'year', label: '年', length: 4 }, { key: 'month', label: '月', length: 2 }, { key: 'day', label: '日', length: 2 },
  { key: 'hour', label: '时', length: 2 }, { key: 'minute', label: '分', length: 2 }, { key: 'second', label: '秒', length: 2 },
];

export function UnixTimeConverter({ active }: { active: boolean }) {
  const [initialTime] = useState(() => Date.now());
  const [now, setNow] = useState(initialTime);
  const [unit, setUnit] = useState<TimestampUnit>('seconds');
  const [timestamp, setTimestamp] = useState(() => currentTimestamp(initialTime, 'seconds'));
  const [timestampEdited, setTimestampEdited] = useState(false);
  const [parts, setParts] = useState(() => getBeijingParts(initialTime));
  const [quick, setQuick] = useState(() => compactBeijing(getBeijingParts(initialTime)));
  const [dateResult, setDateResult] = useState<ConversionResult>(emptyResult);
  const [partsResult, setPartsResult] = useState<ConversionResult>(emptyResult);
  const [quickResult, setQuickResult] = useState<ConversionResult>(emptyResult);
  const [copied, setCopied] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1800); return () => clearTimeout(timer); }, [copied]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);

  function selectUnit(next: TimestampUnit) {
    setUnit(next);
    if (!timestampEdited) setTimestamp(currentTimestamp(initialTime, next));
    setDateResult(emptyResult); setPartsResult(emptyResult); setQuickResult(emptyResult);
    setCopied('');
  }
  function convert(job: () => string, setResult: (result: ConversionResult) => void) {
    setCopied('');
    try { setResult({ value: job(), error: '' }); }
    catch (error) { setResult({ value: '', error: error instanceof Error ? error.message : String(error) }); }
  }
  async function copy(value: string, key: string) {
    if (!value) return;
    try {
      if (isTauri()) await invoke('copy_json_text', { text: value });
      else await navigator.clipboard.writeText(value);
      setCopied(key);
      setNotice('已复制到剪贴板');
    } catch (error) { setNotice(`复制失败：${String(error)}`); }
  }
  function copyButton(value: string, key: string, label: string) {
    return <button className="unix-copy" type="button" aria-label={label} title={label} disabled={!value} onClick={() => void copy(value, key)}>{copied === key ? <Check size={18} /> : <Copy size={18} />}</button>;
  }
  function resultRow(result: ConversionResult, key: string, label: string, placeholder: string) {
    return <><div className="unix-input-row unix-result"><input aria-label={label} value={result.value} readOnly placeholder={placeholder} />{copyButton(result.value, key, `复制${label}`)}</div>{result.error && <p id={`unix-error-${key}`} className="unix-error" role="alert">{result.error}</p>}</>;
  }
  const unitLabel = unit === 'seconds' ? '秒' : '毫秒';

  return <main className="unix-shell" aria-label="Unix 时间转换">
    <header className="unix-heading"><CalendarClock size={19} /><h2>Unix时间戳互转</h2></header>
    <section className="unix-current" aria-label="当前 Unix 时间戳">
      <label className="unix-label" htmlFor="unix-now">当前时间戳(Unix timestamp)</label>
      <div className="unix-input-row unix-current-row"><input id="unix-now" aria-label="当前时间戳" value={currentTimestamp(now, unit)} readOnly />{copyButton(currentTimestamp(now, unit), 'now', '复制当前时间戳')}</div>
      <div className="unix-units" role="radiogroup" aria-label="时间戳单位">
        <label><input type="radio" name="unix-unit" checked={unit === 'seconds'} onChange={() => selectUnit('seconds')} />10位(秒级)</label>
        <label><input type="radio" name="unix-unit" checked={unit === 'milliseconds'} onChange={() => selectUnit('milliseconds')} />13位(毫秒级)</label>
      </div>
    </section>
    <form className="unix-conversion" aria-label="时间戳转北京时间" onSubmit={(event) => { event.preventDefault(); convert(() => timestampToBeijing(timestamp, unit), setDateResult); }}>
      <label className="unix-label" htmlFor="unix-timestamp">时间戳 → 北京时间</label>
      <div className="unix-input-row"><input id="unix-timestamp" aria-label="待转换时间戳" aria-invalid={!!dateResult.error} aria-describedby={dateResult.error ? 'unix-error-date' : undefined} value={timestamp} onChange={(event) => { setTimestamp(event.target.value); setTimestampEdited(true); setDateResult(emptyResult); }} placeholder={`请输入${unitLabel}级时间戳`} inputMode="text" autoComplete="off" spellCheck={false} maxLength={24} /><button className="unix-convert" type="submit">转换</button></div>
      {resultRow(dateResult, 'date', '转换后的时间', '转换后的时间')}
    </form>
    <form className="unix-conversion unix-parts-section" aria-label="北京时间逐项转时间戳" onSubmit={(event) => { event.preventDefault(); convert(() => beijingToTimestamp(parts, unit), setPartsResult); }}>
      <div className="unix-label">北京时间 → 时间戳（逐项输入）</div>
      <div className="unix-date-row">{dateFields.map((field) => <label className="unix-date-field" key={field.key}><input aria-label={`北京时间${field.label}`} aria-invalid={!!partsResult.error} aria-describedby={partsResult.error ? 'unix-error-parts' : undefined} value={parts[field.key]} onChange={(event) => { setParts({ ...parts, [field.key]: event.target.value }); setPartsResult(emptyResult); }} inputMode="numeric" autoComplete="off" maxLength={field.length} /><span>{field.label}</span></label>)}<button className="unix-convert" type="submit">转换</button></div>
      {resultRow(partsResult, 'parts', '逐项转换后的时间戳', '转换后的时间戳')}
    </form>
    <form className="unix-conversion unix-quick-section" aria-label="北京时间快速转时间戳" onSubmit={(event) => { event.preventDefault(); convert(() => quickBeijingToTimestamp(quick, unit), setQuickResult); }}>
      <label className="unix-label" htmlFor="unix-quick">北京时间 → 时间戳（快速输入格式：YYYYMMDDHHMMSS）</label>
      <div className="unix-input-row"><input id="unix-quick" aria-label="快速输入北京时间" aria-invalid={!!quickResult.error} aria-describedby={quickResult.error ? 'unix-error-quick' : undefined} value={quick} onChange={(event) => { setQuick(event.target.value); setQuickResult(emptyResult); }} placeholder="例如：20250708120305" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={20} /><button className="unix-convert" type="submit">转换</button></div>
      {resultRow(quickResult, 'quick', '快速转换后的时间戳', '转换后的时间戳')}
    </form>
    <div className="unix-footnote"><span>北京时间 UTC+8 · 所有转换使用所选单位（{unitLabel}）</span><span>本地计算 · 支持 0 和负时间戳</span></div>
    {notice && <div className="unix-notice" role="status"><span>{notice}</span><button aria-label="关闭时间转换提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </main>;
}
