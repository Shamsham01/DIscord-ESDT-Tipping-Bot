const supabase = require('../supabase-client');

// Lottery functions
async function createLottery(guildId, lotteryId, lotteryData) {
  try {
    const { error } = await supabase
      .from('lotteries')
      .insert({
        lottery_id: lotteryId,
        guild_id: guildId,
        winning_numbers_count: lotteryData.winningNumbersCount,
        total_pool_numbers: lotteryData.totalPoolNumbers,
        token_identifier: lotteryData.tokenIdentifier,
        token_ticker: lotteryData.tokenTicker,
        drawing_frequency: lotteryData.drawingFrequency,
        house_commission_percent: lotteryData.houseCommissionPercent || 0,
        ticket_price_wei: lotteryData.ticketPriceWei,
        prize_pool_wei: lotteryData.prizePoolWei || '0',
        prize_pool_usd: lotteryData.prizePoolUsd || 0,
        start_time: lotteryData.startTime,
        end_time: lotteryData.endTime,
        next_draw_time: lotteryData.nextDrawTime,
        status: lotteryData.status || 'LIVE',
        has_winners: lotteryData.hasWinners || false,
        winning_numbers: lotteryData.winningNumbers || null,
        channel_id: lotteryData.channelId || null,
        message_id: lotteryData.messageId || null,
        thread_id: lotteryData.threadId || null,
        total_tickets: lotteryData.totalTickets || 0,
        unique_participants: lotteryData.uniqueParticipants || 0,
        is_rollover: lotteryData.isRollover || false,
        original_lottery_id: lotteryData.originalLotteryId || null,
        rollover_count: lotteryData.rolloverCount || 0
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating lottery:', error);
    throw error;
  }
}

async function getLottery(guildId, lotteryId) {
  try {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .eq('guild_id', guildId)
      .eq('lottery_id', lotteryId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    
    return {
      lotteryId: data.lottery_id,
      guildId: data.guild_id,
      winningNumbersCount: data.winning_numbers_count,
      totalPoolNumbers: data.total_pool_numbers,
      tokenIdentifier: data.token_identifier,
      tokenTicker: data.token_ticker,
      drawingFrequency: data.drawing_frequency,
      houseCommissionPercent: data.house_commission_percent,
      ticketPriceWei: data.ticket_price_wei,
      prizePoolWei: data.prize_pool_wei,
      prizePoolUsd: data.prize_pool_usd,
      startTime: data.start_time,
      endTime: data.end_time,
      nextDrawTime: data.next_draw_time,
      status: data.status,
      hasWinners: data.has_winners,
      winningNumbers: data.winning_numbers,
      channelId: data.channel_id,
      messageId: data.message_id,
      threadId: data.thread_id,
      totalTickets: data.total_tickets,
      uniqueParticipants: data.unique_participants,
      isRollover: data.is_rollover,
      originalLotteryId: data.original_lottery_id,
      rolloverCount: data.rollover_count,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error('[DB] Error getting lottery:', error);
    throw error;
  }
}

async function getActiveLotteries(guildId) {
  try {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .eq('guild_id', guildId)
      .eq('status', 'LIVE')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    const lotteries = {};
    (data || []).forEach(row => {
      lotteries[row.lottery_id] = {
        lotteryId: row.lottery_id,
        guildId: row.guild_id,
        winningNumbersCount: row.winning_numbers_count,
        totalPoolNumbers: row.total_pool_numbers,
        tokenIdentifier: row.token_identifier,
        tokenTicker: row.token_ticker,
        drawingFrequency: row.drawing_frequency,
        houseCommissionPercent: row.house_commission_percent,
        ticketPriceWei: row.ticket_price_wei,
        prizePoolWei: row.prize_pool_wei,
        prizePoolUsd: row.prize_pool_usd,
        startTime: row.start_time,
        endTime: row.end_time,
        nextDrawTime: row.next_draw_time,
        status: row.status,
        hasWinners: row.has_winners,
        winningNumbers: row.winning_numbers,
        channelId: row.channel_id,
        messageId: row.message_id,
        threadId: row.thread_id,
        totalTickets: row.total_tickets,
        uniqueParticipants: row.unique_participants,
        isRollover: row.is_rollover,
        originalLotteryId: row.original_lottery_id,
        rolloverCount: row.rollover_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
    return lotteries;
  } catch (error) {
    console.error('[DB] Error getting active lotteries:', error);
    throw error;
  }
}

async function getAllLotteriesForDrawCheck() {
  try {
    const { data, error } = await supabase
      .from('lotteries')
      .select('*')
      .eq('status', 'LIVE')
      .lte('next_draw_time', Date.now());
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      lotteryId: row.lottery_id,
      guildId: row.guild_id,
      winningNumbersCount: row.winning_numbers_count,
      totalPoolNumbers: row.total_pool_numbers,
      tokenIdentifier: row.token_identifier,
      tokenTicker: row.token_ticker,
      drawingFrequency: row.drawing_frequency,
      houseCommissionPercent: row.house_commission_percent,
      ticketPriceWei: row.ticket_price_wei,
      prizePoolWei: row.prize_pool_wei,
      prizePoolUsd: row.prize_pool_usd,
      startTime: row.start_time,
      endTime: row.end_time,
      nextDrawTime: row.next_draw_time,
      status: row.status,
      hasWinners: row.has_winners,
      winningNumbers: row.winning_numbers,
      channelId: row.channel_id,
      messageId: row.message_id,
      threadId: row.thread_id,
      totalTickets: row.total_tickets,
      uniqueParticipants: row.unique_participants,
      isRollover: row.is_rollover,
      originalLotteryId: row.original_lottery_id,
      rolloverCount: row.rollover_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (error) {
    console.error('[DB] Error getting lotteries for draw check:', error);
    throw error;
  }
}

async function updateLotteryStatusAtomically(guildId, lotteryId, expectedStatus, newStatus) {
  try {
    // Atomically update status only if it matches expectedStatus
    // This prevents race conditions when multiple processes try to process the same lottery
    const { data, error } = await supabase
      .from('lotteries')
      .update({ 
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('guild_id', guildId)
      .eq('lottery_id', lotteryId)
      .eq('status', expectedStatus)
      .select('lottery_id');
    
    if (error) throw error;
    
    // If data is returned, the update succeeded (status matched expectedStatus)
    // If data is empty, another process already changed the status
    return data && data.length > 0;
  } catch (error) {
    console.error('[DB] Error atomically updating lottery status:', error);
    throw error;
  }
}

async function updateLottery(guildId, lotteryId, lotteryData) {
  try {
    const updateData = {
      updated_at: new Date().toISOString()
    };
    
    if (lotteryData.ticketPriceWei !== undefined) updateData.ticket_price_wei = lotteryData.ticketPriceWei;
    if (lotteryData.prizePoolWei !== undefined) updateData.prize_pool_wei = lotteryData.prizePoolWei;
    if (lotteryData.prizePoolUsd !== undefined) updateData.prize_pool_usd = lotteryData.prizePoolUsd;
    if (lotteryData.endTime !== undefined) updateData.end_time = lotteryData.endTime;
    if (lotteryData.nextDrawTime !== undefined) updateData.next_draw_time = lotteryData.nextDrawTime;
    if (lotteryData.status !== undefined) updateData.status = lotteryData.status;
    if (lotteryData.hasWinners !== undefined) updateData.has_winners = lotteryData.hasWinners;
    if (lotteryData.winningNumbers !== undefined) updateData.winning_numbers = lotteryData.winningNumbers;
    if (lotteryData.totalTickets !== undefined) updateData.total_tickets = lotteryData.totalTickets;
    if (lotteryData.uniqueParticipants !== undefined) updateData.unique_participants = lotteryData.uniqueParticipants;
    if (lotteryData.rolloverCount !== undefined) updateData.rollover_count = lotteryData.rolloverCount;
    if (lotteryData.channelId !== undefined) updateData.channel_id = lotteryData.channelId;
    if (lotteryData.messageId !== undefined) updateData.message_id = lotteryData.messageId;
    if (lotteryData.threadId !== undefined) updateData.thread_id = lotteryData.threadId;
    
    const { error } = await supabase
      .from('lotteries')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('lottery_id', lotteryId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating lottery:', error);
    throw error;
  }
}

// Ticket functions
async function createTicket(guildId, ticketId, ticketData) {
  try {
    const { error } = await supabase
      .from('lottery_tickets')
      .insert({
        ticket_id: ticketId,
        guild_id: guildId,
        lottery_id: ticketData.lotteryId,
        user_id: ticketData.userId,
        user_tag: ticketData.userTag || null,
        numbers: ticketData.numbers,
        token_identifier: ticketData.tokenIdentifier,
        token_ticker: ticketData.tokenTicker,
        ticket_price_wei: ticketData.ticketPriceWei,
        status: ticketData.status || 'LIVE',
        is_winner: ticketData.isWinner || false,
        matched_numbers: ticketData.matchedNumbers || 0,
        created_at: ticketData.createdAt,
        expired_at: ticketData.expiredAt || null
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating ticket:', error);
    throw error;
  }
}

async function getTicketsByLottery(guildId, lotteryId) {
  try {
    // Supabase defaults to 1000 rows, so we need to paginate to get all tickets
    const tickets = {};
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('lottery_tickets')
        .select('*')
        .eq('guild_id', guildId)
        .eq('lottery_id', lotteryId)
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        data.forEach(row => {
          tickets[row.ticket_id] = {
            ticketId: row.ticket_id,
            guildId: row.guild_id,
            lotteryId: row.lottery_id,
            userId: row.user_id,
            userTag: row.user_tag,
            numbers: row.numbers,
            tokenIdentifier: row.token_identifier,
            tokenTicker: row.token_ticker,
            ticketPriceWei: row.ticket_price_wei,
            status: row.status,
            isWinner: row.is_winner,
            matchedNumbers: row.matched_numbers,
            createdAt: row.created_at,
            expiredAt: row.expired_at
          };
        });
        
        // If we got less than pageSize, we've reached the end
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          from += pageSize;
        }
      }
    }
    
    return tickets;
  } catch (error) {
    console.error('[DB] Error getting tickets by lottery:', error);
    throw error;
  }
}

async function getTicketsByUser(guildId, userId, tokenTicker = null, status = null, limit = 20, offset = 0) {
  try {
    let query = supabase
      .from('lottery_tickets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (tokenTicker) {
      // Check if tokenTicker is a full identifier (format: TICKER-6hexchars)
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (esdtIdentifierRegex.test(tokenTicker)) {
        // It's a full identifier, filter by token_identifier
        query = query.eq('token_identifier', tokenTicker);
      } else {
        // It's just a ticker, filter by token_ticker (backward compatibility)
        query = query.eq('token_ticker', tokenTicker);
      }
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      ticketId: row.ticket_id,
      guildId: row.guild_id,
      lotteryId: row.lottery_id,
      userId: row.user_id,
      userTag: row.user_tag,
      numbers: row.numbers,
      tokenIdentifier: row.token_identifier,
      tokenTicker: row.token_ticker,
      ticketPriceWei: row.ticket_price_wei,
      status: row.status,
      isWinner: row.is_winner,
      matchedNumbers: row.matched_numbers,
      createdAt: row.created_at,
      expiredAt: row.expired_at
    }));
  } catch (error) {
    console.error('[DB] Error getting tickets by user:', error);
    throw error;
  }
}

async function getTicketsCountByLottery(guildId, lotteryId, status = null) {
  try {
    let query = supabase
      .from('lottery_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('lottery_id', lotteryId);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { count, error } = await query;
    
    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('[DB] Error getting tickets count by lottery:', error);
    throw error;
  }
}

async function getTicketsCountByUser(guildId, userId, tokenTicker = null, status = null) {
  try {
    let query = supabase
      .from('lottery_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (tokenTicker) {
      // Check if tokenTicker is a full identifier (format: TICKER-6hexchars)
      const esdtIdentifierRegex = /^[A-Z0-9]+-[a-f0-9]{6}$/i;
      if (esdtIdentifierRegex.test(tokenTicker)) {
        // It's a full identifier, filter by token_identifier
        query = query.eq('token_identifier', tokenTicker);
      } else {
        // It's just a ticker, filter by token_ticker (backward compatibility)
        query = query.eq('token_ticker', tokenTicker);
      }
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { count, error } = await query;
    
    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('[DB] Error getting tickets count by user:', error);
    throw error;
  }
}

async function getWinningTickets(guildId, lotteryId, winningNumbers) {
  try {
    // Get all tickets for this lottery
    const { data, error } = await supabase
      .from('lottery_tickets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('lottery_id', lotteryId)
      .eq('status', 'LIVE');
    
    if (error) throw error;
    
    // Filter tickets that match winning numbers (100% match required)
    const winningTickets = [];
    const winningNumbersSorted = [...winningNumbers].sort((a, b) => a - b);
    
    (data || []).forEach(row => {
      const ticketNumbers = [...row.numbers].sort((a, b) => a - b);
      
      // Check if arrays match exactly
      if (ticketNumbers.length === winningNumbersSorted.length &&
          ticketNumbers.every((num, idx) => num === winningNumbersSorted[idx])) {
        winningTickets.push({
          ticketId: row.ticket_id,
          guildId: row.guild_id,
          lotteryId: row.lottery_id,
          userId: row.user_id,
          userTag: row.user_tag,
          numbers: row.numbers,
          tokenIdentifier: row.token_identifier,
          tokenTicker: row.token_ticker,
          ticketPriceWei: row.ticket_price_wei,
          status: row.status,
          isWinner: true,
          matchedNumbers: winningNumbersSorted.length,
          createdAt: row.created_at,
          expiredAt: row.expired_at
        });
      }
    });
    
    return winningTickets;
  } catch (error) {
    console.error('[DB] Error getting winning tickets:', error);
    throw error;
  }
}

async function updateTicketStatus(guildId, ticketId, status, isWinner = false, matchedNumbers = 0) {
  try {
    const { error } = await supabase
      .from('lottery_tickets')
      .update({
        status: status,
        is_winner: isWinner,
        matched_numbers: matchedNumbers,
        expired_at: status === 'EXPIRED' ? Date.now() : null
      })
      .eq('guild_id', guildId)
      .eq('ticket_id', ticketId);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating ticket status:', error);
    throw error;
  }
}

async function updateTicketsForLottery(guildId, lotteryId, status, expiredAt = null) {
  try {
    const updateData = {
      status: status,
      expired_at: expiredAt || Date.now()
    };
    
    const { error } = await supabase
      .from('lottery_tickets')
      .update(updateData)
      .eq('guild_id', guildId)
      .eq('lottery_id', lotteryId)
      .eq('status', 'LIVE');
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error updating tickets for lottery:', error);
    throw error;
  }
}

// Winner functions
async function createWinner(guildId, winnerData) {
  try {
    const { error } = await supabase
      .from('lottery_winners')
      .insert({
        lottery_id: winnerData.lotteryId,
        guild_id: guildId,
        user_id: winnerData.userId,
        user_tag: winnerData.userTag || null,
        ticket_id: winnerData.ticketId,
        token_identifier: winnerData.tokenIdentifier,
        token_ticker: winnerData.tokenTicker,
        prize_amount_wei: winnerData.prizeAmountWei,
        prize_amount_usd: winnerData.prizeAmountUsd || 0,
        winning_numbers: winnerData.winningNumbers,
        ticket_numbers: winnerData.ticketNumbers
      });
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('[DB] Error creating winner:', error);
    throw error;
  }
}

async function getWinnersByLottery(guildId, lotteryId = null) {
  try {
    let query = supabase
      .from('lottery_winners')
      .select('*')
      .eq('guild_id', guildId);
    
    if (lotteryId) {
      query = query.eq('lottery_id', lotteryId);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      lotteryId: row.lottery_id,
      guildId: row.guild_id,
      userId: row.user_id,
      userTag: row.user_tag,
      ticketId: row.ticket_id,
      tokenIdentifier: row.token_identifier,
      tokenTicker: row.token_ticker,
      prizeAmountWei: row.prize_amount_wei,
      prizeAmountUsd: row.prize_amount_usd,
      winningNumbers: row.winning_numbers,
      ticketNumbers: row.ticket_numbers,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error('[DB] Error getting winners by lottery:', error);
    throw error;
  }
}

async function getUserLotteryStats(guildId, userId) {
  try {
    const { data, error } = await supabase
      .from('lottery_tickets')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (error) throw error;
    
    const tickets = data || [];
    const totalTickets = tickets.length;
    let totalSpent = '0';
    let totalWon = '0';
    const BigNumber = require('bignumber.js');
    
    tickets.forEach(ticket => {
      const priceBN = new BigNumber(ticket.ticket_price_wei || '0');
      totalSpent = new BigNumber(totalSpent).plus(priceBN).toString();
    });
    
    // Get winners
    const { data: winnersData, error: winnersError } = await supabase
      .from('lottery_winners')
      .select('prize_amount_wei')
      .eq('guild_id', guildId)
      .eq('user_id', userId);
    
    if (!winnersError && winnersData) {
      winnersData.forEach(winner => {
        const prizeBN = new BigNumber(winner.prize_amount_wei || '0');
        totalWon = new BigNumber(totalWon).plus(prizeBN).toString();
      });
    }
    
    const wins = tickets.filter(t => t.is_winner).length;
    
    return {
      totalTickets,
      totalSpent,
      totalWon,
      wins,
      winRate: totalTickets > 0 ? (wins / totalTickets * 100).toFixed(2) : '0.00'
    };
  } catch (error) {
    console.error('[DB] Error getting user lottery stats:', error);
    throw error;
  }
}

module.exports = {
  createLottery,
  getLottery,
  getActiveLotteries,
  getAllLotteriesForDrawCheck,
  updateLottery,
  updateLotteryStatusAtomically,
  createTicket,
  getTicketsByLottery,
  getTicketsByUser,
  getTicketsCountByLottery,
  getTicketsCountByUser,
  getWinningTickets,
  updateTicketStatus,
  updateTicketsForLottery,
  createWinner,
  getWinnersByLottery,
  getUserLotteryStats
};

