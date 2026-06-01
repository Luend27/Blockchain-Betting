/**
 * Testes — BettingDAO (Trabalho 03)
 * API Hardhat 3: network.create() + ethers.deployContract()
 */

import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function advanceTime(seconds: bigint) {
    await ethers.provider.send("evm_increaseTime", [Number(seconds) + 1]);
    await ethers.provider.send("evm_mine", []);
}

async function expectEtherGain(
    signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    action: () => Promise<any>,
    expectedGain: bigint,
) {
    const balanceBefore = await ethers.provider.getBalance(signer.address);
    const tx      = await action();
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const balanceAfter = await ethers.provider.getBalance(signer.address);
    expect(balanceAfter - balanceBefore + gasCost).to.equal(expectedGain);
}

// ─── Fixture completa ─────────────────────────────────────────────────────────

async function deployDaoFixture() {
    const [admin, manager1, manager2, manager3, bettor, outsider] =
        await ethers.getSigners();

    const VOTING_DURATION = 86_400n; // 1 dia
    const QUORUM_BPS      = 1_000n;  // 10%

    const betting = await ethers.deployContract("WorldCupBetting", [300n]);
    const token   = await ethers.deployContract("BettingToken", [admin.address]);
    const dao     = await ethers.deployContract("BettingDAO", [
        await token.getAddress(),
        await betting.getAddress(),
        VOTING_DURATION,
        QUORUM_BPS,
        admin.address,
    ]);

    // DAO passa a ser owner do WorldCupBetting
    await betting.transferOwnership(await dao.getAddress());

    // Distribuição de tokens (total supply = 10.000 BGT)
    await token.mint(manager1.address, ethers.parseEther("6000")); // 60%
    await token.mint(manager2.address, ethers.parseEther("3000")); // 30%
    await token.mint(manager3.address, ethers.parseEther("1000")); // 10%

    // Auto-delegação obrigatória para ativar poder de voto (ERC20Votes)
    await token.connect(manager1).delegate(manager1.address);
    await token.connect(manager2).delegate(manager2.address);
    await token.connect(manager3).delegate(manager3.address);

    return {
        betting, token, dao,
        admin, manager1, manager2, manager3, bettor, outsider,
        VOTING_DURATION, QUORUM_BPS,
    };
}

// ─── Deploy e configuração ────────────────────────────────────────────────────

describe("BettingDAO — Deploy e configuração", () => {
    it("registra o endereço do BettingToken", async () => {
        const { dao, token } = await deployDaoFixture();
        expect(await dao.token()).to.equal(await token.getAddress());
    });

    it("registra o endereço do WorldCupBetting", async () => {
        const { dao, betting } = await deployDaoFixture();
        expect(await dao.betting()).to.equal(await betting.getAddress());
    });

    it("a DAO é o novo owner do WorldCupBetting", async () => {
        const { dao, betting } = await deployDaoFixture();
        expect(await betting.owner()).to.equal(await dao.getAddress());
    });

    it("voting duration está configurada corretamente", async () => {
        const { dao, VOTING_DURATION } = await deployDaoFixture();
        expect(await dao.votingDuration()).to.equal(VOTING_DURATION);
    });

    it("quorum bps está configurado corretamente", async () => {
        const { dao, QUORUM_BPS } = await deployDaoFixture();
        expect(await dao.quorumBps()).to.equal(QUORUM_BPS);
    });
});

// ─── Operações admin ─────────────────────────────────────────────────────────

describe("BettingDAO — Operações administrativas", () => {
    it("admin abre mercado CHAMPION via DAO", async () => {
        const { dao, betting } = await deployDaoFixture();
        await expect(dao.adminOpenMarket(0n))
            .to.emit(betting, "MarketOpened")
            .withArgs(0n, 0n);
    });

    it("admin abre mercado TOP_SCORER via DAO", async () => {
        const { dao, betting } = await deployDaoFixture();
        await expect(dao.adminOpenMarket(1n))
            .to.emit(betting, "MarketOpened")
            .withArgs(0n, 1n);
    });

    it("admin fecha mercado via DAO", async () => {
        const { dao, betting } = await deployDaoFixture();
        await dao.adminOpenMarket(0n);
        await expect(dao.adminCloseMarket(0n))
            .to.emit(betting, "MarketClosed")
            .withArgs(0n);
    });

    it("non-admin não pode abrir mercado", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await expect(dao.connect(manager1).adminOpenMarket(0n))
            .to.be.revertedWithCustomError(dao, "OwnableUnauthorizedAccount");
    });

    it("non-admin não pode fechar mercado", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await dao.adminOpenMarket(0n);
        await expect(dao.connect(manager1).adminCloseMarket(0n))
            .to.be.revertedWithCustomError(dao, "OwnableUnauthorizedAccount");
    });

    it("endereço sem tokens não pode criar proposta", async () => {
        const { dao, outsider } = await deployDaoFixture();
        await expect(dao.connect(outsider).proposeSetCommission(500n, "test"))
            .to.be.revertedWith("Sem tokens de governanca");
    });
});

// ─── Criação de propostas e votação ──────────────────────────────────────────

describe("BettingDAO — Criação de propostas e votação", () => {
    it("gestor cria proposta SET_COMMISSION e emite ProposalCreated", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await expect(dao.connect(manager1).proposeSetCommission(500n, "Mudar taxa para 5%"))
            .to.emit(dao, "ProposalCreated");
    });

    it("gestor cria proposta SETTLE_MARKET e emite ProposalCreated", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await dao.adminOpenMarket(0n);
        await dao.adminCloseMarket(0n);
        await expect(
            dao.connect(manager1).proposeSettleMarket(0n, "Brasil", "Brasil é campeão!")
        ).to.emit(dao, "ProposalCreated");
    });

    it("gestor cria proposta WITHDRAW_FEES e emite ProposalCreated", async () => {
        const { dao, manager1, admin } = await deployDaoFixture();
        await expect(
            dao.connect(manager1).proposeWithdrawFees(admin.address, "Sacar taxas")
        ).to.emit(dao, "ProposalCreated");
    });

    it("proposta cresce nextProposalId a cada criação", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(100n, "p1");
        await dao.connect(manager1).proposeSetCommission(200n, "p2");
        expect(await dao.nextProposalId()).to.equal(2n);
    });

    it("voto a favor emite VoteCast com peso correto", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(500n, "test");
        await expect(dao.connect(manager1).vote(0n, true))
            .to.emit(dao, "VoteCast")
            .withArgs(0n, manager1.address, true, ethers.parseEther("6000"));
    });

    it("voto contra emite VoteCast com peso correto", async () => {
        const { dao, manager1, manager2 } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(500n, "test");
        await expect(dao.connect(manager2).vote(0n, false))
            .to.emit(dao, "VoteCast")
            .withArgs(0n, manager2.address, false, ethers.parseEther("3000"));
    });

    it("rejeita duplo voto do mesmo endereço", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(500n, "test");
        await dao.connect(manager1).vote(0n, true);
        await expect(dao.connect(manager1).vote(0n, true))
            .to.be.revertedWith("Ja votou nesta proposta");
    });

    it("rejeita voto após prazo encerrado", async () => {
        const { dao, manager1, VOTING_DURATION } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(500n, "test");
        await advanceTime(VOTING_DURATION);
        await expect(dao.connect(manager1).vote(0n, true))
            .to.be.revertedWith("Prazo de votacao encerrado");
    });

    it("rejeita voto de endereço sem poder de voto no snapshot", async () => {
        const { dao, manager1, outsider } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(500n, "test");
        await expect(dao.connect(outsider).vote(0n, true))
            .to.be.revertedWith("Sem poder de voto no bloco do snapshot");
    });

    it("rejeita finalização antes do prazo", async () => {
        const { dao, manager1 } = await deployDaoFixture();
        await dao.connect(manager1).proposeSetCommission(500n, "test");
        await expect(dao.finalizeProposal(0n))
            .to.be.revertedWith("Prazo ainda nao encerrou");
    });
});

// ─── Fluxo completo: officializar resultado e liberar saques ─────────────────

describe("BettingDAO — Proposta APROVADA: officializar resultado", () => {
    /**
     * Fluxo completo de governança para liquidação:
     *  1. Admin abre mercado
     *  2. Apostador faz aposta diretamente no contrato
     *  3. Admin fecha mercado
     *  4. Gestor propõe SETTLE_MARKET
     *  5. Maioria vota a favor (60% + 30% = 90% > quorum 10%)
     *  6. Proposta finalizada como PASSED
     *  7. Proposta executada → mercado liquidado com "Brasil"
     *  8. Apostador vencedor saca prêmio
     */
    it("executa SETTLE_MARKET via governança e libera saques ao vencedor", async () => {
        const { dao, betting, manager1, manager2, bettor, VOTING_DURATION } =
            await deployDaoFixture();

        await dao.adminOpenMarket(0n);
        await betting.connect(bettor).placeBet(0n, "Brasil", { value: ethers.parseEther("1") });
        await dao.adminCloseMarket(0n);

        await dao.connect(manager1).proposeSettleMarket(0n, "Brasil", "Brasil é campeão!");
        await dao.connect(manager1).vote(0n, true); // 6000 BGT
        await dao.connect(manager2).vote(0n, true); // 3000 BGT

        await advanceTime(VOTING_DURATION);

        await expect(dao.finalizeProposal(0n))
            .to.emit(dao, "ProposalFinalized")
            .withArgs(0n, 1n); // 1 = PASSED

        await expect(dao.executeProposal(0n))
            .to.emit(dao, "ProposalExecuted")
            .withArgs(0n, 0n); // 0 = SETTLE_MARKET

        // Verifica estado final do mercado
        const info = await betting.getMarketInfo(0n);
        expect(info.state).to.equal(2n);          // SETTLED
        expect(info.winningGuess).to.equal("Brasil");

        // Apostador vencedor pode sacar prêmio
        await expect(betting.connect(bettor).claimPrize(0n))
            .to.emit(betting, "PrizeClaimed");
    });

    it("não permite re-executar proposta já executada", async () => {
        const { dao, betting, manager1, manager2, bettor, VOTING_DURATION } =
            await deployDaoFixture();

        await dao.adminOpenMarket(0n);
        await betting.connect(bettor).placeBet(0n, "Brasil", { value: ethers.parseEther("1") });
        await dao.adminCloseMarket(0n);
        await dao.connect(manager1).proposeSettleMarket(0n, "Brasil", "test");
        await dao.connect(manager1).vote(0n, true);
        await advanceTime(VOTING_DURATION);
        await dao.finalizeProposal(0n);
        await dao.executeProposal(0n);

        await expect(dao.executeProposal(0n))
            .to.be.revertedWith("Proposta nao aprovada");
    });
});

// ─── Alterar taxa via governança ──────────────────────────────────────────────

describe("BettingDAO — Proposta APROVADA: alterar taxa de comissão", () => {
    it("altera comissão de 3% para 5% via votação de governança", async () => {
        const { dao, betting, manager1, manager2, VOTING_DURATION } =
            await deployDaoFixture();

        expect(await betting.commissionPct()).to.equal(300n);

        await dao.connect(manager1).proposeSetCommission(500n, "Taxa para 5%");
        await dao.connect(manager1).vote(0n, true); // 6000 BGT
        await dao.connect(manager2).vote(0n, true); // 3000 BGT

        await advanceTime(VOTING_DURATION);
        await dao.finalizeProposal(0n);
        await dao.executeProposal(0n);

        expect(await betting.commissionPct()).to.equal(500n);
    });
});

// ─── Cenário: maioria vota contra ────────────────────────────────────────────

describe("BettingDAO — Proposta REJEITADA: maioria vota contra", () => {
    it("finaliza como REJECTED quando votesAgainst > votesFor", async () => {
        const { dao, manager1, manager2, manager3, VOTING_DURATION } =
            await deployDaoFixture();

        await dao.connect(manager1).proposeSetCommission(900n, "Taxa de 9%");

        await dao.connect(manager1).vote(0n, false); // 6000 BGT contra
        await dao.connect(manager2).vote(0n, true);  // 3000 BGT a favor
        await dao.connect(manager3).vote(0n, true);  // 1000 BGT a favor

        await advanceTime(VOTING_DURATION);

        await expect(dao.finalizeProposal(0n))
            .to.emit(dao, "ProposalFinalized")
            .withArgs(0n, 2n); // 2 = REJECTED

        await expect(dao.executeProposal(0n))
            .to.be.revertedWith("Proposta nao aprovada");
    });
});

// ─── Cenário: quorum não atingido ────────────────────────────────────────────

describe("BettingDAO — Proposta REJEITADA: quorum não atingido", () => {
    it("finaliza como REJECTED quando nenhum voto é emitido", async () => {
        // totalVotes = 0 < quorumNeeded (10% de 10.000 BGT = 1.000 BGT)
        const { dao, manager1, VOTING_DURATION } = await deployDaoFixture();

        await dao.connect(manager1).proposeSetCommission(100n, "Taxa de 1%");
        // Nenhum gestor vota

        await advanceTime(VOTING_DURATION);

        await expect(dao.finalizeProposal(0n))
            .to.emit(dao, "ProposalFinalized")
            .withArgs(0n, 2n); // 2 = REJECTED
    });
});

// ─── Sacar taxas via governança ───────────────────────────────────────────────

describe("BettingDAO — Proposta APROVADA: sacar taxas acumuladas", () => {
    it("executa WITHDRAW_FEES para endereço aprovado via governança", async () => {
        const { dao, betting, manager1, manager2, bettor, admin, VOTING_DURATION } =
            await deployDaoFixture();

        // Gera taxas: abre mercado, aposta, fecha, liquida via DAO
        await dao.adminOpenMarket(0n);
        await betting.connect(bettor).placeBet(0n, "Brasil", { value: ethers.parseEther("10") });
        await dao.adminCloseMarket(0n);

        // Proposta 0: liquidar mercado
        await dao.connect(manager1).proposeSettleMarket(0n, "Brasil", "Liquida");
        await dao.connect(manager1).vote(0n, true);
        await advanceTime(VOTING_DURATION);
        await dao.finalizeProposal(0n);
        await dao.executeProposal(0n);

        const fees = await betting.accumulatedFees();
        expect(fees).to.be.gt(0n);

        // Proposta 1: sacar taxas para o admin
        await dao.connect(manager1).proposeWithdrawFees(admin.address, "Sacar taxas");
        await dao.connect(manager1).vote(1n, true);
        await dao.connect(manager2).vote(1n, true);
        await advanceTime(VOTING_DURATION);
        await dao.finalizeProposal(1n);

        await expectEtherGain(admin, () => dao.executeProposal(1n), fees);

        expect(await betting.accumulatedFees()).to.equal(0n);
    });
});
