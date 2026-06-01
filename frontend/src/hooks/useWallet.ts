import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { SEPOLIA_CHAIN_ID, SEPOLIA_HEX } from "../contracts/config";

export interface WalletState {
  address: string;
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  chainId: bigint;
  isConnected: boolean;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToSepolia: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [address, setAddress]     = useState("");
  const [provider, setProvider]   = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner]       = useState<ethers.Signer | null>(null);
  const [chainId, setChainId]     = useState<bigint>(0n);
  const [isConnecting, setIsConnecting] = useState(false);

  const isConnected    = !!address;
  const isWrongNetwork = isConnected && chainId !== SEPOLIA_CHAIN_ID;

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("MetaMask não encontrado.\nInstale a extensão em metamask.io e recarregue a página.");
      return;
    }
    setIsConnecting(true);
    try {
      const prov = new ethers.BrowserProvider(window.ethereum);
      await prov.send("eth_requestAccounts", []);
      const sign = await prov.getSigner();
      const net  = await prov.getNetwork();
      setProvider(prov);
      setSigner(sign);
      setAddress(await sign.getAddress());
      setChainId(net.chainId);
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code !== 4001) alert("Erro ao conectar: " + e.message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress("");
    setProvider(null);
    setSigner(null);
    setChainId(0n);
  }, []);

  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_HEX }],
      });
    } catch (err: unknown) {
      const e = err as { code?: number };
      if (e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SEPOLIA_HEX,
            chainName: "Sepolia Testnet",
            nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          }],
        });
      }
    }
  }, []);

  // Reage a mudanças de conta ou rede no MetaMask
  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = (accounts: unknown) => {
      const list = accounts as string[];
      if (list.length === 0) disconnect();
      else if (isConnected) connect();
    };
    const onChainChanged = () => window.location.reload();

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener("chainChanged", onChainChanged);
    };
  }, [connect, disconnect, isConnected]);

  return {
    address, provider, signer, chainId,
    isConnected, isConnecting, isWrongNetwork,
    connect, disconnect, switchToSepolia,
  };
}
