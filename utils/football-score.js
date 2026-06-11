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
    ['IN_PLAY', 'PAUSED', 'HALFTIME'].includes(apiData.status)
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

function buildMatchUpdateFromApi(apiData, currentMatch) {
  const newStatus = apiData.status;
  const extractedScore = extractFtScoreFromApi(apiData);
  const currentScore = currentMatch?.ftScore;
  const hasValidCurrent = isValidFtScore(currentScore);
  const hasValidExtracted = isValidFtScore(extractedScore);

  const statusChanged = newStatus !== currentMatch.status;
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
  buildMatchUpdateFromApi
};
