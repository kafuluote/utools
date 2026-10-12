// Keep the original number and string tokens: parsing through JS numbers would
// silently round large IDs, and JSON.stringify would discard escape spelling.
export type JsonNode = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  start: number;
  end: number;
  raw: string;
  children: { key?: JsonNode; value: JsonNode }[];
};

export class JsonParseError extends Error {
  line: number;
  column: number;
  position: number;
  constructor(message: string, source: string, position: number) {
    const before = source.slice(0, position).split('\n');
    super(`${message}（第 ${before.length} 行，第 ${before[before.length - 1].length + 1} 列）`);
    this.line = before.length;
    this.column = before[before.length - 1].length + 1;
    this.position = position;
  }
}

export function parseJson(source: string): JsonNode {
  let position = 0;
  let count = 0;
  const fail = (message: string): never => { throw new JsonParseError(message, source, position); };
  if (source.length > 1_000_000) fail('输入不能超过 100 万字符');
  const whitespace = () => { while (/[\x20\t\r\n]/.test(source[position] ?? '') && position < source.length) position++; };
  const string = (): JsonNode => {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === '"') return { type: 'string', start, end: position, raw: source.slice(start, position), children: [] };
      if (char.charCodeAt(0) < 32) { position--; fail('字符串中存在未转义的控制字符'); }
      if (char === '\\') {
        const escape = source[position++];
        if (escape === 'u') {
          if (!/^[\da-fA-F]{4}$/.test(source.slice(position, position + 4))) fail('Unicode 转义需要四位十六进制字符');
          position += 4;
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) { position--; fail('无效的转义字符'); }
      }
    }
    return fail('字符串缺少结束引号');
  };
  const value = (depth: number): JsonNode => {
    whitespace();
    if (depth > 256) fail('嵌套层级不能超过 256 层');
    if (++count > 100_000) fail('节点数量不能超过 10 万个');
    const start = position;
    const char = source[position];
    if (char === '"') return string();
    if (char === '{' || char === '[') {
      const object = char === '{';
      const close = object ? '}' : ']';
      const children: JsonNode['children'] = [];
      position++;
      whitespace();
      if (source[position] !== close) {
        while (true) {
          let key: JsonNode | undefined;
          if (object) {
            if (source[position] !== '"') fail('对象的键必须使用双引号');
            key = string();
            whitespace();
            if (source[position++] !== ':') { position--; fail('对象的键后需要冒号'); }
          }
          children.push({ key, value: value(depth + 1) });
          whitespace();
          if (source[position] === close) break;
          if (source[position++] !== ',') { position--; fail(`需要逗号或 ${close}`); }
          whitespace();
          if (source[position] === close) fail('JSON 不允许末尾逗号');
        }
      }
      position++;
      return { type: object ? 'object' : 'array', start, end: position, raw: '', children };
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(position));
    if (number) {
      position += number[0].length;
      return { type: 'number', start, end: position, raw: number[0], children: [] };
    }
    for (const literal of ['true', 'false', 'null'] as const) {
      if (source.startsWith(literal, position)) {
        position += literal.length;
        return { type: literal === 'null' ? 'null' : 'boolean', start, end: position, raw: literal, children: [] };
      }
    }
    return fail(position >= source.length ? 'JSON 数据未完成' : '此处需要有效的 JSON 值');
  };
  const root = value(0);
  whitespace();
  if (position !== source.length) fail('JSON 值后存在多余内容');
  return root;
}

export function jsonToken(node: JsonNode, preserveEscapes = true): string {
  return node.type === 'string' && !preserveEscapes ? JSON.stringify(JSON.parse(node.raw)) : node.raw;
}

export function formatJson(node: JsonNode, { compact = false, preserveEscapes = true } = {}): string {
  const render = (value: JsonNode, depth: number): string => {
    if (value.type !== 'object' && value.type !== 'array') return jsonToken(value, preserveEscapes);
    const object = value.type === 'object';
    const open = object ? '{' : '[';
    const close = object ? '}' : ']';
    if (!value.children.length) return open + close;
    const items = value.children.map((child) => `${child.key ? `${jsonToken(child.key, preserveEscapes)}:${compact ? '' : ' '}` : ''}${render(child.value, depth + 1)}`);
    return compact ? open + items.join(',') + close : `${open}\n${items.map((item) => '  '.repeat(depth + 1) + item).join(',\n')}\n${'  '.repeat(depth)}${close}`;
  };
  return render(node, 0);
}

export type JsonRow = { node: JsonNode; key?: JsonNode; depth: number; comma: boolean; closing?: boolean; folded?: boolean };
export function jsonRows(root: JsonNode, collapsed: ReadonlySet<number>, limit = 3000): { rows: JsonRow[]; truncated: boolean } {
  const rows: JsonRow[] = [];
  let truncated = false;
  const visit = (node: JsonNode, depth: number, comma: boolean, key?: JsonNode) => {
    if (rows.length >= limit) { truncated = true; return; }
    const container = node.type === 'object' || node.type === 'array';
    const folded = container && node.children.length > 0 && collapsed.has(node.start);
    rows.push({ node, key, depth, comma: !container || folded || !node.children.length ? comma : false, folded });
    if (container && node.children.length && !folded) {
      for (let index = 0; index < node.children.length; index++) {
        if (rows.length >= limit) { truncated = true; break; }
        const child = node.children[index];
        visit(child.value, depth + 1, index < node.children.length - 1, child.key);
      }
      if (rows.length < limit) rows.push({ node, depth, comma, closing: true });
      else truncated = true;
    }
  };
  visit(root, 0, false);
  return { rows, truncated };
}

export function containerPositions(root: JsonNode): number[] {
  const positions: number[] = [];
  const visit = (node: JsonNode) => {
    if (node.children.length) positions.push(node.start);
    node.children.forEach((child) => visit(child.value));
  };
  visit(root);
  return positions;
}

export function replaceJsonValue(source: string, node: JsonNode, replacement: string): string {
  parseJson(replacement);
  const result = source.slice(0, node.start) + replacement + source.slice(node.end);
  parseJson(result);
  return result;
}
