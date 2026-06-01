import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { CONTRACTS, DAO_ABI, TOKEN_ABI } from "../contracts/config";

const PROPOSAL_TYPE_LABEL = ["Oficializar Resultado", "Alterar Comissão", "Sacar Taxas"];
const PROPOSAL_STATE_LABEL = ["Ativa", "Aprovada", "Rejeitada", "Executada"];
const STATE_BADGE = [
  "bg-blue-900/60 text-blue-300 border border-blue-800",
  "bg-green-900/60 text-green-300 border border-green-800",
  "bg-red-900/60 text-red-300 border border-red-800",
  "bg-gray-800 text-gray-400 border border-gray-700",
];

interface Proposal {
  id: number;
  proposalType: number;
  state: number;
  proposer: string;
  description: string;
  deadline: bigint;
  votesFor: bigint;
  votesAgainst: bigint;
}

interface Props {
  signer: ethers.Signer | null;
  address: string;
  onBalanceLoad: (bal: bigint) => void;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function countdown(deadline: bigint): string {
  const now  = BigInt(Math.floor(Date.now() / 1000));
  const diff = deadline - now;
  if (diff <= 0n) return "Encerrado";
  const h = Number(diff / 3600n);
  const m = Number((diff % 3600n) / 60n);
  return `${h}h ${m}m restantes`;
}

function pct(votes: bigint, total: bigint): string {
  if (total === 0n) return "0";
  return ((Number(votes) * 100) / Number(total)).toFixed(1);
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DAOPage({ signer, address, onBalanceLoad }: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [voted, setVoted]         = useState<Record<number, boolean>>({});
  const [balance, setBalance]     = useState(0n);
  const [votes, setVotes]         = useState(0n);
  const [delegated, setDelegated] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState<Record<number | string, boolean>>({});
  const [statusMsg, setStatusMsg] = useState("");

  // Form de nova proposta
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"settle" | "commission" | "fees">("settle");
  const [fMarketId, setFMarketId]   = useState("");
  const [fWinner, setFWinner]       = useState("");
  const [fPct, setFPct]             = useState("");
  const [fTo, setFTo]               = useState("");
  const [fDesc, setFDesc]           = useState("");

  const daoContract   = useCallback(() => new ethers.Contract(CONTRACTS.DAO,   DAO_ABI,   signer!), [signer]);
  const tokenContract = useCallback(() => new ethers.Contract(CONTRACTS.TOKEN, TOKEN_ABI, signer!), [signer]);

  const load = useCallback(async () => {
    if (!signer || !address) return;
    setLoading(true);
    try {
      const dao   = daoContract();
      const token = tokenContract();
      const total = Number(await dao.nextProposalId());
      const ps: Proposal[] = [];
      const vs: Record<number, boolean> = {};

      for (let i = 0; i < total; i++) {
        const p = await dao.getProposal(i);
        ps.push({
          id: i,
          proposalType:  Number(p.proposalType),
          state:         Number(p.state),
          proposer:      p.proposer,
          description:   p.description,
          deadline:      p.votingDeadline,
          votesFor:      p.votesFor,
          votesAgainst:  p.votesAgainst,
        });
        vs[i] = await dao.hasVoted(i, address);
      }

      const bal  = await token.balanceOf(address);
      const vts  = await token.getVotes(address);
      const del  = await token.delegates(address);

      setProposals(ps.reverse()); // mais recentes primeiro
      setVoted(vs);
      setBalance(bal);
      setVotes(vts);
      setDelegated(del.toLowerCase() !== ethers.ZeroAddress.toLowerCase());
      onBalanceLoad(bal);
    } finally {
      setLoading(false);
    }
  }, [signer, address, daoContract, tokenContract, onBalanceLoad]);

  useEffect(() => { load(); }, [load]);

  const withTx = async (key: number | string, action: () => Promise<ethers.TransactionResponse>) => {
    setBusy(p => ({ ...p, [key]: true }));
    setStatusMsg("Aguardando MetaMask…");
    try {
      const tx = await action();
      setStatusMsg("Aguardando a blockchain…");
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
      setBusy(p => ({ ...p, [key]: false }));
    }
  };

  const selfDelegate = () =>
    withTx("delegate", () => tokenContract().delegate(address));

  const vote = (id: number, support: boolean) =>
    withTx(`vote-${id}`, () => daoContract().vote(id, support));

  const finalize = (id: number) =>
    withTx(`fin-${id}`, () => daoContract().finalizeProposal(id));

  const execute = (id: number) =>
    withTx(`exec-${id}`, () => daoContract().executeProposal(id));

  const submitProposal = async () => {
    if (!fDesc.trim()) return alert("Digite uma descrição para a proposta.");
    const dao = daoContract();
    if (formType === "settle") {
      if (!fMarketId || !fWinner.trim()) return alert("Preencha marketId e resultado.");
      const ok = await withTx("propose", () =>
        dao.proposeSettleMarket(Number(fMarketId), fWinner.trim(), fDesc.trim())
      );
      if (ok) { setShowForm(false); alert("✅ Proposta criada!"); }
    } else if (formType === "commission") {
      if (!fPct || Number(fPct) > 1000) return alert("Taxa máxima: 1000 bps (10%).");
      const ok = await withTx("propose", () =>
        dao.proposeSetCommission(Number(fPct), fDesc.trim())
      );
      if (ok) { setShowForm(false); alert("✅ Proposta criada!"); }
    } else {
      if (!fTo || !ethers.isAddress(fTo)) return alert("Endereço inválido.");
      const ok = await withTx("propose", () =>
        dao.proposeWithdrawFees(fTo, fDesc.trim())
      );
      if (ok) { setShowForm(false); alert("✅ Proposta criada!"); }
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500">Carregando…</div>
  );

  const hasToken  = balance > 0n;
  const now       = BigInt(Math.floor(Date.now() / 1000));

  return (
    <div className="space-y-5">
      {statusMsg && (
        <div className="bg-indigo-900/40 border border-indigo-700 text-indigo-300 text-sm px-4 py-3 rounded-xl">
          ⏳ {statusMsg}
        </div>
      )}

      {/* Painel do token */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Seu Token de Governança (BGT)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500">Saldo</p>
            <p className="text-white font-semibold">{ethers.formatEther(balance)} BGT</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Poder de voto</p>
            <p className="text-white font-semibold">{ethers.formatEther(votes)} BGT</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Delegação</p>
            <p className={delegated ? "text-green-400 font-semibold" : "text-yellow-400 font-semibold"}>
              {delegated ? "Ativa ✓" : "Inativa"}
            </p>
          </div>
        </div>
        {!delegated && hasToken && (
          <button
            onClick={selfDelegate}
            disabled={busy["delegate"]}
            className="w-full bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-xl"
          >
            {busy["delegate"] ? "Processando…" : "Ativar poder de voto (auto-delegar)"}
          </button>
        )}
        {!hasToken && (
          <p className="text-gray-600 text-sm">Você não possui tokens BGT. Solicite ao admin.</p>
        )}
      </div>

      {/* Botão criar proposta */}
      {hasToken && (
        <button
          onClick={() => setShowForm(v => !v)}
          className="w-full bg-indigo-700 hover:bg-indigo-600 text-white font-medium py-2.5 rounded-xl"
        >
          {showForm ? "✕ Cancelar" : "+ Nova Proposta"}
        </button>
      )}

      {/* Formulário de nova proposta */}
      {showForm && hasToken && (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
          <h3 className="font-semibold text-white">Nova Proposta</h3>

          <div className="flex gap-2">
            {(["settle", "commission", "fees"] as const).map(t => (
              <button
                key={t}
                onClick={() => setFormType(t)}
                className={`flex-1 text-xs py-2 rounded-lg font-medium transition-all ${
                  formType === t
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {t === "settle" ? "Resultado" : t === "commission" ? "Taxa" : "Taxas"}
              </button>
            ))}
          </div>

          {formType === "settle" && (
            <div className="flex gap-2">
              <input
                type="number" placeholder="ID do Mercado"
                value={fMarketId} onChange={e => setFMarketId(e.target.value)}
                className="w-32 bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
              <input
                type="text" placeholder="Vencedor (ex: Brasil)"
                value={fWinner} onChange={e => setFWinner(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {formType === "commission" && (
            <input
              type="number" placeholder="Nova taxa em bps (ex: 500 = 5%)"
              value={fPct} onChange={e => setFPct(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          )}

          {formType === "fees" && (
            <input
              type="text" placeholder="Endereço destino (0x…)"
              value={fTo} onChange={e => setFTo(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          )}

          <textarea
            placeholder="Descrição da proposta…"
            value={fDesc} onChange={e => setFDesc(e.target.value)}
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 resize-none"
          />
          <button
            onClick={submitProposal}
            disabled={!!busy["propose"]}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-xl"
          >
            {busy["propose"] ? "Enviando…" : "Enviar Proposta"}
          </button>
        </div>
      )}

      {/* Lista de propostas */}
      {proposals.length === 0 && (
        <div className="text-center py-16 text-gray-600">
          <div className="text-4xl mb-3">🗳️</div>
          <p>Nenhuma proposta criada ainda.</p>
        </div>
      )}

      {proposals.map(p => {
        const isActive      = p.state === 0;
        const isPassed      = p.state === 1;
        const totalVotes    = p.votesFor + p.votesAgainst;
        const forPct        = pct(p.votesFor, totalVotes);
        const againstPct    = pct(p.votesAgainst, totalVotes);
        const hasVoted      = voted[p.id] ?? false;
        const deadlinePast  = p.deadline < now;

        return (
          <div key={p.id} className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800">
              <div className="space-y-1">
                <p className="text-xs text-gray-500">Proposta #{p.id} · {PROPOSAL_TYPE_LABEL[p.proposalType]}</p>
                <p className="text-white font-semibold">{p.description}</p>
                <p className="text-xs text-gray-600">por {short(p.proposer)}</p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold shrink-0 ml-3 ${STATE_BADGE[p.state]}`}>
                {PROPOSAL_STATE_LABEL[p.state]}
              </span>
            </div>

            {/* Votos */}
            <div className="px-5 py-4 space-y-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>A favor: {ethers.formatEther(p.votesFor)} BGT ({forPct}%)</span>
                <span>Contra: {ethers.formatEther(p.votesAgainst)} BGT ({againstPct}%)</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden flex">
                <div
                  className="bg-green-600 h-full transition-all"
                  style={{ width: `${forPct}%` }}
                />
                <div
                  className="bg-red-600 h-full transition-all"
                  style={{ width: `${againstPct}%` }}
                />
              </div>
              {isActive && (
                <p className="text-xs text-gray-500 text-right">{countdown(p.deadline)}</p>
              )}
            </div>

            {/* Ações */}
            <div className="px-5 pb-4 space-y-2">
              {/* Votar */}
              {isActive && !deadlinePast && hasToken && !hasVoted && (
                <div className="flex gap-2">
                  <button
                    onClick={() => vote(p.id, true)}
                    disabled={!!busy[`vote-${p.id}`]}
                    className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white font-medium py-2 rounded-xl text-sm"
                  >
                    {busy[`vote-${p.id}`] ? "…" : "👍 A Favor"}
                  </button>
                  <button
                    onClick={() => vote(p.id, false)}
                    disabled={!!busy[`vote-${p.id}`]}
                    className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white font-medium py-2 rounded-xl text-sm"
                  >
                    {busy[`vote-${p.id}`] ? "…" : "👎 Contra"}
                  </button>
                </div>
              )}

              {isActive && !deadlinePast && hasToken && hasVoted && (
                <p className="text-xs text-center text-gray-600 py-1">Você já votou nesta proposta.</p>
              )}

              {/* Finalizar */}
              {isActive && deadlinePast && (
                <button
                  onClick={() => finalize(p.id)}
                  disabled={!!busy[`fin-${p.id}`]}
                  className="w-full bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 text-white font-medium py-2 rounded-xl text-sm"
                >
                  {busy[`fin-${p.id}`] ? "Processando…" : "🔒 Finalizar Votação"}
                </button>
              )}

              {/* Executar */}
              {isPassed && (
                <button
                  onClick={() => execute(p.id)}
                  disabled={!!busy[`exec-${p.id}`]}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl text-sm"
                >
                  {busy[`exec-${p.id}`] ? "Executando…" : "⚡ Executar Proposta"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
