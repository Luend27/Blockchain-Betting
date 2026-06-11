# Sistema de Apostas Descentralizado — Copa do Mundo

Projeto acadêmico de um DApp completo com governança DAO e interface web3 para apostas na Copa do Mundo, desenvolvido com **Solidity**, **Hardhat 3**, **Ethers.js v6**, **OpenZeppelin 5** e **React + Vite**.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Contratos na Sepolia](#contratos-na-sepolia)
- [Arquitetura dos Contratos](#arquitetura-dos-contratos)
- [Interface Web (Trabalho 04)](#interface-web-trabalho-04)
- [Fluxo Completo do Sistema](#fluxo-completo-do-sistema)
- [Segurança](#segurança)
- [Tecnologias Utilizadas](#tecnologias-utilizadas)
- [Como Rodar Localmente](#como-rodar-localmente)
- [Deploy na Testnet Sepolia](#deploy-na-testnet-sepolia)
- [Estrutura do Projeto](#estrutura-do-projeto)
---

## Visão Geral

O projeto cobre três trabalhos que formam um sistema integrado:

| Trabalho | Componente | Responsabilidade |
|---|---|---|
| **Trabalho 02** | `WorldCupBetting.sol` | Receber apostas, gerenciar pools e distribuir prêmios |
| **Trabalho 03** | `BettingToken.sol` + `BettingDAO.sol` | Governança descentralizada via tokens ERC20 e votação |
| **Trabalho 04** | `frontend/` (React + Vite) | Interface web3 com MetaMask para usuários finais |

A DAO é o **owner** do contrato de apostas: qualquer decisão estratégica (oficializar resultado, alterar taxa, sacar taxas) exige proposta aprovada por votação dos detentores de tokens de governança.

---

## Contratos na Sepolia
---

## Arquitetura dos Contratos

### WorldCupBetting.sol (Trabalho 02)

Contrato principal de apostas. Gerencia mercados, recebe fundos e distribui prêmios.

#### Mercados suportados

```
enum MarketType  { CHAMPION, TOP_SCORER }
enum MarketState { OPEN, CLOSED, SETTLED }
```

| Tipo | Descrição |
|---|---|
| `CHAMPION` | Apostas na seleção campeã |
| `TOP_SCORER` | Apostas no artilheiro da competição |

#### Ciclo de vida de um mercado

```
openMarket()                placeBet()
    │                          │
    ▼                          ▼
[ OPEN ] ──── closeMarket() ──► [ CLOSED ] ──── settleMarket(winner) ──► [ SETTLED ]
                                                                               │
                                                          claimPrize() ◄───────┘
```

#### Modelo de apostas (pari-mutuel)

O sistema não usa odds fixas. O prêmio é distribuído proporcionalmente entre os vencedores:

```
taxa         = totalPool × commissionPct / 10.000
distribuível = totalPool − taxa
prêmio_i     = (aposta_i / totalApostasVencedoras) × distribuível
```

**Exemplo:** Pool = 5 ETH, taxa 3%, vencedores apostaram 4 ETH:
- Apostador A (1 ETH de 4 ETH vencedores): recebe `(1/4) × 4,85 = 1,2125 ETH`
- Apostador B (3 ETH de 4 ETH vencedores): recebe `(3/4) × 4,85 = 3,6375 ETH`

> O palpite é uma `string` case-sensitive (ex: `"Brasil"`). A interface padroniza o texto antes de enviar.

#### Funções principais

| Função | Acesso | Descrição |
|---|---|---|
| `openMarket(type)` | owner/DAO | Abre novo mercado |
| `closeMarket(id)` | owner/DAO | Encerra apostas |
| `settleMarket(id, winner)` | owner/DAO | Liquida com resultado oficial |
| `placeBet(id, guess)` | público | Registra aposta (payable) |
| `claimPrize(id)` | apostador | Saca prêmio proporcional |
| `setCommission(bps)` | owner/DAO | Altera taxa (max 10%) |
| `withdrawFees(to)` | owner/DAO | Saca taxas acumuladas |

---

### BettingToken.sol (Trabalho 03)

Token ERC20 de governança com suporte a **voto delegado** (ERC20Votes).

| Atributo | Valor |
|---|---|
| Nome | Betting Governance Token |
| Símbolo | BGT |
| Supply máximo | 1.000.000 BGT |
| Padrão | ERC20 + ERC20Votes + ERC20Permit |

> Cada detentor precisa chamar `delegate(self)` uma vez para ativar seu poder de voto. O sistema usa **snapshots por bloco** para evitar que tokens comprados após a criação de uma proposta sejam usados para votar nela.

---

### BettingDAO.sol (Trabalho 03)

Organização Autônoma Descentralizada que governa o `WorldCupBetting`.

#### Arquitetura de autoridade

```
                    ┌─────────────────────────────────┐
                    │           BettingDAO             │
                    │                                  │
  Admin (owner) ───►│  adminOpenMarket()               │
                    │  adminCloseMarket()              │
                    │                                  │
  Token Holders ───►│  proposeSettleMarket()  ─────────┼──► VOTE ──► EXECUTE ──► WorldCupBetting.settleMarket()
                    │  proposeSetCommission() ─────────┼──► VOTE ──► EXECUTE ──► WorldCupBetting.setCommission()
                    │  proposeWithdrawFees()  ─────────┼──► VOTE ──► EXECUTE ──► WorldCupBetting.withdrawFees()
                    └─────────────────────────────────┘
                                  │ owner
                                  ▼
                        ┌──────────────────┐
                        │ WorldCupBetting  │
                        └──────────────────┘
```

#### Tipos de proposta

| Tipo | Ação executada | Parâmetros |
|---|---|---|
| `SETTLE_MARKET` | Oficializa resultado (oráculo descentralizado) | `marketId`, `winningGuess` |
| `SET_COMMISSION` | Altera taxa de comissão | `newPct` (em basis points) |
| `WITHDRAW_FEES` | Saca taxas acumuladas | `to` (endereço de destino) |

#### Ciclo de vida de uma proposta

```
proposeX()
    │
    ▼
[ ACTIVE ] ◄── vote() (durante votingDuration)
    │
    │ (após prazo)
    ▼
finalizeProposal()
    │
    ├── quorum atingido E votesFor > votesAgainst ──► [ PASSED ] ──► executeProposal() ──► [ EXECUTED ]
    │
    └── caso contrário ──────────────────────────────► [ REJECTED ]
```

#### Regras de votação

| Parâmetro | Valor padrão | Descrição |
|---|---|---|
| `votingDuration` | 3 dias | Duração do período de votação |
| `quorumBps` | 1.000 (10%) | Mínimo de tokens participantes |
| Maioria | Simples | `votesFor > votesAgainst` |
| Peso do voto | Proporcional | 1 BGT = 1 voto (snapshot por bloco) |

---

## Interface Web (Trabalho 04)

Aplicação React que conecta o usuário aos contratos via MetaMask, abstraindo toda a complexidade da blockchain.

### Telas disponíveis

| Aba | Visível para | Funcionalidades |
|---|---|---|
| **Apostas** | Todos | Ver mercados, registrar aposta com ETH, sacar prêmio proporcional |
| **Governança** | Holders de BGT | Ver propostas, votar, finalizar, executar, criar nova proposta |
| **Admin** | Owner da DAO | Abrir/fechar mercados, emitir BGT para gestores |

### Fluxo do usuário

```
1. Acessa o site
2. Clica "Conectar MetaMask"
3. MetaMask pede aprovação → confirma
4. App detecta rede; se não for Sepolia, exibe botão "Mudar para Sepolia"
5. Vê mercados abertos, digita o palpite + valor em ETH e clica "Apostar"
6. MetaMask pede confirmação da transação → confirma
7. Quando o resultado for oficializado via DAO, o botão "Sacar Prêmio" aparece
```

---

## Fluxo Completo do Sistema

### Trabalho 02 — Realizar uma aposta e sacar prêmio

```
1. [Admin]     Aba Admin → "Abrir Mercado" → escolhe CHAMPION ou TOP_SCORER
2. [Usuário]   Aba Apostas → digita palpite + ETH → clica "Apostar"
3. [Admin]     Aba Admin → "Fechar Mercado" (encerra apostas)
4. [Governança → Trabalho 03] Resultado é oficializado via votação
5. [Usuário]   Botão "Sacar Prêmio" aparece na aba Apostas
```

### Trabalho 03 — Oficializar resultado via governança

```
1. [Gestor]   Aba Governança → "Ativar poder de voto" (auto-delegação)
              Clica "+ Nova Proposta" → tipo Resultado → preenche marketId e vencedor

2. [Gestores] Votam "A Favor" ou "Contra" durante o prazo

3. [Qualquer] Após o prazo → clica "Finalizar Votação" → registra PASSED/REJECTED

4. [Qualquer] Se PASSED → clica "Executar Proposta" → chama settleMarket no contrato

5. [Usuários] Apostas liberadas para saque na aba Apostas
```

---

## Segurança

| Mecanismo | Contrato | Proteção |
|---|---|---|
| `ReentrancyGuard` | WorldCupBetting, BettingDAO | Ataques de reentrância em `claimPrize`, `withdrawFees`, `executeProposal` |
| `Ownable` | WorldCupBetting, BettingToken | Funções administrativas restritas ao owner (DAO) |
| `ERC20Votes` snapshot | BettingToken | Impede compra de tokens para votar em propostas existentes |
| Validação de estado | WorldCupBetting | Transições de estado explícitas (OPEN→CLOSED→SETTLED) |
| `MAX_COMMISSION` | WorldCupBetting | Taxa limitada a 10% (1.000 basis points) |
| Aposta única por endereço | WorldCupBetting | Previne múltiplas apostas no mesmo mercado |
| Quorum mínimo | BettingDAO | Proposta rejeitada se participação insuficiente |
| `hasClaimed` | WorldCupBetting | Previne duplo saque de prêmio |

---

## Tecnologias Utilizadas

| Tecnologia | Versão | Uso |
|---|---|---|
| Solidity | 0.8.28 | Linguagem dos contratos inteligentes |
| Hardhat | 3.7.0 | Framework de desenvolvimento e testes |
| Ethers.js | 6.16.0 | Interação com a blockchain (contratos e front-end) |
| OpenZeppelin | 5.6.1 | Contratos base (ReentrancyGuard, Ownable, ERC20Votes) |
| TypeScript | 6.0.3 | Tipagem estática em scripts, testes e front-end |
| Mocha + Chai | — | Framework de testes (59 testes) |
| React | 18.3 | Framework front-end |
| Vite | 5.4 | Build e dev server do front-end |
| Tailwind CSS | 3.4 | Estilização da interface |

---

## Como Rodar Localmente

### Pré-requisitos

- [Node.js](https://nodejs.org/) v18 ou superior
- [MetaMask](https://metamask.io/) instalado no navegador
- npm v8 ou superior

---

### Contratos (Hardhat)

```bash
# 1. Instalar dependências
npm install

# 2. Compilar contratos
npm run compile

# 3. Executar os 59 testes automatizados
npm test

# 4. Deploy na rede local (para testes)
npm run deploy:local
```

---

### Interface Web (React)

```bash
cd frontend

# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento
npm run dev
# → http://localhost:5173

# 3. Build de produção
npm run build
```

> Para testar o front-end localmente, configure o MetaMask na rede Sepolia e use os endereços de contrato já deployados.

---

## Deploy na Testnet Sepolia

### Configuração do ambiente

```bash
# Copie o arquivo de exemplo e preencha
cp .env.example .env
```

```env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/SEU_PROJECT_ID
SEPOLIA_PRIVATE_KEY=0xSUA_CHAVE_PRIVADA
ETHERSCAN_API_KEY=SUA_ETHERSCAN_API_KEY
```

> **Nunca** compartilhe sua chave privada. O `.env` está no `.gitignore`.

### Obter ETH de teste

- [sepoliafaucet.com](https://sepoliafaucet.com)
- [faucets.chain.link/sepolia](https://faucets.chain.link/sepolia)

### Deploy dos contratos

```bash
npm run deploy:sepolia
```

### Deploy do front-end (Vercel)

```bash
cd frontend
npx vercel --prod
```

O Vercel detecta automaticamente o Vite e gera uma URL pública em ~1 minuto.

### Pós-deploy dos contratos

```bash
# 1. Emitir tokens BGT para os gestores (via Admin ou console)
token.mint("0xEnderecoGestor", ethers.parseEther("3000"))

# 2. Cada gestor ativa o poder de voto (na aba Governança ou console)
token.connect(gestor).delegate(gestor.address)

# 3. Abrir mercado (aba Admin ou console)
dao.adminOpenMarket(0)  // 0 = CHAMPION, 1 = TOP_SCORER
```

---

## Estrutura do Projeto

```
blockchain-betting/
│
├── contracts/
│   ├── WorldCupBetting.sol          # Apostas (Trabalho 02)
│   ├── BettingToken.sol             # Token de governança BGT (Trabalho 03)
│   └── BettingDAO.sol               # DAO de governança (Trabalho 03)
│
├── scripts/
│   └── deploy.ts                    # Deploy completo (local + Sepolia)
│
├── test/
│   ├── 01-WorldCupBetting.test.ts   # 32 testes — Trabalho 02
│   └── 02-BettingDAO.test.ts        # 27 testes — Trabalho 03
│
├── frontend/                        # Interface Web (Trabalho 04)
│   ├── src/
│   │   ├── contracts/config.ts      # Endereços Sepolia + ABIs
│   │   ├── hooks/useWallet.ts       # Hook MetaMask + Sepolia
│   │   ├── components/Header.tsx    # Navbar + wallet button
│   │   └── pages/
│   │       ├── BettingPage.tsx      # Aba Apostas
│   │       ├── DAOPage.tsx          # Aba Governança
│   │       └── AdminPage.tsx        # Aba Admin
│   └── package.json
│
├── hardhat.config.ts                # Hardhat 3 + TypeScript + Sepolia
├── tsconfig.json
├── .env.example
├── .gitignore
└── package.json
```

---

## Grupo 01
**Tópicos Especiais em Computação — Blockchain**
**Blockchain Betting**

| Nome |
|---|
| Carlos Eduardo |
| Juliano Farias|
| Luendell Reis|
| Mateus Cavalcante |
