const supabase = require('../supabase-client');

/**
 * Insert a swap transaction record
 * @param {Object} swapData
 * @param {string} swapData.guildId
 * @param {string} swapData.userId
 * @param {string} swapData.fromToken
 * @param {string} swapData.toToken
 * @param {string} swapData.amountSold
 * @param {string} swapData.amountReceived
 * @param {number} swapData.slippagePercentage
 * @param {string} [swapData.transactionHash]
 * @param {string} swapData.status - 'completed' | 'failed' | 'refunded'
 * @param {string} [swapData.deductionTransactionId]
 * @param {string} [swapData.additionTransactionId]
 */
async function insertSwapTransaction(swapData) {
  try {
    const { error } = await supabase
      .from('swap_transactions')
      .insert({
        guild_id: swapData.guildId,
        user_id: swapData.userId,
        from_token: swapData.fromToken,
        to_token: swapData.toToken,
        amount_sold: swapData.amountSold,
        amount_received: swapData.amountReceived,
        slippage_percentage: swapData.slippagePercentage,
        transaction_hash: swapData.transactionHash || null,
        status: swapData.status,
        deduction_transaction_id: swapData.deductionTransactionId || null,
        addition_transaction_id: swapData.additionTransactionId || null,
        completed_at: swapData.status === 'completed' ? new Date().toISOString() : null
      });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('[DB] Error inserting swap transaction:', error);
    throw error;
  }
}

module.exports = {
  insertSwapTransaction
};
