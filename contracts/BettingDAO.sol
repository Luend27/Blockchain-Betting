// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BettingToken.sol";
import "./WorldCupBetting.sol";

/**
 * @title BettingDAO
 * @notice DAO de governança acoplada ao WorldCupBetting.
 *
 * Arquitetura:
 *  - BettingDAO é o OWNER de WorldCupBetting após o deploy (ver script).
 *  - O admin da DAO (owner) pode abrir/fechar mercados diretamente.
 *  - Decisões estratégicas (liquidar mercado, alterar taxa, sacar taxas)
 *    exigem proposta aprovada pelos detentores de BGT.
 *
 * Fluxo de governança:
 *  1. Gestor cria proposta via proposeSettleMarket / proposeSetCommission / proposeWithdrawFees.
 *  2. Token holders votam durante o período de votação (baseado em snapshot de bloco).
 *  3. Qualquer um chama finalizeProposal() após o prazo para registrar o resultado.
 *  4. Se aprovada, qualquer um chama executeProposal() para executar a ação.
 *
 * Requisitos para aprovação:
 *  - Quorum: votos totais ≥ (totalSupply_snapshot × quorumBps / 10_000)
 *  - Maioria simples: votesFor > votesAgainst
 */
contract BettingDAO is Ownable, ReentrancyGuard {
    // ─────────────────────────────────────────────────
    //  Tipos
    // ─────────────────────────────────────────────────

    enum ProposalType  { SETTLE_MARKET, SET_COMMISSION, WITHDRAW_FEES }
    enum ProposalState { ACTIVE, PASSED, REJECTED, EXECUTED }

    struct Proposal {
        uint256       id;
        ProposalType  proposalType;
        ProposalState state;
        address       proposer;
        string        description;
        uint256       votingDeadline; // timestamp Unix
        uint256       snapshotBlock;  // bloco de referência para ERC20Votes
        uint256       votesFor;
        uint256       votesAgainst;
        bytes         params;         // parâmetros codificados via abi.encode
    }

    // ─────────────────────────────────────────────────
    //  Estado
    // ─────────────────────────────────────────────────

    BettingToken    public token;
    WorldCupBetting public betting;

    uint256 public votingDuration; // segundos
    uint256 public quorumBps;      // basis points sobre totalSupply (ex.: 1000 = 10%)

    uint256 public nextProposalId;

    mapping(uint256 => Proposal)                    public proposals;
    mapping(uint256 => mapping(address => bool))    public hasVoted;

    // ─────────────────────────────────────────────────
    //  Eventos
    // ─────────────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed id,
        ProposalType proposalType,
        address indexed proposer,
        string description,
        uint256 deadline
    );
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight
    );
    event ProposalFinalized(uint256 indexed id, ProposalState state);
    event ProposalExecuted(uint256 indexed id, ProposalType proposalType);
    event VotingDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event QuorumUpdated(uint256 oldBps, uint256 newBps);

    // ─────────────────────────────────────────────────
    //  Modificadores
    // ─────────────────────────────────────────────────

    modifier onlyTokenHolder() {
        require(token.balanceOf(msg.sender) > 0, "Sem tokens de governanca");
        _;
    }

    modifier proposalActive(uint256 id) {
        require(proposals[id].state == ProposalState.ACTIVE, "Proposta nao esta ativa");
        _;
    }

    // ─────────────────────────────────────────────────
    //  Construtor
    // ─────────────────────────────────────────────────

    /**
     * @param tokenAddr       Endereço do BettingToken (BGT).
     * @param bettingAddr     Endereço do WorldCupBetting (deve ter ownership transferido).
     * @param _votingDuration Duração do período de votação em segundos (ex.: 3 dias = 259200).
     * @param _quorumBps      Quorum mínimo em basis points (ex.: 1000 = 10% do supply).
     * @param admin           Endereço do administrador inicial da DAO.
     */
    constructor(
        address tokenAddr,
        address payable bettingAddr,
        uint256 _votingDuration,
        uint256 _quorumBps,
        address admin
    ) Ownable(admin) {
        require(tokenAddr   != address(0), "Token invalido");
        require(bettingAddr != address(0), "Betting invalido");
        require(_quorumBps  <= 10_000,     "Quorum acima de 100%");

        token          = BettingToken(tokenAddr);
        betting        = WorldCupBetting(bettingAddr);
        votingDuration = _votingDuration;
        quorumBps      = _quorumBps;
    }

    // ─────────────────────────────────────────────────
    //  Admin: operações diretas em WorldCupBetting
    // ─────────────────────────────────────────────────

    /**
     * @notice Abre um mercado de apostas (admin only).
     */
    function adminOpenMarket(WorldCupBetting.MarketType marketType)
        external
        onlyOwner
        returns (uint256)
    {
        return betting.openMarket(marketType);
    }

    /**
     * @notice Encerra apostas de um mercado (admin only).
     */
    function adminCloseMarket(uint256 marketId) external onlyOwner {
        betting.closeMarket(marketId);
    }

    /**
     * @notice Atualiza a duração do período de votação (admin only).
     */
    function setVotingDuration(uint256 newDuration) external onlyOwner {
        emit VotingDurationUpdated(votingDuration, newDuration);
        votingDuration = newDuration;
    }

    /**
     * @notice Atualiza o quorum mínimo (admin only).
     */
    function setQuorum(uint256 newBps) external onlyOwner {
        require(newBps <= 10_000, "Quorum acima de 100%");
        emit QuorumUpdated(quorumBps, newBps);
        quorumBps = newBps;
    }

    // ─────────────────────────────────────────────────
    //  Criação de propostas
    // ─────────────────────────────────────────────────

    /**
     * @notice Propõe oficializar o resultado de um mercado (oráculo descentralizado).
     * @param marketId     ID do mercado já fechado.
     * @param winningGuess Resultado a ser oficializado (ex.: "Brasil").
     * @param description  Texto descritivo exibido aos votantes.
     */
    function proposeSettleMarket(
        uint256 marketId,
        string calldata winningGuess,
        string calldata description
    ) external onlyTokenHolder returns (uint256) {
        return _createProposal(
            ProposalType.SETTLE_MARKET,
            description,
            abi.encode(marketId, winningGuess)
        );
    }

    /**
     * @notice Propõe alterar a taxa de comissão da plataforma.
     * @param newPct      Nova taxa em basis points (ex.: 500 = 5%).
     * @param description Texto descritivo da proposta.
     */
    function proposeSetCommission(
        uint256 newPct,
        string calldata description
    ) external onlyTokenHolder returns (uint256) {
        return _createProposal(
            ProposalType.SET_COMMISSION,
            description,
            abi.encode(newPct)
        );
    }

    /**
     * @notice Propõe sacar as taxas acumuladas para um endereço.
     * @param to          Destinatário das taxas.
     * @param description Texto descritivo da proposta.
     */
    function proposeWithdrawFees(
        address payable to,
        string calldata description
    ) external onlyTokenHolder returns (uint256) {
        require(to != address(0), "Destinatario invalido");
        return _createProposal(
            ProposalType.WITHDRAW_FEES,
            description,
            abi.encode(to)
        );
    }

    // ─────────────────────────────────────────────────
    //  Votação
    // ─────────────────────────────────────────────────

    /**
     * @notice Emite um voto em uma proposta ativa.
     * @param proposalId ID da proposta.
     * @param support    true = a favor, false = contra.
     *
     * O peso do voto é calculado via snapshot (ERC20Votes.getPastVotes),
     * prevenindo compra de tokens após a criação da proposta.
     */
    function vote(uint256 proposalId, bool support)
        external
        proposalActive(proposalId)
    {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp <= p.votingDeadline, "Prazo de votacao encerrado");
        require(!hasVoted[proposalId][msg.sender],    "Ja votou nesta proposta");

        uint256 weight = token.getPastVotes(msg.sender, p.snapshotBlock);
        require(weight > 0, "Sem poder de voto no bloco do snapshot");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.votesFor += weight;
        } else {
            p.votesAgainst += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    // ─────────────────────────────────────────────────
    //  Finalização e execução
    // ─────────────────────────────────────────────────

    /**
     * @notice Registra o resultado da votação após o prazo.
     *         Qualquer endereço pode chamar esta função.
     */
    function finalizeProposal(uint256 proposalId) external proposalActive(proposalId) {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp > p.votingDeadline, "Prazo ainda nao encerrou");

        uint256 totalVotes    = p.votesFor + p.votesAgainst;
        uint256 supplySnap    = token.getPastTotalSupply(p.snapshotBlock);
        uint256 quorumNeeded  = (supplySnap * quorumBps) / 10_000;

        bool quorumReached = totalVotes >= quorumNeeded;
        bool majorityFor   = p.votesFor > p.votesAgainst;

        p.state = (quorumReached && majorityFor)
            ? ProposalState.PASSED
            : ProposalState.REJECTED;

        emit ProposalFinalized(proposalId, p.state);
    }

    /**
     * @notice Executa uma proposta aprovada, acionando o WorldCupBetting.
     *         Qualquer endereço pode chamar esta função.
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.PASSED, "Proposta nao aprovada");

        p.state = ProposalState.EXECUTED;

        if (p.proposalType == ProposalType.SETTLE_MARKET) {
            (uint256 marketId, string memory winningGuess) =
                abi.decode(p.params, (uint256, string));
            betting.settleMarket(marketId, winningGuess);

        } else if (p.proposalType == ProposalType.SET_COMMISSION) {
            (uint256 newPct) = abi.decode(p.params, (uint256));
            betting.setCommission(newPct);

        } else if (p.proposalType == ProposalType.WITHDRAW_FEES) {
            address payable to = payable(abi.decode(p.params, (address)));
            betting.withdrawFees(to);
        }

        emit ProposalExecuted(proposalId, p.proposalType);
    }

    // ─────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────

    function getProposal(uint256 id)
        external
        view
        returns (
            ProposalType  proposalType,
            ProposalState state,
            address       proposer,
            string memory description,
            uint256       votingDeadline,
            uint256       votesFor,
            uint256       votesAgainst
        )
    {
        Proposal storage p = proposals[id];
        return (
            p.proposalType,
            p.state,
            p.proposer,
            p.description,
            p.votingDeadline,
            p.votesFor,
            p.votesAgainst
        );
    }

    // ─────────────────────────────────────────────────
    //  Interno
    // ─────────────────────────────────────────────────

    function _createProposal(
        ProposalType pType,
        string calldata description,
        bytes memory params
    ) internal returns (uint256 id) {
        id = nextProposalId++;

        // Usa o bloco anterior como snapshot para evitar manipulação no mesmo bloco
        uint256 snapshot = block.number > 0 ? block.number - 1 : 0;

        proposals[id] = Proposal({
            id:             id,
            proposalType:   pType,
            state:          ProposalState.ACTIVE,
            proposer:       msg.sender,
            description:    description,
            votingDeadline: block.timestamp + votingDuration,
            snapshotBlock:  snapshot,
            votesFor:       0,
            votesAgainst:   0,
            params:         params
        });

        emit ProposalCreated(id, pType, msg.sender, description, block.timestamp + votingDuration);
    }
}
