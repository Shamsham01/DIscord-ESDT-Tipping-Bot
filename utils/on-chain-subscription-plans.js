const ON_CHAIN_SUBSCRIPTION_PLANS = {
  '1_month': { months: 1, amountUsdc: 10, label: '1 Month (10 USDC)' },
  '3_months': { months: 3, amountUsdc: 20, label: '3 Months (20 USDC — 10 USDC off)' },
  '6_months': { months: 6, amountUsdc: 40, label: '6 Months (40 USDC — 20 USDC off)' },
  '12_months': { months: 12, amountUsdc: 60, label: '12 Months (60 USDC — 60 USDC off)' }
};

const USDC_TOKEN_IDENTIFIER = process.env.USDC_TOKEN_IDENTIFIER || 'USDC-c76f1f';
const ON_CHAIN_SUBSCRIPTION_TREASURY_WALLET =
  process.env.ON_CHAIN_SUBSCRIPTION_TREASURY_WALLET ||
  'erd158k2c3aserjmwnyxzpln24xukl2fsvlk9x46xae4dxl5xds79g6sdz37qn';

function getPlan(planKey) {
  return ON_CHAIN_SUBSCRIPTION_PLANS[planKey] || null;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function computeSubscriptionEnd(existingEnd, planMonths) {
  const now = new Date();
  const base = existingEnd && new Date(existingEnd).getTime() > now.getTime()
    ? new Date(existingEnd)
    : now;
  return addMonths(base, planMonths);
}

module.exports = {
  ON_CHAIN_SUBSCRIPTION_PLANS,
  USDC_TOKEN_IDENTIFIER,
  ON_CHAIN_SUBSCRIPTION_TREASURY_WALLET,
  getPlan,
  addMonths,
  computeSubscriptionEnd
};
