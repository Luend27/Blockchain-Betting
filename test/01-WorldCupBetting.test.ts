/**
 * Testes — WorldCupBetting (Trabalho 02)
 * API Hardhat 3: network.create() + ethers.deployContract()
 */

import { expect } from "chai";
import { network } from "hardhat";

// Cria uma rede EDR isolada para este arquivo de testes
const { ethers } = await network.create();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Executa `action()` e verifica que o saldo ETH do `signer` aumentou
 * exatamente `expectedGain` (prêmio ou taxa recebida), descontando o gás.
 * Recebe um callback para garantir que `balanceBefore` seja capturado
 * ANTES da transação ser submetida à rede.
 */
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
    // balanceAfter = balanceBefore + ganho - gasCost  →  ganho = diff + gasCost
    expect(balanceAfter - balanceBefore + gasCost).to.equal(expectedGain);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

async function deployFixture() {
    const [owner, bettor1, bettor2, bettor3, outsider] = await ethers.getSigners();
    const betting = await ethers.deployContract("WorldCupBetting", [300n]);
    return { betting, owner, bettor1, bettor2, bettor3, outsider };
}

async function openMarketFixture() {
    const base = await deployFixture();
    await base.betting.openMarket(0n); // CHAMPION — marketId = 0
    return base;
}

async function settledFixture() {
    const base = await openMarketFixture();
    const { betting, bettor1, bettor2, bettor3 } = base;

    // bettor1: 1 ETH  → "Brasil"    (vencedor)
    // bettor2: 3 ETH  → "Brasil"    (vencedor)
    // bettor3: 1 ETH  → "Argentina" (perdedor)
    await betting.connect(bettor1).placeBet(0n, "Brasil",    { value: ethers.parseEther("1") });
    await betting.connect(bettor2).placeBet(0n, "Brasil",    { value: ethers.parseEther("3") });
    await betting.connect(bettor3).placeBet(0n, "Argentina", { value: ethers.parseEther("1") });

    await betting.closeMarket(0n);
    await betting.settleMarket(0n, "Brasil");
    return base;
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

describe("WorldCupBetting — Deploy", () => {
    it("define comissão inicial de 3%", async () => {
        const { betting } = await deployFixture();
        expect(await betting.commissionPct()).to.equal(300n);
    });

    it("define o deployer como owner", async () => {
        const { betting, owner } = await deployFixture();
        expect(await betting.owner()).to.equal(owner.address);
    });

    it("inicia com nextMarketId = 0", async () => {
        const { betting } = await deployFixture();
        expect(await betting.nextMarketId()).to.equal(0n);
    });

    it("rejeita taxa acima de 10% (1000 bps)", async () => {
        await expect(ethers.deployContract("WorldCupBetting", [1001n]))
            .to.be.revertedWith("Taxa acima do limite");
    });
});

// ─── Mercados ─────────────────────────────────────────────────────────────────

describe("WorldCupBetting — Ciclo de vida do mercado", () => {
    it("abre um mercado e emite MarketOpened", async () => {
        const { betting } = await deployFixture();
        await expect(betting.openMarket(0n))
            .to.emit(betting, "MarketOpened")
            .withArgs(0n, 0n);
    });

    it("incrementa nextMarketId a cada abertura", async () => {
        const { betting } = await deployFixture();
        await betting.openMarket(0n);
        await betting.openMarket(1n);
        expect(await betting.nextMarketId()).to.equal(2n);
    });

    it("mercado recém-aberto tem estado OPEN (0)", async () => {
        const { betting } = await deployFixture();
        await betting.openMarket(0n);
        const info = await betting.getMarketInfo(0n);
        expect(info.state).to.equal(0n);
    });

    it("fecha um mercado e emite MarketClosed", async () => {
        const { betting } = await deployFixture();
        await betting.openMarket(0n);
        await expect(betting.closeMarket(0n))
            .to.emit(betting, "MarketClosed")
            .withArgs(0n);
    });

    it("não permite fechar um mercado já fechado", async () => {
        const { betting } = await deployFixture();
        await betting.openMarket(0n);
        await betting.closeMarket(0n);
        await expect(betting.closeMarket(0n))
            .to.be.revertedWith("Mercado nao esta aberto");
    });

    it("liquida o mercado e emite MarketSettled", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await betting.connect(bettor1).placeBet(0n, "Brasil", { value: ethers.parseEther("1") });
        await betting.closeMarket(0n);
        await expect(betting.settleMarket(0n, "Brasil"))
            .to.emit(betting, "MarketSettled");
    });

    it("rejeita liquidação com mercado ainda aberto", async () => {
        const { betting } = await openMarketFixture();
        await expect(betting.settleMarket(0n, "Brasil"))
            .to.be.revertedWith("Mercado deve estar fechado");
    });

    it("non-owner não pode abrir mercado", async () => {
        const { betting, bettor1 } = await deployFixture();
        await expect(betting.connect(bettor1).openMarket(0n))
            .to.be.revertedWithCustomError(betting, "OwnableUnauthorizedAccount");
    });
});

// ─── Apostas ─────────────────────────────────────────────────────────────────

describe("WorldCupBetting — Registro de apostas", () => {
    it("registra uma aposta e emite BetPlaced", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        const amount = ethers.parseEther("1");
        await expect(betting.connect(bettor1).placeBet(0n, "Brasil", { value: amount }))
            .to.emit(betting, "BetPlaced")
            .withArgs(0n, bettor1.address, "Brasil", amount);
    });

    it("acumula totalPool corretamente", async () => {
        const { betting, bettor1, bettor2 } = await openMarketFixture();
        await betting.connect(bettor1).placeBet(0n, "Brasil",    { value: ethers.parseEther("2") });
        await betting.connect(bettor2).placeBet(0n, "Argentina", { value: ethers.parseEther("3") });
        const info = await betting.getMarketInfo(0n);
        expect(info.totalPool).to.equal(ethers.parseEther("5"));
    });

    it("rejeita aposta com valor zero", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await expect(betting.connect(bettor1).placeBet(0n, "Brasil", { value: 0n }))
            .to.be.revertedWith("Valor deve ser maior que zero");
    });

    it("rejeita palpite vazio", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await expect(betting.connect(bettor1).placeBet(0n, "", { value: ethers.parseEther("1") }))
            .to.be.revertedWith("Palpite nao pode ser vazio");
    });

    it("rejeita segunda aposta do mesmo endereço", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await betting.connect(bettor1).placeBet(0n, "Brasil", { value: ethers.parseEther("1") });
        await expect(betting.connect(bettor1).placeBet(0n, "Brasil", { value: ethers.parseEther("1") }))
            .to.be.revertedWith("Aposta ja registrada");
    });

    it("rejeita aposta em mercado fechado", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await betting.closeMarket(0n);
        await expect(betting.connect(bettor1).placeBet(0n, "Brasil", { value: ethers.parseEther("1") }))
            .to.be.revertedWith("Mercado nao esta aberto");
    });

    it("getBet retorna palpite e valor corretos", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await betting.connect(bettor1).placeBet(0n, "Brasil", { value: ethers.parseEther("2") });
        const [guess, amount] = await betting.getBet(0n, bettor1.address);
        expect(guess).to.equal("Brasil");
        expect(amount).to.equal(ethers.parseEther("2"));
    });
});

// ─── Prêmios ──────────────────────────────────────────────────────────────────

describe("WorldCupBetting — Distribuição proporcional de prêmios", () => {
    /**
     * Pool total      = 5 ETH
     * Taxa (3%)       = 0.15 ETH
     * Distribuível    = 4.85 ETH
     * Pool vencedores = 4 ETH  (bettor1=1 ETH + bettor2=3 ETH)
     *
     * Prêmio bettor1  = (1/4) × 4.85 = 1.2125 ETH
     * Prêmio bettor2  = (3/4) × 4.85 = 3.6375 ETH
     */
    it("distribui prêmio proporcional — bettor1 (1 ETH de 4 ETH vencedores)", async () => {
        const { betting, bettor1 } = await settledFixture();

        const totalPool     = ethers.parseEther("5");
        const fee           = totalPool * 300n / 10_000n;
        const distributable = totalPool - fee;
        const winnerPool    = ethers.parseEther("4");
        const expectedPrize = ethers.parseEther("1") * distributable / winnerPool;

        await expectEtherGain(bettor1, () => betting.connect(bettor1).claimPrize(0n), expectedPrize);
    });

    it("distribui prêmio proporcional — bettor2 (3 ETH de 4 ETH vencedores)", async () => {
        const { betting, bettor2 } = await settledFixture();

        const totalPool     = ethers.parseEther("5");
        const fee           = totalPool * 300n / 10_000n;
        const distributable = totalPool - fee;
        const winnerPool    = ethers.parseEther("4");
        const expectedPrize = ethers.parseEther("3") * distributable / winnerPool;

        await expectEtherGain(bettor2, () => betting.connect(bettor2).claimPrize(0n), expectedPrize);
    });

    it("rejeita saque de perdedor", async () => {
        const { betting, bettor3 } = await settledFixture();
        await expect(betting.connect(bettor3).claimPrize(0n))
            .to.be.revertedWith("Palpite nao e o vencedor");
    });

    it("rejeita duplo saque pelo mesmo vencedor", async () => {
        const { betting, bettor1 } = await settledFixture();
        await betting.connect(bettor1).claimPrize(0n);
        await expect(betting.connect(bettor1).claimPrize(0n))
            .to.be.revertedWith("Premio ja sacado");
    });

    it("rejeita saque de quem não apostou", async () => {
        const { betting, outsider } = await settledFixture();
        await expect(betting.connect(outsider).claimPrize(0n))
            .to.be.revertedWith("Nenhuma aposta encontrada");
    });

    it("rejeita saque em mercado ainda não liquidado", async () => {
        const { betting, bettor1 } = await openMarketFixture();
        await betting.connect(bettor1).placeBet(0n, "Brasil", { value: ethers.parseEther("1") });
        await expect(betting.connect(bettor1).claimPrize(0n))
            .to.be.revertedWith("Mercado ainda nao liquidado");
    });

    it("hasClaimed retorna true após saque bem-sucedido", async () => {
        const { betting, bettor1 } = await settledFixture();
        expect(await betting.hasClaimed(0n, bettor1.address)).to.be.false;
        await betting.connect(bettor1).claimPrize(0n);
        expect(await betting.hasClaimed(0n, bettor1.address)).to.be.true;
    });
});

// ─── Taxas ────────────────────────────────────────────────────────────────────

describe("WorldCupBetting — Taxas de plataforma", () => {
    it("acumula taxa de 3% após liquidação", async () => {
        const { betting } = await settledFixture();
        const expectedFee = ethers.parseEther("5") * 300n / 10_000n;
        expect(await betting.accumulatedFees()).to.equal(expectedFee);
    });

    it("owner saca as taxas acumuladas para seu endereço", async () => {
        const { betting, owner } = await settledFixture();
        const fees = await betting.accumulatedFees();
        await expectEtherGain(owner, () => betting.withdrawFees(owner.address), fees);
        expect(await betting.accumulatedFees()).to.equal(0n);
    });

    it("non-owner não pode sacar taxas", async () => {
        const { betting, bettor1 } = await settledFixture();
        await expect(betting.connect(bettor1).withdrawFees(bettor1.address))
            .to.be.revertedWithCustomError(betting, "OwnableUnauthorizedAccount");
    });

    it("rejeita saque quando não há taxas acumuladas", async () => {
        const { betting, owner } = await deployFixture();
        await expect(betting.withdrawFees(owner.address))
            .to.be.revertedWith("Nenhuma taxa acumulada");
    });

    it("owner altera a comissão e emite CommissionUpdated", async () => {
        const { betting } = await deployFixture();
        await expect(betting.setCommission(500n))
            .to.emit(betting, "CommissionUpdated")
            .withArgs(300n, 500n);
        expect(await betting.commissionPct()).to.equal(500n);
    });

    it("rejeita comissão acima de 10% (1000 bps)", async () => {
        const { betting } = await deployFixture();
        await expect(betting.setCommission(1001n))
            .to.be.revertedWith("Taxa acima do limite");
    });
});
