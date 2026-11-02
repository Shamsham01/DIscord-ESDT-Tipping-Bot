'use strict';

const BigNumber = require('bignumber.js');

// Never use exponential notation for withdrawal amounts.
BigNumber.config({
  EXPONENTIAL_AT: 1e9,
  DECIMAL_PLACES: 40,
  ROUNDING_MODE: BigNumber.ROUND_DOWN
});

const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/;

function assertDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    const error = new Error(`Invalid token decimals: ${decimals}`);
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }
}

/**
 * Convert a positive decimal string into the exact base-unit integer for an ESDT.
 * Rejects JavaScript numbers so parseFloat/Number cannot round 18-decimal values.
 */
function canonicalizeEsdtAmount(amount, decimals) {
  assertDecimals(decimals);
  if (typeof amount === 'number' || typeof amount === 'bigint') {
    const error = new Error('ESDT withdrawal amounts must be decimal strings, not JavaScript numbers');
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }
  const trimmed = typeof amount === 'string' ? amount.trim() : '';
  const match = DECIMAL_STRING.exec(trimmed);
  if (!match) {
    const error = new Error(`Invalid ESDT amount: "${amount}"`);
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }
  const fraction = match[1] || '';
  if (fraction.length > decimals) {
    const error = new Error(`Amount ${trimmed} has more precision than ${decimals} token decimals`);
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }

  const value = new BigNumber(trimmed);
  if (!value.isFinite() || value.lte(0)) {
    const error = new Error(`Invalid ESDT amount: "${amount}"`);
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }

  const rawValue = value.shiftedBy(decimals);
  if (!rawValue.isInteger()) {
    const error = new Error(`Amount ${trimmed} is not an exact multiple of the token base unit`);
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }

  const raw = rawValue.toFixed(0);
  const human = new BigNumber(raw).shiftedBy(-decimals).toFixed();
  return { human, raw, decimals };
}

function decimalStringsEqual(left, right) {
  if (left == null || right == null) return false;
  try {
    return new BigNumber(String(left)).eq(new BigNumber(String(right)));
  } catch {
    return false;
  }
}

function addDecimalStrings(left, right) {
  return new BigNumber(left).plus(right).toFixed();
}

function subtractDecimalStrings(left, right) {
  return new BigNumber(left).minus(right).toFixed();
}

/**
 * Exact human decimal for a base-unit integer. Used when a fee was calculated in raw units.
 */
function humanFromRaw(raw, decimals) {
  assertDecimals(decimals);
  const rawText = String(raw == null ? '' : raw).trim();
  if (!/^(?:0|[1-9]\d*)$/.test(rawText) || rawText === '0') {
    const error = new Error(`Invalid raw ESDT amount: "${raw}"`);
    error.code = 'ESDT_AMOUNT_INVALID';
    throw error;
  }
  if (decimals === 0) return canonicalizeEsdtAmount(rawText, 0);
  const padded = rawText.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  const human = fraction.length ? `${whole}.${fraction}` : whole;
  return canonicalizeEsdtAmount(human, decimals);
}

/**
 * Accept a decimal string, or a Discord number option only when Number#toString is exact.
 * Scientific notation is rejected so a rounded binary float is not sent to MakeX.
 */
function decimalStringFromInput(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      const error = new Error('Amount must be a positive decimal');
      error.code = 'ESDT_AMOUNT_INVALID';
      throw error;
    }
    const text = value.toString();
    if (/[eE]/.test(text)) {
      const error = new Error('Amount cannot be represented as an exact decimal string');
      error.code = 'ESDT_AMOUNT_INVALID';
      throw error;
    }
    return text;
  }
  const error = new Error('Amount must be a decimal string');
  error.code = 'ESDT_AMOUNT_INVALID';
  throw error;
}

module.exports = {
  canonicalizeEsdtAmount,
  humanFromRaw,
  decimalStringFromInput,
  decimalStringsEqual,
  addDecimalStrings,
  subtractDecimalStrings
};
