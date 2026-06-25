# ✦ Duo — AI-Consensus Challenge Arena

Duo is an elite, decentralized 1v1 challenge and peer-review arena built on GenLayer. It matches developers, writers, designers, and creatives in high-stakes duels where subjective solutions are evaluated by a decentralized panel of AI validators.

🔗 **Vercel Web App:** *Available once deployed*
📜 **Contract (GenLayer Studionet):** *Pending deployment*

---

## 🎯 The Vision

Traditional smart contracts are limited to objective, structured inputs (such as numbers, addresses, and boolean states). They cannot read a block of code and judge if it is elegant, or evaluate a product description for creativity. Consequently, online competitive arenas either have no stakes or rely on slow, biased, and centralized human referees.

Duo leverages **GenLayer's Intelligent Contracts** to execute subjective judgments trustlessly. Multiple validators run Large Language Models and compare their independent evaluations under the **Equivalence Principle**. This enables an instant, neutral, and secure judging process.

---

## 🔄 Core Protocol Flow

1. **Host a Challenge:** A user selects a category (e.g. Coding), defines the prompt parameters, and stakes a set amount of GEN tokens.
2. **Opponent Acceptance:** Another user matches the staked amount to lock the duel and active matchmaking.
3. **Double Submission:** Both participants draft and submit their answers independently.
4. **AI Verdict & Resolution:** A decentralized validator consensus scores both inputs on Quality, Correctness, and Ingenuity. The higher score secures the entire prize pool, automatically transferred by the contract.

---

## 📜 Contract API Reference

The `DuoArena` contract exposes the following write and view methods:

### Write Methods (State Modifying)
- `open_challenge(category: str, prompt: str) -> i32 (payable)`: Opens a new challenge in the arena. The caller must attach a positive GEN stake.
- `accept_challenge(challenge_id: str) (payable)`: Matches the challenger's stake and locks the challenge to the active matching phase.
- `submit_solution(challenge_id: str, solution: str)`: Allows participants to submit their draft response (allowed during matching or submission phases).
- `evaluate_challenge(challenge_id: str)`: Runs the decentralized AI consensus evaluation. It distributes the combined staked pools to the winner and updates the status to resolved.
- `cancel_challenge(challenge_id: str)`: Allows the challenger to cancel an open challenge before any opponent accepts, returning the full stake.

### View Methods (Read Only)
- `get_challenge(challenge_id: str) -> str`: Returns the full state of the challenge serialized as a JSON string.
- `get_challenge_count() -> i32`: Returns the total number of challenges initialized in the arena.

