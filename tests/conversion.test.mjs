import test from 'node:test';
import assert from 'node:assert/strict';
import { convertAmount, getRate, isValidAmount } from '../src/conversion.ts';

test('both input directions preserve the same exchange rate', () => {
  assert.equal(convertAmount('1', 6.6922, 'left'), '6.6922');
  assert.equal(convertAmount('6.6922', 6.6922, 'right'), '1');
  assert.equal(convertAmount('100', 6.6922, 'left'), '669.22');
  assert.equal(convertAmount('669.22', 6.6922, 'right'), '100');
});

test('empty, zero and decimal edits do not produce NaN', () => {
  assert.equal(convertAmount('', 6.6922, 'right'), '');
  assert.equal(convertAmount('0', 6.6922, 'left'), '0');
  assert.equal(convertAmount('.', 6.6922, 'left'), '0');
  assert.equal(convertAmount('0.01', 157.2, 'right'), '0.00006361');
  assert.equal(isValidAmount('1.2.3'), false);
  assert.equal(isValidAmount('abc'), false);
  assert.equal(isValidAmount('1.'), true);
});

test('currency changes use cross rates and same currency is exactly one', () => {
  const rates = { USD: 1, CNY: 6.6922, EUR: 0.92 };
  assert.equal(getRate(rates, 'USD', 'CNY'), 6.6922);
  assert.equal(getRate(rates, 'CNY', 'USD'), 1 / 6.6922);
  assert.equal(getRate(rates, 'CNY', 'CNY'), 1);
  assert.equal(getRate(rates, 'EUR', 'CNY'), 6.6922 / 0.92);
  assert.equal(getRate(rates, 'USD', 'JPY'), undefined);
  assert.equal(getRate({ USD: 1, CNY: 0 }, 'USD', 'CNY'), undefined);
});
