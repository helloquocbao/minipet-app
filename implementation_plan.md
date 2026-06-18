# Implementation Plan: Unify Wallet System under Single zkLogin Wallet

This plan details the removal of the secondary "AI Agent" Burner Wallet, unifying all interactions (Pet companion activities, Auto-Trading, and AI tool execution) under a single **zkLogin Wallet**.

## User Review Required

> [!IMPORTANT]
> - **Unified Wallet Experience**: The secondary Burner (Agent) Wallet card will be completely removed from the Settings UI. The user's Google zkLogin address becomes the sole wallet for both holding pets and executing trades.
> - **Direct On-Chain signing via zkLogin**: Tauri will now fetch the ZK Proof from the dev prover service and sign transactions directly using the zkLogin ephemeral key.

## Proposed Changes

### 1. Settings HTML Layout
#### [MODIFY] [index.html](file:///Users/sdj/VICENT-Project/minipet/minipet-tauri/src/renderer/settings/index.html)
- Remove the entire **AI Agent** section (the card with Burner/zkLogin segmented controls and Agent Address output).
- Update the **Web3 Connection** section to clarify that sync connects a Google zkLogin account.

### 2. Settings JS/TS Logic
#### [MODIFY] [settings.ts](file:///Users/sdj/VICENT-Project/minipet/minipet-tauri/src/renderer/settings/settings.ts)
- Remove references to `mode-agent`, `agent-address-input`, `copy-agent-address-btn`, and the burner `generate_agent_keypair` invoke call.
- Simplify state loading to only handle the main zkLogin Sui Address and its synced session status.

### 3. Overlay App & Transaction Execution
#### [MODIFY] [overlay.ts](file:///Users/sdj/VICENT-Project/minipet/minipet-tauri/src/renderer/overlay/overlay.ts)
- Update `handleDeepLinkUrl(url)`:
  - Parse the `zkloginPayload` URL search parameter.
  - Decode from base64 and update Tauri settings with `zkLoginSession`.
- Update AI Tool executors (`transfer_sui`, `swap_sui_to_usdc`, `bonk_pet`, `send_pet_gift`):
  - Read `zkLoginSession` from settings.
  - Execute transactions using the zkLogin signing flow (fetch ZK Proof from prover service, sign with ephemeral key, combine signature, execute).

### 4. Blockchain Monitoring
#### [MODIFY] [monitor.ts](file:///Users/sdj/VICENT-Project/minipet/minipet-tauri/src/renderer/blockchain/monitor.ts)
- Update `checkAgentBalance` to monitor the main zkLogin address balance instead of the separate burner wallet.

---

## Verification Plan

### Automated Tests
- Run `npm run typecheck && npm run lint` to confirm no compilation issues.

### Manual Verification
- Launch tauri application using `npm run tauri dev`.
- Sync zkLogin wallet from browser, verify the single zkLogin address is saved and active.
- Verify transaction tools sign successfully using the zkLogin ephemeral session.
