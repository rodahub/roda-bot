// Shared mutable state — all modules reference this same object.
// Never destructure data/teams into local vars that outlive a function call.
const state = {
  data: null,
  teams: null,
  pendingReportProof: new Map(),
  registrationStatusUpdateQueue: Promise.resolve(),
  leaderboardUpdateQueue: Promise.resolve()
};

module.exports = state;
