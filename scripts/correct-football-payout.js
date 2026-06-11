#!/usr/bin/env node
/**
 * Correct a mis-paid football match (e.g. null-null score treated as draw).
 *
 * Usage:
 *   node scripts/correct-football-payout.js --match-id 537327 --guild-id YOUR_GUILD_ID --home 2 --away 0
 *   node scripts/correct-football-payout.js --match-id 537327 --guild-id YOUR_GUILD_ID --home 2 --away 0 --apply
 *
 * Without --apply, runs in dry-run mode (shows planned changes only).
 */

require('dotenv').config();

const BigNumber = require('bignumber.js');
const dbFootball = require('../db/football');
const virtualAccounts = require('../virtual-accounts');
const footballScore = require('../utils/football-score');

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--match-id') args.matchId = argv[++i];
    else if (arg === '--guild-id') args.guildId = argv[++i];
    else if (arg === '--home') args.home = Number(argv[++i]);
    else if (arg === '--away') args.away = Number(argv[++i]);
  }
  return args;
}

function getMatchTokenForGuild(match, guildId) {
  return match.tokenByGuild?.[guildId] || match.token || null;
}

async function calculateMatchPotSize(guildId, matchId, match, token) {
  const matchBets = await dbFootball.getBetsByMatch(guildId, matchId);
  const allBets = Array.isArray(matchBets) ? matchBets : Object.values(matchBets || {});
  const betsPotWei = allBets.reduce((total, bet) => total + Number(bet.amountWei || 0), 0);
  const bonusPotWei = match.bonusPotWeiByGuild?.[guildId] || '0';
  const totalPotWei = new BigNumber(betsPotWei).plus(new BigNumber(bonusPotWei)).toString();
  const totalPotHuman = new BigNumber(totalPotWei).dividedBy(new BigNumber(10).pow(token.decimals)).toString();
  return { totalPotWei, totalPotHuman, allBets };
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.matchId || !args.guildId || !Number.isFinite(args.home) || !Number.isFinite(args.away)) {
    console.error('Usage: node scripts/correct-football-payout.js --match-id ID --guild-id GUILD --home N --away N [--apply]');
    process.exit(1);
  }

  const correctedScore = { home: args.home, away: args.away };
  if (!footballScore.isValidFtScore(correctedScore)) {
    console.error('Invalid score provided.');
    process.exit(1);
  }

  const winningOutcome = footballScore.deriveWinningOutcome(correctedScore.home, correctedScore.away);
  const match = await dbFootball.getMatch(args.matchId);
  if (!match) {
    console.error(`Match ${args.matchId} not found.`);
    process.exit(1);
  }

  if (!match.guildIds?.includes(args.guildId)) {
    console.error(`Match ${args.matchId} is not linked to guild ${args.guildId}.`);
    process.exit(1);
  }

  const token = getMatchTokenForGuild(match, args.guildId);
  if (!token?.identifier) {
    console.error('Could not resolve token for this guild/match.');
    process.exit(1);
  }

  const { totalPotWei, totalPotHuman, allBets } = await calculateMatchPotSize(args.guildId, args.matchId, match, token);
  const correctWinners = allBets.filter((bet) => bet.outcome === winningOutcome);
  const incorrectPaid = allBets.filter((bet) => bet.prizeSent && bet.outcome !== winningOutcome);
  const prizePerWinnerWei = correctWinners.length > 0
    ? Math.floor(Number(totalPotWei) / correctWinners.length)
    : 0;
  const prizePerWinnerHuman = new BigNumber(prizePerWinnerWei)
    .dividedBy(new BigNumber(10).pow(token.decimals))
    .toString();

  console.log('=== Football payout correction ===');
  console.log(`Match: ${match.home} vs ${match.away} (${args.matchId})`);
  console.log(`Guild: ${args.guildId}`);
  console.log(`Corrected score: ${correctedScore.home}-${correctedScore.away} (winner: ${winningOutcome})`);
  console.log(`Current stored score: ${JSON.stringify(match.ftScore)}`);
  console.log(`Total pot: ${totalPotHuman} ${token.ticker}`);
  console.log(`Correct winners (${correctWinners.length}):`, correctWinners.map((b) => `${b.userId} (${b.outcome})`).join(', ') || 'none');
  console.log(`Prize per correct winner: ${prizePerWinnerHuman} ${token.ticker}`);
  console.log(`Incorrectly paid bets (${incorrectPaid.length}):`);
  for (const bet of incorrectPaid) {
    console.log(`  - ${bet.userId} outcome=${bet.outcome} prize=${bet.prizeAmount} ${token.ticker}`);
  }

  if (!args.apply) {
    console.log('\nDry run only. Re-run with --apply to execute corrections.');
    return;
  }

  console.log('\nApplying corrections...');

  await dbFootball.updateMatch(args.matchId, {
    status: 'FINISHED',
    ftScore: correctedScore
  });

  for (const bet of incorrectPaid) {
    if (!bet.prizeAmount) continue;
    console.log(`Clawing back ${bet.prizeAmount} ${token.ticker} from ${bet.userId}...`);
    const clawback = await virtualAccounts.deductFundsFromAccount(
      args.guildId,
      bet.userId,
      token.identifier,
      bet.prizeAmount,
      `Football payout correction for match ${args.matchId}`,
      'football_payout_correction'
    );
    if (!clawback.success) {
      console.error(`  FAILED to claw back from ${bet.userId}: ${clawback.error}`);
      process.exit(1);
    }
    await dbFootball.resetBetPrize(bet.betId, args.guildId);
  }

  for (const bet of allBets.filter((b) => b.prizeSent && b.outcome === winningOutcome)) {
    await dbFootball.resetBetPrize(bet.betId, args.guildId);
  }

  for (const winner of correctWinners) {
    if (winner.prizeSent && winner.outcome === winningOutcome) {
      console.log(`Skipping ${winner.userId} — already paid correctly.`);
      continue;
    }

    console.log(`Paying ${prizePerWinnerHuman} ${token.ticker} to ${winner.userId}...`);
    const payout = await virtualAccounts.addFundsToAccount(
      args.guildId,
      winner.userId,
      token.identifier,
      prizePerWinnerHuman,
      null,
      'football_prize_correction'
    );
    if (!payout.success) {
      console.error(`  FAILED to pay ${winner.userId}: ${payout.error}`);
      process.exit(1);
    }
    await dbFootball.updateBetPrize(winner.betId, args.guildId, prizePerWinnerHuman);
  }

  console.log('\nDone. Verify balances with /check-balance-esdt and update Discord embeds manually if needed.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
