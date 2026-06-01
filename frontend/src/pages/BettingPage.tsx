import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { CONTRACTS, BETTING_ABI } from "../contracts/config";

// Enums espelham o contrato
const MARKET_STATE_LABEL = ["ABERTO", "FECHADO", "LIQUIDADO"];
const MARKET_TYPE_LABEL  = ["Seleção Campeã", "Artilheiro"];
const STATE_BADGE = [
  "bg-green-900/60 text-green-300 border border-green-800",
  "bg-yellow-900/60 text-yellow-300 border border-yellow-800",
  "bg-purple-900/60 text-purple-300 border border-purple-800",
];

interface Market {
  id: number;
  marketType: number;
  state: number;
  winningGuess: string;
  totalPool: bigint;
  commission: bigint;
  betCount: number;
}

interface UserBet { guess: string; amount: bigint }

interface Props {
  signer: ethers.Signer | null;
  address: string;
  isAdmin: boolean;
}

function calcPrize(market: Market, userBet: UserBet, winnerPool: bigint): bigint {
  if (winnerPool === 0n) return 0n;
  const fee = market.totalPool * market.commission / 10_000n;
  return userBet.amount * (market.totalPool - fee) / winnerPool;
}

export function BettingPage({ signer, address, isAdmin }: Props) {
  const [markets, setMarkets]     = useState<Market[]>([]);
  const [winnerPools, setWP]      = useState<Record<number, bigint>>({});
  const [userBets, setUserBets]   = useState<Record<number, UserBet>>({});
  const [claimed, setClaimed]     = useState<Record<number, boolean>>({});
  const [loading, setLoading]     = useState(true);
  const [guess, setGuess]         = useState<Record<number, string>>({});
  const [amount, setAmount]       = useState<Record<number, string>>({});
  const [busy, setBusy]           = useState<Record<number, boolean>>({});
  const [statusMsg, setStatusMsg] = useState("");

  const contract = useCallback(() =>
    new ethers.Contract(CONTRACTS.BETTING, BETTING_ABI, signer!),
  [signer]);

  const load = useCallback(async () => {
    if (!signer || !address) return;
    setLoading(true);
    try {
      const c     = contract();
      const total = Number(await c.nextMarketId());
      const ms: Market[] = [];
      const wps: Record<number, bigint> = {};
      const bets: Record<number, UserBet> = {};
      const cls: Record<number, boolean>  = {};

      for (let i = 0; i < total; i++) {
        const info = await c.getMarketInfo(i);
        ms.push({
          id: i,
          marketType:   Number(info.marketType),
          state:        Number(info.state),
          winningGuess: info.winningGuess,
          totalPool:    info.totalPool,
          commission:   info.commission,
          betCount:     Number(info.betCount),
        });
        wps[i]  = info.winnerPool;
        const b = await c.getBet(i, address);
        if (b.amount > 0n) bets[i] = { guess: b.guess, amount: b.amount };
        cls[i] = await c.hasClaimed(i, address);
      }
      setMarkets(ms);
      setWP(wps);
      setUserBets(bets);
      setClaimed(cls);
    } finally {
      setLoading(false);
    }
  }, [signer, address, contract]);

  useEffect(() => { load(); }, [load]);

  const withTx = async (id: number, action: () => Promise<ethers.TransactionResponse>) => {
    setBusy(p => ({ ...p, [id]: true }));
    setStatusMsg("Aguardando confirmação no MetaMask…");
    try {
      const tx = await action();
      setStatusMsg("Transação enviada. Aguardando a blockchain…");
      await tx.wait();
      setStatusMsg("");
      await load();
      return true;
    } catch (err: unknown) {
      setStatusMsg("");
      const e = err as { code?: number; reason?: string; message?: string };
      if (e.code === 4001) return false;
      alert("Erro: " + (e.reason ?? e.message));
      return false;
    } finally {
      setBusy(p => ({ ...p, [id]: false }));
    }
  };

  const placeBet = async (id: number) => {
    const g = guess[id]?.trim();
    const a = amount[id];
    if (!g) return alert("Digite um palpite.");
    if (!a || parseFloat(a) <= 0) return alert("Digite um valor em ETH.");
    const ok = await withTx(id, () =>
      contract().placeBet(id, g, { value: ethers.parseEther(a) })
    );
    if (ok) alert(`✅ Aposta em "${g}" registrada!`);
  };

  const claimPrize = async (id: number) => {
    const ok = await withTx(id, () => contract().claimPrize(id));
    if (ok) alert("💰 Prêmio sacado com sucesso!");
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500">
      Carregando mercados…
    </div>
  );

  return (
    <div className="space-y-5">
      {statusMsg && (
        <div className="bg-indigo-900/40 border border-indigo-700 text-indigo-300 text-sm px-4 py-3 rounded-xl">
          ⏳ {statusMsg}
        </div>
      )}

      {markets.length === 0 && (
        <div className="text-center py-24 text-gray-600">
          <div className="text-5xl mb-4">🏆</div>
          <p className="text-lg">Nenhum mercado aberto.</p>
          {isAdmin && <p className="text-sm mt-2">Use a aba <strong>Admin</strong> para abrir um mercado.</p>}
        </div>
      )}

      {markets.map(m => {
        const bet        = userBets[m.id];
        const hasBet     = !!bet;
        const isWinner   = m.state === 2 && hasBet && bet.guess === m.winningGuess;
        const isBusy     = busy[m.id] ?? false;
        const prize      = isWinner ? calcPrize(m, bet, winnerPools[m.id] ?? 0n) : 0n;

        return (
          <div key={m.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-lg">
            {/* Cabeçalho do card */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">Mercado #{m.id}</p>
                <h2 className="text-lg font-bold text-white">{MARKET_TYPE_LABEL[m.marketType]}</h2>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${STATE_BADGE[m.state]}`}>
                {MARKET_STATE_LABEL[m.state]}
              </span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 border-b border-gray-800 text-center">
              {[
                ["Pool Total",   ethers.formatEther(m.totalPool) + " ETH"],
                ["Apostadores",  String(m.betCount)],
                ["Comissão",     Number(m.commission) / 100 + "%"],
              ].map(([label, value]) => (
                <div key={label} className="py-3 px-2">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-white font-semibold text-sm">{value}</p>
                </div>
              ))}
            </div>

            {/* Resultado oficial */}
            {m.state === 2 && (
              <div className="px-5 py-3 bg-purple-950/40 border-b border-purple-900/40">
                <p className="text-purple-300 text-sm">
                  🏆 Resultado oficial: <strong>{m.winningGuess}</strong>
                </p>
              </div>
            )}

            {/* Aposta do usuário */}
            {hasBet && (
              <div className="px-5 py-3 bg-indigo-950/40 border-b border-indigo-900/40">
                <p className="text-indigo-300 text-sm">
                  Sua aposta: <strong>{bet.guess}</strong> — {ethers.formatEther(bet.amount)} ETH
                </p>
              </div>
            )}

            {/* Ações */}
            <div className="p-5 space-y-3">
              {/* Form de aposta — só se mercado aberto e usuário ainda não apostou */}
              {m.state === 0 && !hasBet && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Palpite (ex: Brasil, Portugal…)"
                    value={guess[m.id] ?? ""}
                    onChange={e => setGuess(p => ({ ...p, [m.id]: e.target.value }))}
                    className="flex-1 bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none"
                  />
                  <input
                    type="number"
                    placeholder="ETH"
                    min="0"
                    step="0.001"
                    value={amount[m.id] ?? ""}
                    onChange={e => setAmount(p => ({ ...p, [m.id]: e.target.value }))}
                    className="w-24 bg-gray-800 border border-gray-700 focus:border-indigo-500 text-white placeholder-gray-600 rounded-xl px-3 py-2.5 text-sm outline-none"
                  />
                  <button
                    onClick={() => placeBet(m.id)}
                    disabled={isBusy}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-2.5 rounded-xl whitespace-nowrap"
                  >
                    {isBusy ? "…" : "Apostar"}
                  </button>
                </div>
              )}

              {m.state === 0 && hasBet && (
                <p className="text-gray-500 text-sm text-center py-1">
                  Sua aposta está registrada. Aguarde o encerramento.
                </p>
              )}

              {/* Sacar prêmio */}
              {isWinner && !claimed[m.id] && (
                <button
                  onClick={() => claimPrize(m.id)}
                  disabled={isBusy}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl shadow-lg shadow-green-900/30"
                >
                  {isBusy ? "Processando…" : `💰 Sacar Prêmio (~${Number(ethers.formatEther(prize)).toFixed(4)} ETH)`}
                </button>
              )}

              {isWinner && claimed[m.id] && (
                <p className="text-green-500 text-sm text-center py-2">✅ Prêmio já sacado</p>
              )}

              {m.state === 2 && hasBet && !isWinner && (
                <p className="text-gray-600 text-sm text-center py-2">
                  Seu palpite ({bet.guess}) não foi o vencedor.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
