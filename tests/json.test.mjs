import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson, formatJson, jsonRows, containerPositions, replaceJsonValue, JsonParseError } from '../src/json.ts';

test('formats all JSON root types and nested values', () => {
  for (const source of ['null', 'true', 'false', '0', '-0', '-1.2e+3', '"中文"', '[]', '{}', '{"a":[1,"x",false,null,{"b":[]}]}']) {
    const root = parseJson(source);
    assert.deepEqual(JSON.parse(formatJson(root)), JSON.parse(source));
    assert.deepEqual(JSON.parse(formatJson(root, { compact: true })), JSON.parse(source));
  }
  assert.equal(formatJson(parseJson('{"a":[1,2]}')), '{\n  "a": [\n    1,\n    2\n  ]\n}');
});

test('retains large numbers, duplicate keys, negative zero and escape spelling', () => {
  const source = String.raw`{"id":9007199254740993123456789,"id":1e400,"zero":-0,"name":"\u4e2d\u6587","slash":"\/","line":"a\nb"}`;
  const root = parseJson(source);
  assert.equal(formatJson(root, { compact: true }), source);
  const decoded = formatJson(root, { compact: true, preserveEscapes: false });
  assert.ok(decoded.includes('"id":9007199254740993123456789'));
  assert.ok(decoded.includes('"id":1e400'));
  assert.ok(decoded.includes('"name":"中文"'));
  assert.ok(decoded.includes('"slash":"/"'));
  assert.ok(decoded.includes(String.raw`"line":"a\nb"`));
});

test('rejects malformed JSON including invalid numbers and control characters', () => {
  for (const source of ['', ' ', '{', '[', '{a:1}', '{"a" 1}', '{"a":}', '[1,]', '{"a":1,}', '01', '+1', '.1', '1.', '1e', 'NaN', 'Infinity', 'undefined', 'true false', String.raw`"\x41"`, String.raw`"\u12"`, '"unterminated', '"a\nb"', '[1 2]', '{"a":1]']) {
    assert.throws(() => parseJson(source), JsonParseError, source);
  }
  assert.throws(() => parseJson('{\n  "a": 1,\n}'), (error) => error.line === 3 && error.column === 1 && error.position === 12);
});

test('folding preserves data and output and limits only visible rows', () => {
  const root = parseJson('{"a":[1,{"b":true}],"c":[]}');
  const output = formatJson(root);
  assert.deepEqual(containerPositions(root), [0, 5, 8]);
  const folded = jsonRows(root, new Set([5]));
  assert.equal(folded.rows.length, 4);
  assert.equal(folded.rows[1].folded, true);
  assert.equal(formatJson(root), output);
  assert.equal(jsonRows(root, new Set(), 3).truncated, true);
  assert.equal(jsonRows(root, new Set(), 3).rows.length, 3);
  assert.equal(jsonRows(root, new Set([0])).rows.length, 1);
});

test('inline replacement changes the selected token without rounding other values', () => {
  const source = '{"id":9007199254740993123,"a":"old","a":"last"}';
  const root = parseJson(source);
  const target = root.children[1].value;
  assert.equal(replaceJsonValue(source, target, '{"nested":true}'), '{"id":9007199254740993123,"a":{"nested":true},"a":"last"}');
  assert.throws(() => replaceJsonValue(source, target, 'oops'), JsonParseError);
});

test('input and depth limits prevent runaway parser work', () => {
  assert.throws(() => parseJson(' '.repeat(1_000_001)), /100 万字符/);
  assert.throws(() => parseJson('['.repeat(258) + '0' + ']'.repeat(258)), /256 层/);
});
