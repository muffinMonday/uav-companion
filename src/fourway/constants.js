// Betaflight 4-way ESC identification (read-only): timing constants. Synthetic and mocked in every test; no hardware here.
export const FOURWAY_TIMINGS = Object.freeze({
  enterReplyMs: 1500,
  cmdMs: 600,
  initAttemptMs: 3000,
  initAttempts: 5,
  initSpacingMs: 250,
  readMs: 1000,
  resetMs: 1000,
  exitMs: 1500,
  exitAttempts: 3,
  overallMs: 45000,
});

export const EXPECTED_CHANNELS = 4;
