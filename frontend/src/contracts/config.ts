// ─── Endereços na Sepolia ────────────────────────────────────────────────────
export const CONTRACTS = {
  BETTING: "0xB52F99A2e0eDE6131a617894729F914DdC26e740",
  TOKEN:   "0xB43488ad1A13299CC7768562c98Da1690DdDB891",
  DAO:     "0x511B8E18eE121066e808219e70429e5322e4be16",
} as const;

export const SEPOLIA_CHAIN_ID = 11155111n;
export const SEPOLIA_HEX      = "0xaa36a7";

// ─── ABIs (formato human-readable do ethers.js v6) ───────────────────────────

export const BETTING_ABI = [
  // views
  "function nextMarketId() view returns (uint256)",
  "function commissionPct() view returns (uint256)",
  "function accumulatedFees() view returns (uint256)",
  "function owner() view returns (address)",
  "function getMarketInfo(uint256 marketId) view returns (uint8 marketType, uint8 state, string winningGuess, uint256 totalPool, uint256 winnerPool, uint256 commission, uint256 betCount)",
  "function getBet(uint256 marketId, address bettor) view returns (string guess, uint256 amount)",
  "function hasClaimed(uint256 marketId, address bettor) view returns (bool)",
  // transactions
  "function placeBet(uint256 marketId, string calldata guess) payable",
  "function claimPrize(uint256 marketId)",
  // events
  "event MarketOpened(uint256 indexed marketId, uint8 marketType)",
  "event MarketClosed(uint256 indexed marketId)",
  "event MarketSettled(uint256 indexed marketId, string winningGuess, uint256 winnerPool, uint256 fee)",
  "event BetPlaced(uint256 indexed marketId, address indexed bettor, string guess, uint256 amount)",
  "event PrizeClaimed(uint256 indexed marketId, address indexed winner, uint256 prize)",
];

export const TOKEN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function getVotes(address account) view returns (uint256)",
  "function delegates(address account) view returns (address)",
  "function delegate(address delegatee)",
  "function mint(address to, uint256 amount)",
];

export const DAO_ABI = [
  // views
  "function nextProposalId() view returns (uint256)",
  "function votingDuration() view returns (uint256)",
  "function quorumBps() view returns (uint256)",
  "function owner() view returns (address)",
  "function hasVoted(uint256 proposalId, address voter) view returns (bool)",
  "function getProposal(uint256 id) view returns (uint8 proposalType, uint8 state, address proposer, string description, uint256 votingDeadline, uint256 votesFor, uint256 votesAgainst)",
  // token-holder transactions
  "function proposeSettleMarket(uint256 marketId, string calldata winningGuess, string calldata description) returns (uint256)",
  "function proposeSetCommission(uint256 newPct, string calldata description) returns (uint256)",
  "function proposeWithdrawFees(address payable to, string calldata description) returns (uint256)",
  "function vote(uint256 proposalId, bool support)",
  "function finalizeProposal(uint256 proposalId)",
  "function executeProposal(uint256 proposalId)",
  // admin
  "function adminOpenMarket(uint8 marketType) returns (uint256)",
  "function adminCloseMarket(uint256 marketId)",
  // events
  "event ProposalCreated(uint256 indexed id, uint8 proposalType, address indexed proposer, string description, uint256 deadline)",
  "event VoteCast(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight)",
  "event ProposalFinalized(uint256 indexed id, uint8 state)",
  "event ProposalExecuted(uint256 indexed id, uint8 proposalType)",
];
