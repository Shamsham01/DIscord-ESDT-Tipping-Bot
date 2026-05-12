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
    const role = interaction.options.getRole('role', true);
    const channel = interaction.options.getChannel('notification-channel', true);
    const collectionsRaw = interaction.options.getString('collections', true);
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
      enabled: true
    });

    const setupEmbed = new EmbedBuilder()
      .setTitle('NFT role verification created')
      .setDescription(
        'Members need **both** a linked wallet (`/set-wallet`) that satisfies the collection rule **and** matching **Virtual Account** inventory (listed/auctioned VA balance excluded; staked counts).'
      )
      .addFields(
        { name: 'Rule ID', value: `\`${rule.id}\``, inline: true },
        { name: 'Role', value: `<@&${role.id}>`, inline: true },
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
    await interaction.editReply({
      content: `Sync finished. Rules: ${summary.rules}, granted: ${summary.granted}, removed: ${summary.revoked}, errors: ${summary.errors}` +
        (summary.walletCheckSkipped
          ? `, wallet checks skipped (API/rate limit): ${summary.walletCheckSkipped}`
          : '') +
        '.'
    });
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
