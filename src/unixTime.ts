export type TimestampUnit = 'seconds' | 'milliseconds';
export type BeijingDateParts = { year: string; month: string; day: string; hour: string; minute: string; second: string };
const beijingOffset = 8 * 60 * 60 * 1000;
const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function getBeijingParts(milliseconds: number): BeijingDateParts {
  const date = new Date(milliseconds + beijingOffset);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    throw new Error('时间超出支持范围（北京时间 0001–9999 年）');
  }
  return {
    year: pad(date.getUTCFullYear(), 4), month: pad(date.getUTCMonth() + 1), day: pad(date.getUTCDate()),
    hour: pad(date.getUTCHours()), minute: pad(date.getUTCMinutes()), second: pad(date.getUTCSeconds()),
  };
}

export function formatBeijing(milliseconds: number, includeMilliseconds = false): string {
  const parts = getBeijingParts(milliseconds);
  const fraction = includeMilliseconds ? `.${pad(new Date(milliseconds).getUTCMilliseconds(), 3)}` : '';
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}${fraction}`;
}

export function currentTimestamp(milliseconds: number, unit: TimestampUnit): string {
  return String(unit === 'seconds' ? Math.floor(milliseconds / 1000) : milliseconds);
}

export function timestampToBeijing(input: string, unit: TimestampUnit): string {
  const text = input.trim();
  if (!text) throw new Error('请输入时间戳');
  if (!/^-?\d+$/.test(text)) throw new Error('时间戳必须是整数，可为 0 或负数');
  if (text.length > 20) throw new Error('时间戳超出支持范围');
  const milliseconds = BigInt(text) * (unit === 'seconds' ? 1000n : 1n);
  if (milliseconds < -8640000000000000n || milliseconds > 8640000000000000n) throw new Error('时间戳超出支持范围');
  return formatBeijing(Number(milliseconds), unit === 'milliseconds');
}

export function beijingToTimestamp(parts: BeijingDateParts, unit: TimestampUnit): string {
  const labels: Record<keyof BeijingDateParts, string> = { year: '年', month: '月', day: '日', hour: '时', minute: '分', second: '秒' };
  const numbers = {} as Record<keyof BeijingDateParts, number>;
  for (const key of Object.keys(labels) as (keyof BeijingDateParts)[]) {
    const text = parts[key].trim();
    if (!text || !/^\d+$/.test(text) || text.length > (key === 'year' ? 4 : 2)) throw new Error(`请填写有效的${labels[key]}`);
    numbers[key] = Number(text);
  }
  const { year, month, day, hour, minute, second } = numbers;
  if (year < 1 || year > 9999) throw new Error('年份必须在 0001–9999 之间');
  if (month < 1 || month > 12) throw new Error('月份必须在 1–12 之间');
  if (day < 1 || day > 31) throw new Error('日期必须在 1–31 之间');
  if (hour > 23) throw new Error('小时必须在 0–23 之间');
  if (minute > 59) throw new Error('分钟必须在 0–59 之间');
  if (second > 59) throw new Error('秒必须在 0–59 之间');
  // setUTCFullYear avoids Date.UTC's special handling of years 0–99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('日期不存在，请检查月份天数或闰年');
  return currentTimestamp(date.getTime() - beijingOffset, unit);
}

export function compactBeijing(parts: BeijingDateParts): string {
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

export function quickBeijingToTimestamp(input: string, unit: TimestampUnit): string {
  const text = input.trim();
  if (!/^\d{14}$/.test(text)) throw new Error('请输入 14 位日期，格式为 YYYYMMDDHHMMSS');
  return beijingToTimestamp({ year: text.slice(0, 4), month: text.slice(4, 6), day: text.slice(6, 8), hour: text.slice(8, 10), minute: text.slice(10, 12), second: text.slice(12, 14) }, unit);
}
