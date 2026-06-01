import { WalletState } from "../hooks/useWallet";
import { SEPOLIA_CHAIN_ID } from "../contracts/config";

type Tab = "betting" | "dao" | "admin";

interface Props extends WalletState {
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  isAdmin: boolean;
}

const short = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

export function Header({
  address, chainId, isConnected, isConnecting, isWrongNetwork,
  connect, disconnect, switchToSepolia,
  activeTab, setActiveTab, isAdmin,
}: Props) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "betting", label: "⚽ Apostas" },
    { id: "dao",     label: "🗳️ Governança" },
    ...(isAdmin ? [{ id: "admin" as Tab, label: "⚙️ Admin" }] : []),
  ];

  return (
    <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xl">⚽</span>
          <span className="font-bold text-white hidden sm:block">Copa Betting</span>
        </div>

        {/* Tabs — só aparecem quando conectado e na rede certa */}
        {isConnected && !isWrongNetwork && (
          <nav className="flex gap-1 flex-1 justify-center">
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === id
                    ? "bg-indigo-600 text-white shadow"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}

        {/* Wallet area */}
        <div className="flex items-center gap-2 shrink-0">
          {isConnected && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                chainId === SEPOLIA_CHAIN_ID
                  ? "bg-green-900/60 text-green-300 border border-green-800"
                  : "bg-red-900/60 text-red-300 border border-red-800"
              }`}
            >
              {chainId === SEPOLIA_CHAIN_ID ? "● Sepolia" : "⚠ Rede errada"}
            </span>
          )}

          {isWrongNetwork ? (
            <button
              onClick={switchToSepolia}
              className="bg-orange-600 hover:bg-orange-500 text-white text-sm px-3 py-1.5 rounded-lg font-medium"
            >
              Mudar rede
            </button>
          ) : isConnected ? (
            <button
              onClick={disconnect}
              title="Clique para desconectar"
              className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-sm px-3 py-1.5 rounded-lg font-mono"
            >
              {short(address)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg font-medium"
            >
              {isConnecting ? "Conectando…" : "Conectar MetaMask"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
