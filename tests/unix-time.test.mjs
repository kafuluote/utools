import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { beijingToTimestamp, compactBeijing, currentTimestamp, getBeijingParts, quickBeijingToTimestamp, timestampToBeijing } from '../src/unixTime.ts';

const parts = (year, month, day, hour = '00', minute = '00', second = '00') => ({ year, month, day, hour, minute, second });

test('epoch zero and negative values use Beijing UTC+8', () => {
  assert.equal(timestampToBeijing('0', 'seconds'), '1970-01-01 08:00:00');
  assert.equal(timestampToBeijing('-1', 'seconds'), '1970-01-01 07:59:59');
  assert.equal(timestampToBeijing('-1', 'milliseconds'), '1970-01-01 07:59:59.999');
  assert.equal(beijingToTimestamp(parts('1970', '01', '01', '08'), 'seconds'), '0');
  assert.equal(beijingToTimestamp(parts('1970', '01', '01'), 'seconds'), '-28800');
});

test('seconds and milliseconds preserve precision and support the 2038 boundary', () => {
  assert.equal(timestampToBeijing('2147483647', 'seconds'), '2038-01-19 11:14:07');
  assert.equal(timestampToBeijing('1709164800123', 'milliseconds'), '2024-02-29 08:00:00.123');
  assert.equal(beijingToTimestamp(parts('2024', '02', '29', '08'), 'milliseconds'), '1709164800000');
  assert.equal(currentTimestamp(-1, 'seconds'), '-1');
  assert.equal(currentTimestamp(1709164800123, 'seconds'), '1709164800');
});

test('structured and compact conversions agree and do not map years 1–99 to 1900', () => {
  for (const date of [parts('0001', '01', '01'), parts('0099', '12', '31', '23', '59', '59'), parts('2000', '02', '29'), parts('9999', '12', '31', '23', '59', '59')]) {
    const seconds = beijingToTimestamp(date, 'seconds');
    assert.equal(quickBeijingToTimestamp(compactBeijing(date), 'seconds'), seconds);
    assert.equal(compactBeijing(getBeijingParts(Number(seconds) * 1000)), compactBeijing(date));
  }
});

test('rejects nonexistent dates and invalid fields instead of rolling into another month', () => {
  for (const date of [parts('2023', '02', '29'), parts('1900', '02', '29'), parts('2024', '04', '31'), parts('2024', '13', '01'), parts('2024', '00', '01'), parts('2024', '01', '00'), parts('0000', '01', '01'), parts('2024', '01', '01', '24'), parts('2024', '01', '01', '00', '60'), parts('2024', '01', '01', '00', '00', '60'), parts('', '01', '01'), parts('2024', '1.5', '01')]) {
    assert.throws(() => beijingToTimestamp(date, 'seconds'));
  }
  for (const input of ['', '20250708', '202507081203050', '2025-07-08 12:03:05', '20250229080000']) assert.throws(() => quickBeijingToTimestamp(input, 'seconds'));
  assert.equal(quickBeijingToTimestamp(' 19700101080000 ', 'seconds'), '0');
});

test('rejects invalid and out-of-range timestamps', () => {
  for (const input of ['', ' ', '1.1', '1e3', '+1', 'NaN', 'Infinity', 'abc', '999999999999999999999999', '8640000000000001', '-8640000000000001', '8640000000000000']) {
    assert.throws(() => timestampToBeijing(input, 'milliseconds'), input);
  }
  assert.equal(timestampToBeijing(' 0 ', 'seconds'), '1970-01-01 08:00:00');
});

test('machine timezone and daylight saving do not affect Beijing conversion', () => {
  const code = `import { quickBeijingToTimestamp, timestampToBeijing } from './src/unixTime.ts'; process.stdout.write(quickBeijingToTimestamp('19700101080000', 'seconds') + '|' + timestampToBeijing('0', 'seconds'));`;
  for (const timezone of ['UTC', 'America/New_York', 'Asia/Shanghai']) {
    const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { cwd: process.cwd(), env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
    assert.equal(output, '0|1970-01-01 08:00:00');
  }
});
