---
license: apache-2.0
language:
  - en
  - vi
base_model: Qwen/Qwen2.5-1.5B-Instruct
tags:
  - gguf
  - sui-blockchain
  - desktop-pet
  - tool-calling
  - on-device
  - quantized
library_name: llama-cpp
pipeline_tag: text-generation
model-index:
  - name: minipet-qwen-model-SUI
    results: []
---

# MiniPet Qwen SUI — On-Device AI Pet Assistant 🐾🧠

A fine-tuned **Qwen 2.5 1.5B** model, quantized to **Q4_K_M (GGUF)**, purpose-built for [MiniPet](https://github.com/helloquocbao/minipet-app) — an animated desktop pet that lives on your screen and helps you interact with the SUI blockchain.

## Key Features

- **100% Offline** — Runs locally via `llama-server` sidecar. No API keys, no internet required.
- **SUI Blockchain Tool Calling** — Trained to invoke structured tools: transfer SUI, swap tokens, check balances, bonk pets, send gifts, manage whitelists.
- **Multilingual** — Responds in Vietnamese, English, French, Chinese, Italian, and Korean based on user settings.
- **Personality** — Short, cute, and helpful responses matching a virtual pet companion character.
- **Pomodoro & Productivity** — Can set timers and manage focus sessions via natural language.

## Model Details

| Property | Value |
|---|---|
| Base Model | [Qwen/Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) |
| Fine-tuning | SUI blockchain tools, pet personality, multilingual responses |
| Quantization | Q4_K_M (4-bit, GGUF) |
| File Size | ~986 MB |
| Context Length | 2048 tokens |
| Architecture | Qwen2 (2B params before quantization) |

## Intended Use

This model is designed exclusively as the embedded AI brain for MiniPet desktop application:

1. **Desktop Pet Chat** — Double-click the pet to chat. The model responds with short, personality-driven answers.
2. **On-Chain Actions** — When users request blockchain operations, the model outputs structured `<tool_call>` JSON that the app intercepts and executes via zkLogin.
3. **Context-Aware Assistance** — Knows the current time, active app, and user's wallet state.

## Supported Tools

| Tool | Description |
|---|---|
| `transfer_sui` | Send SUI to an address or saved contact |
| `check_wallet_balance` | Query wallet balance on SUI testnet |
| `swap_sui_to_usdc` | Swap SUI tokens to USDC |
| `set_pomodoro_timer` | Start/stop focus timer |
| `bonk_pet` | Interact with on-chain PetNFT (bonk) |
| `send_pet_gift` | Send a gift to another pet |
| `rename_pet` | Rename the user's PetNFT |
| `check_pet_stats` | View pet level and stats |
| `start_auto_trade` / `stop_auto_trade` | Control simulated auto-trading |
| `add_fast_transfer_wallet` | Add contact to whitelist |

## Usage with llama.cpp

```bash
# Start local server (used by MiniPet app internally)
llama-server -m qwen-sui-q4_k_m.gguf --port 8080 -c 2048

# Or use the HuggingFace shorthand
llama-server -hf iamquocbao/minipet-qwen-model-SUI:Q4_K_M
```

Then query via OpenAI-compatible API at `http://127.0.0.1:8080/v1/chat/completions`.

## Usage with MiniPet App

The model is automatically downloaded on first launch. No manual setup needed.

```
~/Library/Application Support/com.minipet.app/minipet-qwen-model-SUI.gguf
```

## Limitations

- **Not a general-purpose LLM** — Fine-tuned specifically for short pet assistant responses and SUI tool calling. May produce lower quality results for general knowledge tasks.
- **Simulated Trading** — Auto-trade tools are simulated (paper mode) and do not execute real on-chain swaps until mainnet launch.
- **Context Window** — Limited to 2048 tokens. Long conversations may lose earlier context.

## License

Apache 2.0 — same as the base Qwen 2.5 model.

## Links

- 🐾 **MiniPet App**: [github.com/helloquocbao/minipet-app](https://github.com/helloquocbao/minipet-app)
- 🌐 **Web App**: [onchain.minipet.xyz](https://onchain.minipet.xyz)
- 🔗 **SUI Contract**: Deployed on SUI Testnet
