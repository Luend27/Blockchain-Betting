// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WorldCupBetting
 * @notice Sistema de apostas descentralizado para a Copa do Mundo.
 *         Gerencia pools para "Seleção Campeã" e "Artilheiro" com
 *         distribuição proporcional de prêmios e taxa de plataforma.
 */
contract WorldCupBetting is ReentrancyGuard, Ownable {
    // ─────────────────────────────────────────────────
    //  Tipos e constantes
    // ─────────────────────────────────────────────────

    uint256 public constant MAX_COMMISSION = 1000; // 10% em basis points
    uint256 public constant BASIS_POINTS    = 10_000;

    enum MarketType { CHAMPION, TOP_SCORER }
    enum MarketState { OPEN, CLOSED, SETTLED }

    struct Bet {
        string  guess;   // ex.: "Brasil" ou "Vinicius Jr."
        uint256 amount;
    }

    struct Market {
        MarketType  marketType;
        MarketState state;
        string      winningGuess;   // preenchido ao liquidar
        uint256     totalPool;
        uint256     winnerPool;     // soma das apostas vencedoras
        uint256     commissionPct;  // basis points (ex.: 300 = 3%)
        address[]   bettors;
        mapping(address => Bet) bets;
        mapping(address => bool) hasClaimed;
    }

    // ─────────────────────────────────────────────────
    //  Estado
    // ─────────────────────────────────────────────────

    uint256 public nextMarketId;
    uint256 public commissionPct; // basis points padrão
    uint256 public accumulatedFees;

    mapping(uint256 => Market) private markets;

    // ─────────────────────────────────────────────────
    //  Eventos
    // ─────────────────────────────────────────────────

    event MarketOpened(uint256 indexed marketId, MarketType marketType);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, string guess, uint256 amount);
    event MarketClosed(uint256 indexed marketId);
    event MarketSettled(uint256 indexed marketId, string winningGuess, uint256 winnerPool, uint256 fee);
    event PrizeClaimed(uint256 indexed marketId, address indexed winner, uint256 prize);
    event CommissionUpdated(uint256 oldPct, uint256 newPct);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────
    //  Modificadores
    // ─────────────────────────────────────────────────

    modifier marketExists(uint256 marketId) {
        require(marketId < nextMarketId, "Mercado inexistente");
        _;
    }

    modifier onlyOpen(uint256 marketId) {
        require(markets[marketId].state == MarketState.OPEN, "Mercado nao esta aberto");
        _;
    }

    modifier onlySettled(uint256 marketId) {
        require(markets[marketId].state == MarketState.SETTLED, "Mercado ainda nao liquidado");
        _;
    }

    // ─────────────────────────────────────────────────
    //  Construtor
    // ─────────────────────────────────────────────────

    /**
     * @param _commissionPct Taxa inicial em basis points (ex.: 300 = 3%).
     */
    constructor(uint256 _commissionPct) Ownable(msg.sender) {
        require(_commissionPct <= MAX_COMMISSION, "Taxa acima do limite");
        commissionPct = _commissionPct;
    }

    // ─────────────────────────────────────────────────
    //  Administração
    // ─────────────────────────────────────────────────

    /**
     * @notice Abre um novo mercado de apostas.
     * @param marketType Tipo do mercado (CHAMPION ou TOP_SCORER).
     * @return marketId Identificador do mercado criado.
     */
    function openMarket(MarketType marketType) external onlyOwner returns (uint256 marketId) {
        marketId = nextMarketId++;
        Market storage m = markets[marketId];
        m.marketType   = marketType;
        m.state        = MarketState.OPEN;
        m.commissionPct = commissionPct;
        emit MarketOpened(marketId, marketType);
    }

    /**
     * @notice Encerra apostas para um mercado (sem liquidar ainda).
     */
    function closeMarket(uint256 marketId)
        external
        onlyOwner
        marketExists(marketId)
        onlyOpen(marketId)
    {
        markets[marketId].state = MarketState.CLOSED;
        emit MarketClosed(marketId);
    }

    /**
     * @notice Liquida o mercado com o resultado oficial e calcula as taxas.
     * @param winningGuess Resultado vencedor (ex.: "Brasil" ou "Vinicius Jr.").
     *
     * Esta função pode ser chamada diretamente pelo owner (Trabalho 02) ou
     * pela BettingDAO após aprovação em votação (Trabalho 03).
     */
    function settleMarket(uint256 marketId, string calldata winningGuess)
        external
        onlyOwner
        marketExists(marketId)
    {
        Market storage m = markets[marketId];
        require(m.state == MarketState.CLOSED, "Mercado deve estar fechado");

        m.winningGuess = winningGuess;
        m.state        = MarketState.SETTLED;

        // Calcula a soma das apostas vencedoras
        uint256 winPool;
        for (uint256 i = 0; i < m.bettors.length; i++) {
            address bettor = m.bettors[i];
            if (_equalStrings(m.bets[bettor].guess, winningGuess)) {
                winPool += m.bets[bettor].amount;
            }
        }

        m.winnerPool = winPool;

        uint256 fee = (m.totalPool * m.commissionPct) / BASIS_POINTS;
        accumulatedFees += fee;

        emit MarketSettled(marketId, winningGuess, winPool, fee);
    }

    /**
     * @notice Atualiza a taxa de comissão padrão (em basis points).
     *         Pode ser chamada pelo owner ou pela DAO (Trabalho 03).
     */
    function setCommission(uint256 newPct) external onlyOwner {
        require(newPct <= MAX_COMMISSION, "Taxa acima do limite");
        emit CommissionUpdated(commissionPct, newPct);
        commissionPct = newPct;
    }

    /**
     * @notice Saca as taxas acumuladas para o endereço informado.
     */
    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "Nenhuma taxa acumulada");
        accumulatedFees = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Transferencia falhou");
        emit FeesWithdrawn(to, amount);
    }

    // ─────────────────────────────────────────────────
    //  Apostas
    // ─────────────────────────────────────────────────

    /**
     * @notice Registra uma aposta no mercado indicado.
     * @param marketId  Identificador do mercado.
     * @param guess     Palpite do apostador (ex.: "Argentina").
     */
    function placeBet(uint256 marketId, string calldata guess)
        external
        payable
        marketExists(marketId)
        onlyOpen(marketId)
        nonReentrant
    {
        require(msg.value > 0,     "Valor deve ser maior que zero");
        require(bytes(guess).length > 0, "Palpite nao pode ser vazio");

        Market storage m = markets[marketId];

        // Um endereço só pode apostar uma vez por mercado
        require(m.bets[msg.sender].amount == 0, "Aposta ja registrada");

        m.bets[msg.sender] = Bet({guess: guess, amount: msg.value});
        m.bettors.push(msg.sender);
        m.totalPool += msg.value;

        emit BetPlaced(marketId, msg.sender, guess, msg.value);
    }

    // ─────────────────────────────────────────────────
    //  Saques de prêmio
    // ─────────────────────────────────────────────────

    /**
     * @notice Permite que um vencedor saque seu prêmio proporcional.
     *
     * Prêmio = (aposta_individual / total_apostas_vencedoras)
     *          × (totalPool − taxa)
     */
    function claimPrize(uint256 marketId)
        external
        marketExists(marketId)
        onlySettled(marketId)
        nonReentrant
    {
        Market storage m = markets[marketId];

        require(!m.hasClaimed[msg.sender], "Premio ja sacado");
        Bet storage bet = m.bets[msg.sender];
        require(bet.amount > 0, "Nenhuma aposta encontrada");
        require(
            _equalStrings(bet.guess, m.winningGuess),
            "Palpite nao e o vencedor"
        );

        m.hasClaimed[msg.sender] = true;

        uint256 fee          = (m.totalPool * m.commissionPct) / BASIS_POINTS;
        uint256 distributable = m.totalPool - fee;
        uint256 prize        = (bet.amount * distributable) / m.winnerPool;

        (bool ok, ) = msg.sender.call{value: prize}("");
        require(ok, "Transferencia falhou");

        emit PrizeClaimed(marketId, msg.sender, prize);
    }

    // ─────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────

    function getMarketInfo(uint256 marketId)
        external
        view
        marketExists(marketId)
        returns (
            MarketType  marketType,
            MarketState state,
            string memory winningGuess,
            uint256 totalPool,
            uint256 winnerPool,
            uint256 commission,
            uint256 betCount
        )
    {
        Market storage m = markets[marketId];
        return (
            m.marketType,
            m.state,
            m.winningGuess,
            m.totalPool,
            m.winnerPool,
            m.commissionPct,
            m.bettors.length
        );
    }

    function getBet(uint256 marketId, address bettor)
        external
        view
        marketExists(marketId)
        returns (string memory guess, uint256 amount)
    {
        Bet storage b = markets[marketId].bets[bettor];
        return (b.guess, b.amount);
    }

    function hasClaimed(uint256 marketId, address bettor)
        external
        view
        marketExists(marketId)
        returns (bool)
    {
        return markets[marketId].hasClaimed[bettor];
    }

    // ─────────────────────────────────────────────────
    //  Auxiliares internos
    // ─────────────────────────────────────────────────

    function _equalStrings(string memory a, string memory b)
        internal
        pure
        returns (bool)
    {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
