const BigNumber = require('bignumber.js');

/**
 * Parse drawing frequency string to milliseconds
 * @param {string} frequency - "1h", "1d", "1W", "1M"
 * @returns {number} Milliseconds
 */
function parseFrequency(frequency) {
  const match = frequency.match(/^(\d+)([hdWM])$/i);
  if (!match) {
    throw new Error(`Invalid frequency format: ${frequency}. Use format like "1h", "1d", "1W", "1M"`);
  }
  
  const amount = parseInt(match[1]);
  const unit = match[2].toUpperCase();
  
  const multipliers = {
    'H': 60 * 60 * 1000,      // hours to milliseconds
    'D': 24 * 60 * 60 * 1000,  // days to milliseconds
    'W': 7 * 24 * 60 * 60 * 1000, // weeks to milliseconds
    'M': 30 * 24 * 60 * 60 * 1000  // months to milliseconds (approximate)
  };
  
  if (!multipliers[unit]) {
    throw new Error(`Invalid frequency unit: ${unit}. Use h, d, W, or M`);
  }
  
  return amount * multipliers[unit];
}

/**
 * Generate random winning numbers
 * @param {number} count - Number of numbers to generate
 * @param {number} poolSize - Total pool size (e.g., 49)
 * @returns {number[]} Sorted array of unique random numbers
 */
function generateRandomNumbers(count, poolSize) {
  if (count > poolSize) {
    throw new Error(`Cannot generate ${count} numbers from pool of ${poolSize}`);
  }
  
  const numbers = new Set();
  while (numbers.size < count) {
    const num = Math.floor(Math.random() * poolSize) + 1; // 1 to poolSize
    numbers.add(num);
  }
  
  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Validate ticket numbers
 * @param {number[]} numbers - Array of numbers to validate
 * @param {number} count - Expected count
 * @param {number} poolSize - Maximum pool size
 * @returns {object} { valid: boolean, error: string }
 */
function validateTicketNumbers(numbers, count, poolSize) {
  // Check if array
  if (!Array.isArray(numbers)) {
    return { valid: false, error: 'Numbers must be an array' };
  }
  
  // Check count
  if (numbers.length !== count) {
    return { valid: false, error: `Must provide exactly ${count} numbers` };
  }
  
  // Check for duplicates
  const uniqueNumbers = new Set(numbers);
  if (uniqueNumbers.size !== numbers.length) {
    return { valid: false, error: 'Duplicate numbers are not allowed' };
  }
  
  // Check range
  for (const num of numbers) {
    if (!Number.isInteger(num) || num < 1 || num > poolSize) {
      return { valid: false, error: `Numbers must be integers between 1 and ${poolSize}` };
    }
  }
  
  return { valid: true, error: null };
}

/**
 * Check if ticket matches winning numbers (100% match required)
 * @param {number[]} ticketNumbers - Ticket numbers
 * @param {number[]} winningNumbers - Winning numbers
 * @returns {object} { isWinner: boolean, matchedCount: number }
 */
function checkTicketMatch(ticketNumbers, winningNumbers) {
  if (!Array.isArray(ticketNumbers) || !Array.isArray(winningNumbers)) {
    return { isWinner: false, matchedCount: 0 };
  }
  
  // Convert to Sets for efficient lookup
  const ticketSet = new Set(ticketNumbers);
  const winningSet = new Set(winningNumbers);
  
  // Count how many ticket numbers appear in winning numbers
  let matchedCount = 0;
  for (const num of ticketSet) {
    if (winningSet.has(num)) {
      matchedCount++;
    }
  }
  
  // 100% match required (all ticket numbers must match all winning numbers)
  const isWinner = matchedCount === winningNumbers.length && 
                   matchedCount === ticketNumbers.length &&
                   ticketNumbers.length === winningNumbers.length;
  
  return { isWinner, matchedCount };
}

/**
 * Calculate prize pool from tickets
 * @param {Array} tickets - Array of ticket objects with ticketPriceWei
 * @returns {string} Total prize pool in wei
 */
function calculatePrizePool(tickets) {
  const total = tickets.reduce((sum, ticket) => {
    const priceBN = new BigNumber(ticket.ticketPriceWei || '0');
    return sum.plus(priceBN);
  }, new BigNumber('0'));
  
  return total.toString();
}

/**
 * Calculate prize distribution per winner with commission
 * @param {string} totalPrizeWei - Total prize pool in wei
 * @param {number} winnerCount - Number of winners
 * @param {number} commissionPercent - House commission percentage (e.g., 5 for 5%)
 * @returns {object} { prizePerWinner: string, commission: string, netPrize: string }
 */
function calculatePrizeDistribution(totalPrizeWei, winnerCount, commissionPercent = 0) {
  if (winnerCount === 0) {
    return {
      prizePerWinner: '0',
      commission: '0',
      netPrize: '0'
    };
  }
  
  const totalBN = new BigNumber(totalPrizeWei);
  const commissionBN = totalBN.multipliedBy(commissionPercent / 100);
  const netPrizeBN = totalBN.minus(commissionBN);
  const prizePerWinnerBN = netPrizeBN.dividedBy(winnerCount);
  
  return {
    prizePerWinner: prizePerWinnerBN.integerValue(BigNumber.ROUND_DOWN).toString(),
    commission: commissionBN.integerValue(BigNumber.ROUND_DOWN).toString(),
    netPrize: netPrizeBN.integerValue(BigNumber.ROUND_DOWN).toString()
  };
}

/**
 * Format numbers array as comma-separated string for display
 * @param {number[]} numbers - Array of numbers
 * @returns {string} Comma-separated string
 */
function formatNumbersForDisplay(numbers) {
  if (!Array.isArray(numbers)) {
    return '';
  }
  return numbers.sort((a, b) => a - b).join(', ');
}

/**
 * Parse comma-separated string to numbers array
 * @param {string} numbersString - Comma-separated string like "1, 5, 12, 23, 45"
 * @returns {number[]} Array of numbers
 */
function parseNumbersFromString(numbersString) {
  if (!numbersString || typeof numbersString !== 'string') {
    return [];
  }
  
  return numbersString
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n));
}

module.exports = {
  parseFrequency,
  generateRandomNumbers,
  validateTicketNumbers,
  checkTicketMatch,
  calculatePrizePool,
  calculatePrizeDistribution,
  formatNumbersForDisplay,
  parseNumbersFromString
};

