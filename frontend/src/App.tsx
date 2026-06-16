import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useWallet } from "./hooks/useWallet";
import { Header } from "./components/Header";
import { BettingPage } from "./pages/BettingPage";
import { DAOPage } from "./pages/DAOPage";
import { AdminPage } from "./pages/AdminPage";
import { CONTRACTS, DAO_ABI } from "./contracts/config";

type Tab = "betting" | "dao" | "admin";

export default function App() {
  const wallet = useWallet();
  const [activeTab, setActiveTab] = useState<Tab>("betting");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0n);

  // Verifica se o endereço conectado é o admin da DAO
  useEffect(() => {
    if (!wallet.signer || !wallet.address) { setIsAdmin(false); return; }
    const dao = new ethers.Contract(CONTRACTS.DAO, DAO_ABI, wallet.signer);
    dao.owner().then((owner: string) => {
      setIsAdmin(owner.toLowerCase() === wallet.address.toLowerCase());
    }).catch(() => setIsAdmin(false));
  }, [wallet.signer, wallet.address]);

  return (
    <div className="min-h-screen bg-[#0d1411]">
      <Header
        {...wallet}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isAdmin={isAdmin}
      />

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Não conectado */}
        {!wallet.isConnected && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-6xl mb-6">⚽</div>
            <h1 className="text-3xl font-bold text-white mb-3">Copa do Mundo Betting</h1>
            <p className="text-gray-400 mb-2 max-w-md">
              Plataforma descentralizada de apostas na Copa do Mundo com governança DAO.
            </p>
            <p className="text-gray-500 text-sm mb-8">
              Rede: <span className="text-indigo-400 font-mono">Sepolia Testnet</span>
            </p>
            <button
              onClick={wallet.connect}
              disabled={wallet.isConnecting}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-8 py-3 rounded-xl text-lg shadow-lg shadow-indigo-900/40"
            >
              {wallet.isConnecting ? "Conectando…" : "🦊 Conectar MetaMask"}
            </button>
          </div>
        )}

        {/* Rede errada */}
        {wallet.isConnected && wallet.isWrongNetwork && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-white mb-2">Rede incorreta</h2>
            <p className="text-gray-400 mb-6">Esta DApp funciona na rede <strong>Sepolia Testnet</strong>.</p>
            <button
              onClick={wallet.switchToSepolia}
              className="bg-orange-600 hover:bg-orange-500 text-white font-semibold px-6 py-2.5 rounded-xl"
            >
              Mudar para Sepolia
            </button>
          </div>
        )}

        {/* App principal */}
        {wallet.isConnected && !wallet.isWrongNetwork && (
          <>
            {activeTab === "betting" && (
              <BettingPage signer={wallet.signer} address={wallet.address} isAdmin={isAdmin} />
            )}
            {activeTab === "dao" && (
              <DAOPage signer={wallet.signer} address={wallet.address} onBalanceLoad={setTokenBalance} />
            )}
            {activeTab === "admin" && isAdmin && (
              <AdminPage signer={wallet.signer} address={wallet.address} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
