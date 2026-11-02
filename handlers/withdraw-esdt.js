'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');
const BigNumber = require('bignumber.js');
const { canonicalizeEsdtAmount } = require('../utils/esdt-amount');
const { unclassifiedTransferResult } = require('../utils/esdt-transfer-outcome');
const {
  esdtWithdrawalsArePaused,
  executeEsdtWithdrawal
} = require('../utils/esdt-withdrawal-flow');

function renderView(view, thumbnail) {
  const embed = new EmbedBuilder()
    .setTitle(view.title)
    .setDescription(view.description)
    .setColor(view.color)
    .setFooter({ text: 'Powered by MakeX', iconURL: 'https://i.ibb.co/rsPX3fy/Make-X-Logo-Trnasparent-BG.png' })
    .setTimestamp();
  if (view.fields && view.fields.length) embed.addFields(view.fields);
  if (thumbnail) embed.setThumbnail(thumbnail);
  return { content: view.content, embeds: [embed], flags: [MessageFlags.Ephemeral] };
}

async function handleWithdrawEsdt(interaction, deps) {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  let tokenTicker = interaction.options.getString('token-ticker');
  if (tokenTicker) tokenTicker = deps.sanitizeTokenIdentifier(tokenTicker);
  if (!tokenTicker) {
    await interaction.editReply({ content: '❌ Token ticker is required.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const amountStr = interaction.options.getString('amount');
  const memo = interaction.options.getString('memo') || 'Withdrawal from virtual account';
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  try {
    deps.virtualAccounts.forceReloadData();
    await deps.virtualAccounts.updateUserUsername(guildId, userId, interaction.user.tag);

    const tokenIdentifier = await deps.resolveTokenIdentifier(guildId, tokenTicker);
    const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
    if (!esdtIdentifierRegex.test(tokenIdentifier)) {
      await interaction.editReply({
        content: `❌ **Invalid token identifier!**\n\nCould not resolve full token identifier for "${tokenTicker}". Please ensure token metadata is registered using /update-token-metadata.`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    let currentBalance = await deps.virtualAccounts.getUserBalance(guildId, userId, tokenIdentifier);
    if (new BigNumber(currentBalance).isZero() && tokenIdentifier !== tokenTicker) {
      currentBalance = await deps.virtualAccounts.getUserBalance(guildId, userId, tokenTicker);
    }
    if (new BigNumber(currentBalance).isLessThanOrEqualTo(0)) {
      await interaction.editReply({
        content: `❌ **No balance available!**\n\nYou have **0** ${tokenTicker} in your virtual account.\n\nDeposit funds to a Community Fund wallet to add tokens to your virtual account.`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    let amountHuman;
    if (String(amountStr || '').toUpperCase() === 'MAX' || String(amountStr || '').toUpperCase() === 'ALL') {
      amountHuman = String(currentBalance);
    } else {
      try {
        amountHuman = new BigNumber(amountStr).toFixed();
      } catch {
        amountHuman = '';
      }
      if (!amountHuman || new BigNumber(amountStr).isNaN() || new BigNumber(amountStr).lte(0)) {
        await interaction.editReply({
          content: '❌ **Invalid amount!**\n\nPlease provide a valid number or use "MAX"/"ALL" to withdraw your entire balance.',
          flags: [MessageFlags.Ephemeral]
        });
        return;
      }
    }

    if (new BigNumber(amountHuman).isGreaterThan(currentBalance)) {
      await interaction.editReply({
        content: `❌ **Insufficient balance!**\n\nYou have: **${currentBalance}** ${tokenTicker}\nRequested: **${amountHuman}** ${tokenTicker}`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    const userWallets = await deps.getUserWallets(guildId);
    const userWallet = userWallets?.[userId];
    if (!userWallet) {
      await interaction.editReply({
        content: '❌ **No wallet registered!**\n\nPlease register your wallet address using `/set-wallet` or click the "Register My Wallet" button in `/list-wallets` before withdrawing funds.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }
    if (!userWallet.startsWith('erd1') || userWallet.length !== 62) {
      await interaction.editReply({
        content: '❌ **Invalid wallet address!**\n\nYour registered wallet address is invalid. Please update it using `/set-wallet`.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    const fundProject = await deps.getCommunityFundProject(guildId);
    if (!fundProject) {
      await interaction.editReply({
        content: '❌ **No Community Fund configured!**\n\nPlease ask an admin to set up a Community Fund using `/set-community-fund`.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    const balanceCheck = await deps.checkCommunityFundBalances(guildId, 1);
    if (!balanceCheck.sufficient) {
      const errorEmbed = await deps.createBalanceErrorEmbed(guildId, balanceCheck, '/withdraw-esdt');
      await interaction.editReply({ embeds: [errorEmbed], flags: [MessageFlags.Ephemeral] });
      return;
    }

    const projectName = deps.getCommunityFundProjectName();
    const projects = await deps.getProjects(guildId);
    const project = projects[projectName];
    if (!project) {
      await interaction.editReply({
        content: '❌ **Community Fund not found!**\n\nThe Community Fund project no longer exists. Please ask an admin to reconfigure it.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    try {
      await deps.assertGuildOnChainPlanActive(guildId);
    } catch (subError) {
      await interaction.editReply({
        content: `❌ **Withdrawals disabled**\n\n${subError.message}`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    const decimals = await deps.getStoredTokenDecimals(guildId, tokenIdentifier);
    if (decimals == null) {
      await interaction.editReply({
        content: `❌ **Token metadata missing for ${tokenTicker}.** Run /update-token-metadata before withdrawing. Your balance was not changed.`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    let canonical;
    try {
      canonical = canonicalizeEsdtAmount(String(amountHuman), Number(decimals));
    } catch (amountError) {
      await interaction.editReply({
        content: `❌ **Invalid amount!**\n\n${amountError.message}`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    if (!deps.withdrawals.isConfigured()) {
      await interaction.editReply({
        content: '⏸️ **Withdrawals are unavailable.** The bot host is missing SUPABASE_SERVICE_ROLE_KEY, so a crash-safe reservation cannot be stored. Your balance was not changed.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    if (esdtWithdrawalsArePaused()) {
      await interaction.editReply({
        content: '⏸️ **ESDT withdrawals are paused** while the 1 Nov 2026 duplicate-hash incident is reconciled. Your balance was not changed. Do not retry until an admin reopens withdrawals.',
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    await interaction.editReply({
      content: `🔄 **Processing withdrawal...**\n\nWithdrawing **${canonical.human}** ${tokenTicker} to your wallet...\nMemo: ${memo}\n\n⏳ Balance will be reserved once. Blockchain confirmation comes from MakeX.`,
      flags: [MessageFlags.Ephemeral]
    });

    const outcome = await executeEsdtWithdrawal({
      repo: deps.withdrawals,
      workerId: `discord-${interaction.id}`,
      input: {
        interactionId: interaction.id,
        guildId,
        userId,
        tokenIdentifier,
        tokenTicker,
        amountHuman: canonical.human,
        decimals: canonical.decimals,
        recipientWallet: userWallet,
        senderWallet: project.walletAddress,
        memo,
        paused: esdtWithdrawalsArePaused()
      },
      send: async (record) => {
        const transferResult = await deps.transferESDTFromCommunityFund(
          record.recipientWallet,
          record.tokenIdentifier,
          record.amountHuman,
          projectName,
          record.guildId,
          {
            exactDecimal: true,
            decimals: record.decimals,
            amountRaw: record.amountRaw,
            idempotencyKey: record.withdrawalId,
            withdrawalId: record.withdrawalId,
            requireTransferIdentity: true,
            expectFeeExempt: true,
            expected: {
              sender: record.senderWallet,
              recipient: record.recipientWallet,
              tokenIdentifier: record.tokenIdentifier,
              amountHuman: record.amountHuman,
              amountRaw: record.amountRaw,
              decimals: record.decimals,
              idempotencyKey: record.withdrawalId
            }
          }
        );
        if (transferResult && transferResult.classified) return transferResult.classified;
        return unclassifiedTransferResult(transferResult);
      }
    });

    if (outcome.kind === 'insufficient') {
      await interaction.editReply({
        content: `❌ **Insufficient balance!**\n\nYou have: **${outcome.available}** ${tokenTicker}\nRequested: **${outcome.amountHuman}** ${tokenTicker}\n\nYour balance may have changed. Please check your balance and try again.`,
        flags: [MessageFlags.Ephemeral]
      });
      return;
    }

    let thumbnail = null;
    if (outcome.kind === 'confirmed') {
      try {
        thumbnail = await deps.getProjectLogoUrl(guildId, projectName);
      } catch (logoError) {
        console.error('[WITHDRAW] Logo lookup failed:', logoError.message);
      }
    }
    await interaction.editReply(renderView(outcome.view, thumbnail));
    console.log(`[WITHDRAW] ${outcome.kind} ${outcome.record ? outcome.record.withdrawalId : 'no-id'} user ${userId}`);
  } catch (error) {
    console.error('[WITHDRAW] Error in withdraw command:', error.message);
    const content = interaction.deferred || interaction.replied
      ? `❌ **Withdrawal could not be completed.**\n\n${error.message}\n\nIf a withdrawal ID was shown, do not start another withdrawal until an admin reconciles it.`
      : `❌ **Withdrawal could not be completed.**\n\n${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content, flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ content, flags: [MessageFlags.Ephemeral] });
    }
  }
}

module.exports = { handleWithdrawEsdt };
