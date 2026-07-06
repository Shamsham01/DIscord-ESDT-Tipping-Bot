#!/usr/bin/env node
/**
 * Correct VA ledger after false withdrawal rollbacks (on-chain tx succeeded but balance was restored).
 *
 * Usage:
 *   node scripts/correct-withdraw-ledger.js --guild-id GUILD --user-id USER --token DROP-hex --amount 6000
 *   node scripts/correct-withdraw-ledger.js --guild-id GUILD --user-id USER --token DROP-hex --amount 6000 --apply
 *   node scripts/correct-withdraw-ledger.js --guild-id GUILD --user-id USER --token DROP-hex --amount 6000 --tx-hash HASH1 --tx-hash HASH2 --apply
 *
 * Without --apply, runs in dry-run mode (shows planned changes only).
 */

require('dotenv').config();

const BigNumber = require('bignumber.js');
const dbVirtualAccounts = require('../db/virtual-accounts');

function parseArgs(argv) {
  const args = { apply: false, txHashes: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--guild-id') args.guildId = argv[++i];
    else if (arg === '--user-id') args.userId = argv[++i];
    else if (arg === '--token') args.token = argv[++i];
    else if (arg === '--amount') args.amount = argv[++i];
    else if (arg === '--reason') args.reason = argv[++i];
    else if (arg === '--tx-hash') args.txHashes.push(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.guildId || !args.userId || !args.token || !args.amount) {
    console.error('Usage: node scripts/correct-withdraw-ledger.js --guild-id GUILD --user-id USER --token TOKEN-ID --amount N [--tx-hash HASH ...] [--reason TEXT] [--apply]');
    process.exit(1);
  }

  const amountBN = new BigNumber(args.amount);
  if (amountBN.isNaN() || amountBN.isLessThanOrEqualTo(0)) {
    console.error('Invalid --amount');
    process.exit(1);
  }

  const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
  if (!esdtIdentifierRegex.test(args.token)) {
    console.error('Invalid --token: must be full identifier (e.g. DROP-abc123)');
    process.exit(1);
  }

  const reason = args.reason || 'manual ledger correction: false withdrawal rollback after on-chain success';
  const amountStr = amountBN.toString();

  const balanceBefore = await dbVirtualAccounts.getAccountBalance(args.guildId, args.userId, args.token);
  const balanceBeforeBN = new BigNumber(balanceBefore || '0');

  console.log('=== Withdraw ledger correction ===');
  console.log(`Guild:     ${args.guildId}`);
  console.log(`User:      ${args.userId}`);
  console.log(`Token:     ${args.token}`);
  console.log(`Deduct:    ${amountStr}`);
  console.log(`Balance:   ${balanceBefore} -> ${balanceBeforeBN.minus(amountStr).toString()}`);
  if (args.txHashes.length) {
    console.log(`Tx refs:   ${args.txHashes.join(', ')}`);
  }
  console.log(`Reason:    ${reason}`);
  console.log(`Mode:      ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  if (balanceBeforeBN.isLessThan(amountBN)) {
    console.error(`\nRefusing: balance ${balanceBefore} is less than correction amount ${amountStr}`);
    process.exit(1);
  }

  const history = await dbVirtualAccounts.getTransactionHistory(args.guildId, args.userId, 20);
  const relevant = history.filter((tx) =>
    tx.token?.toLowerCase() === args.token.toLowerCase() &&
    (tx.description?.includes('ledger reversal') || tx.description?.includes('withdrawal'))
  );
  if (relevant.length) {
    console.log('\nRecent withdrawal/reversal transactions:');
    for (const tx of relevant.slice(0, 10)) {
      console.log(`  ${new Date(tx.timestamp).toISOString()} | ${tx.type} | ${tx.amount} | ${tx.description}`);
    }
  }

  if (!args.apply) {
    console.log('\nDry run complete. Re-run with --apply to deduct the phantom balance.');
    return;
  }

  const { newBalance, balanceBefore: before } = await dbVirtualAccounts.updateAccountBalance(
    args.guildId,
    args.userId,
    args.token,
    `-${amountStr}`,
    {}
  );

  await dbVirtualAccounts.addTransaction(args.guildId, args.userId, {
    id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'withdrawal',
    token: args.token,
    amount: amountStr,
    balanceBefore: before,
    balanceAfter: newBalance,
    txHash: args.txHashes[0] || null,
    description: reason,
    timestamp: Date.now()
  });

  console.log(`\nApplied. New balance: ${newBalance}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
