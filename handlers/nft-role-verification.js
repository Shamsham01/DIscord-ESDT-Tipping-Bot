const {
  EmbedBuilder,
  PermissionsBitField,
  MessageFlags,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');
const dbNftRoleRules = require('../db/nft-role-verification');
const { runNftRoleSync } = require('../jobs/sync-nft-role-verifications');
const { describeEligibilityMode } = require('../utils/nft-role-eligibility-mode');

const SELECT_CUSTOM_ID = 'nft-role-rule-manage';

function parseCollections(raw) {
  if (!raw || typeof raw !== 'string') {
    return [];
  }
  return [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
}

async function handleNftRoleVerificationCommand(interaction, client) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: 'Only administrators can manage NFT role verification.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'create') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const eligibilityChoice = interaction.options.getString('eligibility') || 'wallet_or_va';
    const patchRuleId = (interaction.options.getString('rule-id') || '').trim();

    if (patchRuleId) {
      const existingPatch = await dbNftRoleRules.getRuleById(guildId, patchRuleId);
      if (!existingPatch) {
        await interaction.editReply({ content: 'Rule not found for this server (check **rule-id**).' });
        return;
      }
      const updatedPatch = await dbNftRoleRules.setRuleEligibilityMode(guildId, patchRuleId, eligibilityChoice);
      await interaction.editReply({
        content: `Updated rule \`${patchRuleId}\`: eligibility → **${describeEligibilityMode(
          updatedPatch.eligibilityMode
        ).replace(/\*\*/g, '')}**. Run **/nft-role-verification run-now** to sync.`
      });
      return;
    }

    const role = interaction.options.getRole('role');
    const channel = interaction.options.getChannel('notification-channel');
    const collectionsRaw = interaction.options.getString('collections');
    if (!role || !channel || collectionsRaw == null || String(collectionsRaw).trim() === '') {
      await interaction.editReply({
        content:
          'To **create** a rule, provide **role**, **notification-channel**, and **collections**. To **only change eligibility** on an existing rule, set **rule-id** and choose **eligibility** (other fields omitted).'
      });
      return;
    }

    const matchMode = interaction.options.getString('match-mode') || 'any';
    const minCount = interaction.options.getInteger('min-count') || 1;

    if (role.managed || role.id === interaction.guildId) {
      await interaction.editReply({ content: 'Pick a normal role (not @everyone or bot-managed roles).' });
      return;
    }

    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement &&
      channel.type !== ChannelType.PublicThread &&
      channel.type !== ChannelType.PrivateThread
    ) {
      await interaction.editReply({ content: 'Notification channel must be text, announcement, or a thread.' });
      return;
    }

    const me = interaction.guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms || !perms.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
      await interaction.editReply({
        content: 'I need **View Channel**, **Send Messages**, and **Embed Links** in the notification channel.'
      });
      return;
    }

    const collectionTickers = parseCollections(collectionsRaw);
    if (collectionTickers.length === 0) {
      await interaction.editReply({ content: 'Provide at least one collection ticker (comma-separated).' });
      return;
    }

    const rule = await dbNftRoleRules.createRule(guildId, {
      discordRoleId: role.id,
      notificationChannelId: channel.id,
      collectionTickers,
      matchMode: matchMode === 'all' ? 'all' : 'any',
      minCountPerCollection: minCount,
      eligibilityMode: eligibilityChoice,
      enabled: true
    });

    const modeHumanPlain = describeEligibilityMode(rule.eligibilityMode).replace(/\*\*/g, '');

    const setupEmbed = new EmbedBuilder()
      .setTitle('NFT role verification created')
      .setDescription(
        '_Eligibility_ controls how MvX-linked wallet holdings and Virtual Account inventory combine.'
      )
      .addFields(
        { name: 'Rule ID', value: `\`${rule.id}\``, inline: true },
        { name: 'Role', value: `<@&${role.id}>`, inline: true },
        { name: 'Eligibility', value: modeHumanPlain, inline: false },
        { name: 'Collections', value: collectionTickers.join(', ') || '—', inline: false },
        { name: 'Match', value: rule.matchMode, inline: true },
        { name: 'Min per collection', value: String(rule.minCountPerCollection), inline: true },
        { name: 'Created by', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setColor(0x57f287)
      .setTimestamp();

    try {
      await channel.send({ embeds: [setupEmbed] });
    } catch (e) {
      await interaction.editReply({
        content: `Rule saved but I could not post to ${channel}: ${e.message}. Check permissions.`
      });
      return;
    }

    await interaction.editReply({ content: `Created rule \`${rule.id}\`. Confirmation sent to ${channel}.` });
    return;
  }

  if (sub === 'list') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const rules = await dbNftRoleRules.listRulesForGuild(guildId);
    if (rules.length === 0) {
      await interaction.editReply({ content: 'No NFT role verification rules in this server.' });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('NFT role verification rules')
      .setDescription(
        rules
          .map(
            (r, i) =>
              `**${i + 1}.** \`${r.id}\` — <@&${r.discordRoleId}> — ${r.enabled ? 'on' : 'off'}\n` +
              `Collections: ${(r.collectionTickers || []).join(', ')}\n` +
              `Eligibility: ${describeEligibilityMode(r.eligibilityMode).replace(/\*\*/g, '')}\n` +
              `Match: **${r.matchMode}**, min: **${r.minCountPerCollection}**`
          )
          .join('\n\n')
          .slice(0, 4000)
      )
      .setColor(0x3498db)
      .setTimestamp();

    const components = [];
    const slice = rules.slice(0, 25);
    if (slice.length > 0) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(SELECT_CUSTOM_ID)
        .setPlaceholder('Toggle a rule (use /nft-role-verification delete for removal)')
        .setMinValues(1)
        .setMaxValues(1);
      for (const r of slice) {
        const label = (r.collectionTickers && r.collectionTickers[0]) || 'rule';
        menu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Toggle: ${label}`.slice(0, 100))
            .setDescription(`Enabled: ${r.enabled ? 'yes' : 'no'} · ${String(r.id).slice(0, 8)}…`.slice(0, 100))
            .setValue(`toggle:${r.id}`)
        );
      }
      components.push(new ActionRowBuilder().addComponents(menu));
    }

    await interaction.editReply({ embeds: [embed], components });
    return;
  }

  if (sub === 'delete') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const ruleId = interaction.options.getString('rule-id', true);
    const existing = await dbNftRoleRules.getRuleById(guildId, ruleId);
    if (!existing) {
      await interaction.editReply({ content: 'Rule not found for this server.' });
      return;
    }
    await dbNftRoleRules.deleteRule(guildId, ruleId);
    await interaction.editReply({ content: `Deleted rule \`${ruleId}\`.` });
    return;
  }

  if (sub === 'toggle') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const ruleId = interaction.options.getString('rule-id', true);
    const existing = await dbNftRoleRules.getRuleById(guildId, ruleId);
    if (!existing) {
      await interaction.editReply({ content: 'Rule not found for this server.' });
      return;
    }
    await dbNftRoleRules.setRuleEnabled(guildId, ruleId, !existing.enabled);
    await interaction.editReply({ content: `Rule \`${ruleId}\` is now **${!existing.enabled ? 'enabled' : 'disabled'}**.` });
    return;
  }


  if (sub === 'run-now') {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    const summary = await runNftRoleSync(client, { guildId });
    if (summary.skipped) {
      await interaction.editReply({ content: 'Sync already running; try again shortly.' });
      return;
    }

    let desc =
      `**Rules scanned:** ${summary.rules}\n` +
      `**Granted:** ${summary.granted} · **Removed:** ${summary.revoked} · **Errors:** ${summary.errors}`;
    if (summary.walletCheckSkipped > 0) {
      desc += `\n**Wallet API unresolved** (members left unchanged): ${summary.walletCheckSkipped}`;
    }

    const revokeDiag = summary.revokeDiagBlocks || [];
    const grantDiag = summary.grantDiagBlocks || [];

    const diagSections = [];

    if (revokeDiag.length > 0) {
      const lines = [`**Removal diagnostics** (_Wallet_ = MultiversX API · _VA_ = Supabase)`];
      if (summary.revoked > revokeDiag.length) {
        lines.push(`_Showing ${revokeDiag.length} of ${summary.revoked} removals — see the notification channel for the rest._`);
      }
      lines.push(revokeDiag.join('\n---\n'));
      diagSections.push(lines.join('\n'));
    } else if (summary.revoked > 0) {
      diagSections.push(`**Removals:** ${summary.revoked} — see the rule’s notification channel for per-member diagnostics.`);
    }

    if (grantDiag.length > 0) {
      const lines = ['**Grant diagnostics**'];
      if (summary.granted > grantDiag.length) {
        lines.push(`_Showing ${grantDiag.length} of ${summary.granted} grants — remainder in notification channel._`);
      }
      lines.push(grantDiag.join('\n---\n'));
      diagSections.push(lines.join('\n'));
    }

    if (diagSections.length > 0) {
      desc += '\n\n' + diagSections.join('\n\n━━━━━━━━\n\n');
    }

    const maxDesc = 4000;
    if (desc.length > maxDesc) {
      desc = desc.slice(0, maxDesc - 60).trimEnd() + '\n… _(truncated for Discord)_';
    }

    const summaryEmbed = new EmbedBuilder()
      .setTitle('NFT role verification — sync finished')
      .setDescription(desc || '_No changes._')
      .setColor((summary.revoked || 0) > 0 ? 0xe67e22 : 0x57f287)
      .setTimestamp();

    await interaction.editReply({ embeds: [summaryEmbed] });
    return;
  }
}

async function handleNftRoleRuleSelectMenu(interaction) {
  if (interaction.customId !== SELECT_CUSTOM_ID) {
    return false;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'Use this in a server.', flags: [MessageFlags.Ephemeral] });
    return true;
  }

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    await interaction.reply({ content: 'Administrators only.', flags: [MessageFlags.Ephemeral] });
    return true;
  }

  const val = interaction.values[0] || '';
  const [action, ruleId] = val.split(':');
  if (!ruleId || action !== 'toggle') {
    await interaction.reply({ content: 'Invalid selection.', flags: [MessageFlags.Ephemeral] });
    return true;
  }

  await interaction.deferUpdate();

  const existing = await dbNftRoleRules.getRuleById(guildId, ruleId);
  if (!existing) {
    await interaction.followUp({ content: 'Rule no longer exists.', flags: [MessageFlags.Ephemeral] });
    return true;
  }

  await dbNftRoleRules.setRuleEnabled(guildId, ruleId, !existing.enabled);
  await interaction.followUp({
    content: `Rule \`${ruleId}\` is now **${!existing.enabled ? 'enabled' : 'disabled'}**.`,
    flags: [MessageFlags.Ephemeral]
  });
  return true;
}

module.exports = {
  handleNftRoleVerificationCommand,
  handleNftRoleRuleSelectMenu,
  SELECT_CUSTOM_ID
};
