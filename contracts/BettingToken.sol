// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BettingToken (BGT)
 * @notice Token de governança ERC20 com suporte a voto delegado (ERC20Votes).
 *
 * Fluxo de uso:
 *  1. Owner emite tokens aos gestores via mint().
 *  2. Cada gestor chama delegate(self) para ativar seu poder de voto.
 *  3. BettingDAO usa getPastVotes (snapshot por bloco) para pesos de votação.
 */
contract BettingToken is ERC20, Ownable, ERC20Permit, ERC20Votes {
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10 ** 18;

    constructor(address initialOwner)
        ERC20("Betting Governance Token", "BGT")
        Ownable(initialOwner)
        ERC20Permit("Betting Governance Token")
    {}

    /**
     * @notice Emite tokens para um gestor da plataforma.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Limite de fornecimento atingido");
        _mint(to, amount);
    }

    // ─── Overrides obrigatórios para ERC20Votes + OZ 5.x ───

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
