/**
 * Script de deploy — Hardhat 3
 *
 * Hardhat 3 não expõe hre.ethers em scripts (o plugin só estende o HRE
 * em contextos de teste). A solução é bifurcar por rede:
 *
 *  ▸ Rede local (--network hardhat):
 *      Usa network.create() — exatamente o mesmo padrão dos testes.
 *      Funciona com a rede EDR in-process do Hardhat 3.
 *
 *  ▸ Testnet (--network sepolia):
 *      Usa raw ethers.js com JsonRpcProvider + Wallet do .env,
 *      e hre.artifacts para leer o ABI/bytecode dos contratos compilados.
 *
 * Uso:
 *   npx hardhat run scripts/deploy.ts                    # rede local
 *   npx hardhat run scripts/deploy.ts --network sepolia  # testnet
 */

import hre from "hardhat";
import { network } from "hardhat";
import { ethers } from "ethers";
import "dotenv/config";

// HARDHAT_NETWORK é definido pelo Hardhat quando --network é passado.
// Padrão "hardhat" quando não especificado.
const NETWORK = process.env.HARDHAT_NETWORK ?? "hardhat";

const COMMISSION_BPS  = 300n;
const VOTING_DURATION = 3n * 24n * 3600n; // 3 dias
const QUORUM_BPS      = 1_000n;            // 10%

// ─────────────────────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    if (NETWORK === "sepolia") {
        await deployToSepolia();
    } else {
        await deployToLocal();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Deploy Local  (usa network.create() — mesmo padrão dos testes)
// ─────────────────────────────────────────────────────────────────────────────

async function deployToLocal() {
    // network.create() retorna uma instância EDR isolada com ethers embutido.
    // Essa é a API nativa do Hardhat 3 para scripts e testes.
    const { ethers: e } = await network.create();

    const [deployer] = await e.getSigners();

    printHeader("LOCAL (EDR)", deployer.address);
    console.log(`  Saldo    : ${e.formatEther(
        await e.provider.getBalance(deployer.address)
    )} ETH`);
    console.log("───────────────────────────────────────────────────");

    console.log("\n[1/4] WorldCupBetting...");
    const betting = await e.deployContract("WorldCupBetting", [COMMISSION_BPS]);
    await betting.waitForDeployment();
    const bettingAddr = await betting.getAddress();
    console.log(`      ✓ ${bettingAddr}`);

    console.log("[2/4] BettingToken...");
    const token = await e.deployContract("BettingToken", [deployer.address]);
    await token.waitForDeployment();
    const tokenAddr = await token.getAddress();
    console.log(`      ✓ ${tokenAddr}`);

    console.log("[3/4] BettingDAO...");
    const dao = await e.deployContract("BettingDAO", [
        tokenAddr, bettingAddr, VOTING_DURATION, QUORUM_BPS, deployer.address,
    ]);
    await dao.waitForDeployment();
    const daoAddr = await dao.getAddress();
    console.log(`      ✓ ${daoAddr}`);

    console.log("[4/4] Transferindo ownership...");
    await betting.transferOwnership(daoAddr);
    console.log(`      ✓ WorldCupBetting.owner = DAO`);

    printSummary(bettingAddr, tokenAddr, daoAddr);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Deploy Sepolia  (raw ethers.js + hre.artifacts)
// ─────────────────────────────────────────────────────────────────────────────

async function deployToSepolia() {
    const rpcUrl     = process.env.SEPOLIA_RPC_URL;
    const privateKey = process.env.SEPOLIA_PRIVATE_KEY;

    if (!rpcUrl || !privateKey) {
        throw new Error(
            "Preencha SEPOLIA_RPC_URL e SEPOLIA_PRIVATE_KEY no arquivo .env"
        );
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const deployer  = new ethers.Wallet(privateKey, provider);

    printHeader("SEPOLIA", deployer.address);
    console.log(`  Saldo    : ${ethers.formatEther(
        await provider.getBalance(deployer.address)
    )} ETH`);
    console.log("───────────────────────────────────────────────────");

    // hre.artifacts lê o ABI e bytecode dos contratos já compilados
    const deploy = async (name: string, args: unknown[]) => {
        const artifact = await hre.artifacts.readArtifact(name);
        const factory  = new ethers.ContractFactory(
            artifact.abi, artifact.bytecode, deployer
        );
        const contract = await factory.deploy(...args);
        await contract.waitForDeployment();
        return contract;
    };

    console.log("\n[1/4] WorldCupBetting...");
    const betting = await deploy("WorldCupBetting", [COMMISSION_BPS]);
    const bettingAddr = await betting.getAddress();
    console.log(`      ✓ ${bettingAddr}`);

    console.log("[2/4] BettingToken...");
    const token = await deploy("BettingToken", [deployer.address]);
    const tokenAddr = await token.getAddress();
    console.log(`      ✓ ${tokenAddr}`);

    console.log("[3/4] BettingDAO...");
    const dao = await deploy("BettingDAO", [
        tokenAddr, bettingAddr, VOTING_DURATION, QUORUM_BPS, deployer.address,
    ]);
    const daoAddr = await dao.getAddress();
    console.log(`      ✓ ${daoAddr}`);

    console.log("[4/4] Transferindo ownership...");
    const bettingArtifact = await hre.artifacts.readArtifact("WorldCupBetting");
    const bettingContract  = new ethers.Contract(
        bettingAddr, bettingArtifact.abi, deployer
    );
    const tx = await (bettingContract as any).transferOwnership(daoAddr);
    await tx.wait();
    console.log(`      ✓ WorldCupBetting.owner = DAO`);

    printSummary(bettingAddr, tokenAddr, daoAddr);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function printHeader(networkLabel: string, deployer: string) {
    console.log("═══════════════════════════════════════════════════");
    console.log(`  Copa do Mundo Betting — Deploy ${networkLabel}`);
    console.log("═══════════════════════════════════════════════════");
    console.log(`  Deployer : ${deployer}`);
}

function printSummary(bettingAddr: string, tokenAddr: string, daoAddr: string) {
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  Endereços dos contratos");
    console.log("═══════════════════════════════════════════════════");
    console.log(`  WorldCupBetting : ${bettingAddr}`);
    console.log(`  BettingToken    : ${tokenAddr}`);
    console.log(`  BettingDAO      : ${daoAddr}`);
    console.log("───────────────────────────────────────────────────");
    console.log("  Próximos passos:");
    console.log("  1. token.mint(<endereço>, <quantidade>)");
    console.log("  2. token.delegate(<próprio endereço>)");
    console.log("  3. dao.adminOpenMarket(0)  // 0=CHAMPION, 1=TOP_SCORER");
    console.log("═══════════════════════════════════════════════════\n");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
