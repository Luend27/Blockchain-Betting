import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { CONTRACTS, DAO_ABI, TOKEN_ABI } from "../contracts/config";

interface Props {
  signer: ethers.Signer | null;
  address: string;
}

export function AdminPage({ signer }: Props) {
  const [busy, setBusy]           = useState<Record<string, boolean>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [mintTo, setMintTo]       = useState("");
  const [mintAmt, setMintAmt]     = useState("");
  const [closeId, setCloseId]     = useState("");

  const daoContract   = useCallback(() => new ethers.Contract(CONTRACTS.DAO,   DAO_ABI,   signer!), [signer]);
  const tokenContract = useCallback(() => new ethers.Contract(CONTRACTS.TOKEN, TOKEN_ABI, signer!), [signer]);

  const withTx = async (key: string, action: () => Promise<ethers.TransactionResponse>, successMsg: string) => {
    setBusy(p => ({ ...p, [key]: true }));
    setStatusMsg("Aguardando MetaMask…");
    try {
      const tx = await action();
      setStatusMsg("Aguardando a blockchain…");
      await tx.wait();
      setStatusMsg("");
      alert("✅ " + successMsg);
    } catch (err: unknown) {
      setStatusMsg("");
      const e = err as { code?: number; reason?: string; message?: string };
      if (e.code !== 4001) alert("Erro: " + (e.reason ?? e.message));
    } finally {
      setBusy(p => ({ ...p, [key]: false }));
    }
  };

  const openMarket = (type: 0 | 1) =>
    withTx(`open${type}`, () => daoContract().adminOpenMarket(type),
      `Mercado "${type === 0 ? "Seleção Campeã" : "Artilheiro"}" aberto!`);

  const closeMarket = () => {
    if (!closeId) return alert("Digite o ID do mercado.");
    withTx("close", () => daoContract().adminCloseMarket(Number(closeId)),
      `Mercado #${closeId} fechado!`);
  };

  const mintTokens = () => {
    if (!ethers.isAddress(mintTo)) return alert("Endereço inválido.");
    if (!mintAmt || parseFloat(mintAmt) <= 0) return alert("Valor inválido.");
    withTx("mint", () => tokenContract().mint(mintTo, ethers.parseEther(mintAmt)),
      `${mintAmt} BGT mintados para ${mintTo.slice(0, 8)}…`);
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );

  return (
    <div className="space-y-5">
      {statusMsg && (
        <div className="bg-indigo-900/40 border border-indigo-700 text-indigo-300 text-sm px-4 py-3 rounded-xl">
          ⏳ {statusMsg}
        </div>
      )}

      <div className="bg-yellow-900/30 border border-yellow-800/50 text-yellow-300 text-sm px-4 py-3 rounded-xl">
        ⚙️ Painel de administração — visível apenas para o owner da DAO.
      </div>

      {/* Abrir mercado */}
      <Section title="Abrir Mercado">
        <div className="flex gap-3">
          <button
            onClick={() => openMarket(0)}
            disabled={!!busy["open0"]}
            className="flex-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl text-sm"
          >
            {busy["open0"] ? "…" : "+ Seleção Campeã"}
          </button>
          <button
            onClick={() => openMarket(1)}
            disabled={!!busy["open1"]}
            className="flex-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl text-sm"
          >
            {busy["open1"] ? "…" : "+ Artilheiro"}
          </button>
        </div>
      </Section>

      {/* Fechar mercado */}
      <Section title="Fechar Mercado (Encerrar Apostas)">
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="ID do mercado"
            value={closeId}
            onChange={e => setCloseId(e.target.value)}
            className="w-36 bg-gray-800 border border-gray-700 focus:border-orange-500 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none"
          />
          <button
            onClick={closeMarket}
            disabled={!!busy["close"]}
            className="flex-1 bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white font-medium py-2.5 rounded-xl text-sm"
          >
            {busy["close"] ? "…" : "🔒 Fechar Apostas"}
          </button>
        </div>
        <p className="text-xs text-gray-600">
          Após fechar, crie uma proposta na aba Governança para oficializar o resultado.
        </p>
      </Section>

      {/* Mintar BGT */}
      <Section title="Distribuir Tokens BGT">
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Endereço do gestor (0x…)"
            value={mintTo}
            onChange={e => setMintTo(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 focus:border-green-500 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none"
          />
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Quantidade (ex: 1000)"
              value={mintAmt}
              onChange={e => setMintAmt(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 focus:border-green-500 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none"
            />
            <button
              onClick={mintTokens}
              disabled={!!busy["mint"]}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white font-medium px-5 py-2.5 rounded-xl text-sm"
            >
              {busy["mint"] ? "…" : "Emitir BGT"}
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Após receber os tokens, o gestor deve chamar <code className="text-gray-400">delegate(self)</code> na aba Governança.
          </p>
        </div>
      </Section>
    </div>
  );
}
