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

module.exports = {
  canonicalizeEsdtAmount,
  decimalStringsEqual,
  addDecimalStrings,
  subtractDecimalStrings
};
