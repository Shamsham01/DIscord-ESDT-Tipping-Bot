/**
 * Football-Data.org score helpers.
 * API often returns fullTime: { home: null, away: null } while a match is live
 * or briefly after FT; null must never be treated as a valid score.
 */

function isValidFtScore(score) {
  if (!score || typeof score !== 'object') return false;
  const { home, away } = score;
  return (
    typeof home === 'number' &&
    typeof away === 'number' &&
    Number.isFinite(home) &&
    Number.isFinite(away) &&
    home >= 0 &&
    away >= 0
  );
}

function extractFtScoreFromApi(apiData) {
  if (!apiData) return null;

  const fullTime = apiData.score?.fullTime;
  if (isValidFtScore(fullTime)) {
    return { home: fullTime.home, away: fullTime.away };
  }

  const goals = Array.isArray(apiData.goals) ? apiData.goals : [];
  if (goals.length > 0) {
    const lastGoal = goals[goals.length - 1];
    if (isValidFtScore(lastGoal?.score)) {
      return { home: lastGoal.score.home, away: lastGoal.score.away };
    }
  }

  // Useful for live/halftime display when fullTime is still null
  const halfTime = apiData.score?.halfTime;
  if (
    isValidFtScore(halfTime) &&
    ['IN_PLAY', 'PAUSED', 'HALFTIME', 'LIVE'].includes(apiData.status)
  ) {
    return { home: halfTime.home, away: halfTime.away };
  }

  return null;
}

function deriveWinningOutcome(homeScore, awayScore) {
  if (homeScore > awayScore) return 'H';
  if (awayScore > homeScore) return 'A';
  return 'D';
}

function deriveWinningOutcomeFromApi(apiData) {
  const score = extractFtScoreFromApi(apiData);
  if (score) {
    return deriveWinningOutcome(score.home, score.away);
  }

  const winner = apiData?.score?.winner;
  if (winner === 'HOME_TEAM') return 'H';
  if (winner === 'AWAY_TEAM') return 'A';
  if (winner === 'DRAW') return 'D';

  return null;
}

function formatMatchScore(ftScore) {
  if (!isValidFtScore(ftScore)) return '—';
  return `${ftScore.home} - ${ftScore.away}`;
}

/** Map legacy/custom statuses to football-data.org equivalents. */
function normalizeMatchStatus(status) {
  if (status === 'LIVE') return 'IN_PLAY';
  return status;
}

function isInProgressMatchStatus(status) {
  return ['IN_PLAY', 'LIVE', 'PAUSED'].includes(status);
}

function buildMatchUpdateFromApi(apiData, currentMatch) {
  const newStatus = normalizeMatchStatus(apiData.status);
  const currentStatus = normalizeMatchStatus(currentMatch?.status);
  const extractedScore = extractFtScoreFromApi(apiData);
  const currentScore = currentMatch?.ftScore;
  const hasValidCurrent = isValidFtScore(currentScore);
  const hasValidExtracted = isValidFtScore(extractedScore);

  // Also rewrite legacy LIVE rows to IN_PLAY even when the API status is unchanged
  const statusChanged =
    newStatus !== currentStatus || currentMatch?.status === 'LIVE';
  const scoreChanged =
    hasValidExtracted &&
    (!hasValidCurrent ||
      currentScore.home !== extractedScore.home ||
      currentScore.away !== extractedScore.away);

  const updates = {};
  if (statusChanged) updates.status = newStatus;
  if (hasValidExtracted && scoreChanged) {
    updates.ftScore = extractedScore;
  }

  return {
    newStatus,
    extractedScore,
    scoreChanged,
    statusChanged,
    updates,
    hasValidScore: hasValidExtracted || hasValidCurrent
  };
}

module.exports = {
  isValidFtScore,
  extractFtScoreFromApi,
  deriveWinningOutcome,
  deriveWinningOutcomeFromApi,
  formatMatchScore,
  normalizeMatchStatus,
  isInProgressMatchStatus,
  buildMatchUpdateFromApi
};
