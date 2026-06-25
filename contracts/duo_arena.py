# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json
import typing
from datetime import datetime, timezone


class DuoArena(gl.Contract):
    """
    DuoArena is a decentralized 1v1 challenge platform where participants stake GEN
    tokens on subjective skills (such as coding, writing, design, and math).
    Decisions are evaluated by a decentralized panel of AI validators using GenLayer's
    Equivalence Principle to ensure non-bias and consensus.
    """
    
    challenge_count: i32
    challenges: TreeMap[str, str]

    def __init__(self):
        """
        Initializes the DuoArena contract with an empty challenge tracker.
        """
        self.challenge_count = i32(0)

    @gl.public.write.payable
    def open_challenge(self, category: str, prompt: str) -> i32:
        """
        Creates a new 1v1 challenge in the arena. The challenger must stake GEN tokens.
        """
        value = gl.message.value
        if value == u256(0):
            raise gl.advanced.user_error_immediate("Must stake GEN tokens to open a challenge")

        self.challenge_count = i32(int(self.challenge_count) + 1)
        challenge_id = str(int(self.challenge_count))
        
        # In GenVM, datetime.now() is overridden to return the deterministic transaction timestamp
        current_time = int(datetime.now(timezone.utc).timestamp())

        challenge_data = {
            "id": challenge_id,
            "challenger": str(gl.message.sender_address),
            "opponent": "",
            "category": category,
            "prompt": prompt,
            "solution_challenger": "",
            "solution_opponent": "",
            "stake_challenger": str(value),
            "stake_opponent": "0",
            "status": 0,  # 0 = Open, 1 = Matched, 2 = SolutionsSubmitted, 3 = Judged
            "winner": "",
            "verdict_data": "",
            "created_at": current_time,
        }
        
        self.challenges[challenge_id] = json.dumps(challenge_data)
        return self.challenge_count

    @gl.public.write.payable
    def accept_challenge(self, challenge_id: str) -> None:
        """
        Accepts an open challenge. The opponent must match the challenger's stake.
        """
        challenge = json.loads(self.challenges[challenge_id])
        
        if challenge["status"] != 0:
            raise gl.advanced.user_error_immediate("Challenge is no longer open")
        if str(gl.message.sender_address) == challenge["challenger"]:
            raise gl.advanced.user_error_immediate("Cannot accept your own challenge")
            
        value = gl.message.value
        if value != u256(int(challenge["stake_challenger"])):
            raise gl.advanced.user_error_immediate("Staked amount must match the challenger's stake exactly")

        challenge["opponent"] = str(gl.message.sender_address)
        challenge["stake_opponent"] = str(value)
        challenge["status"] = 1  # Matched
        
        self.challenges[challenge_id] = json.dumps(challenge)

    @gl.public.write
    def submit_solution(self, challenge_id: str, solution: str) -> None:
        """
        Submits a solution for either the challenger or the opponent.
        Once both solutions are received, the status transitions to SolutionsSubmitted.
        """
        challenge = json.loads(self.challenges[challenge_id])
        
        if challenge["status"] != 1 and challenge["status"] != 2:
            raise gl.advanced.user_error_immediate("Challenge is not accepting solutions at this stage")

        sender = str(gl.message.sender_address)
        
        if sender == challenge["challenger"]:
            if challenge["solution_challenger"]:
                raise gl.advanced.user_error_immediate("Challenger has already submitted a solution")
            challenge["solution_challenger"] = solution
        elif sender == challenge["opponent"]:
            if challenge["solution_opponent"]:
                raise gl.advanced.user_error_immediate("Opponent has already submitted a solution")
            challenge["solution_opponent"] = solution
        else:
            raise gl.advanced.user_error_immediate("Sender is not a participant in this challenge")

        # Update status if both have submitted
        if challenge["solution_challenger"] and challenge["solution_opponent"]:
            challenge["status"] = 2  # SolutionsSubmitted

        self.challenges[challenge_id] = json.dumps(challenge)

    @gl.public.write
    def evaluate_challenge(self, challenge_id: str) -> typing.Any:
        """
        Triggers the decentralized AI consensus evaluation of the challenge submissions.
        Payout is sent to the winner and the state is updated.
        """
        challenge = json.loads(self.challenges[challenge_id])
        if challenge["status"] != 2:
            raise gl.advanced.user_error_immediate("Both participants must submit solutions before evaluation")

        def leader_fn():
            """
            Runs the core non-deterministic logic on the leader node.
            This function is the direct entry point for gl.nondet.exec_prompt.
            """
            evaluation_prompt = f"""You are a professional, neutral judge evaluating a 1v1 skill duel.

CATEGORY: {challenge["category"]}
CHALLENGE PROMPT: {challenge["prompt"]}

SOLUTION A (Challenger):
{challenge["solution_challenger"]}

SOLUTION B (Opponent):
{challenge["solution_opponent"]}

Analyze both solutions strictly on:
1. Correctness: Does it solve the challenge requirements?
2. Quality: Efficiency, elegance, structure, and readability.
3. Ingenuity: Unique approaches or smart implementation details.
4. Robustness: Handling of edge cases and exceptions.

You must respond with a single JSON block. Do not include markdown code fences or conversational text.
Use exactly these keys:
- "winner": integer (1 for Challenger, 2 for Opponent)
- "score_challenger": integer (from 1 to 10)
- "score_opponent": integer (from 1 to 10)
- "reasoning": a single-sentence clear explanation of the decision.

Example response:
{{"winner": 1, "score_challenger": 9, "score_opponent": 7, "reasoning": "Challenger solved all edge cases while Opponent missed empty inputs."}}"""
            
            raw_response = gl.nondet.exec_prompt(evaluation_prompt)
            
            # Sanitize response by removing markdown blocks if present
            cleaned = raw_response.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                lines = [line for line in lines if not line.strip().startswith("```")]
                cleaned = "\n".join(lines).strip()
                
            parsed = json.loads(cleaned)
            
            # Normalize fields to guarantee structure consistency
            return {
                "winner": max(1, min(2, int(parsed.get("winner", 1)))),
                "score_challenger": max(1, min(10, int(parsed.get("score_challenger", 5)))),
                "score_opponent": max(1, min(10, int(parsed.get("score_opponent", 5)))),
                "reasoning": str(parsed.get("reasoning", "")).strip(),
            }

        def validator_fn(leader_result) -> bool:
            """
            Validates the leader's outcome by re-running evaluation and comparing bounds.
            """
            if not isinstance(leader_result, gl.vm.Return):
                return False
                
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
                
            required_keys = {"winner", "score_challenger", "score_opponent", "reasoning"}
            if not required_keys.issubset(leader_data.keys()):
                return False

            # Validator executes leader_fn to fetch their own independent non-deterministic result
            validator_data = leader_fn()

            # The Equivalence Principle: Winner must match, scores must be within +/- 2 points
            winner_matches = (leader_data["winner"] == validator_data["winner"])
            challenger_score_close = (abs(int(leader_data["score_challenger"]) - int(validator_data["score_challenger"])) <= 2)
            opponent_score_close = (abs(int(leader_data["score_opponent"]) - int(validator_data["score_opponent"])) <= 2)

            return winner_matches and challenger_score_close and opponent_score_close

        # Trigger GenVM's equivalence consensus workflow
        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        # Distribute the prize pool
        total_prize = u256(int(challenge["stake_challenger"]) + int(challenge["stake_opponent"]))
        
        if result["winner"] == 1:
            challenge["winner"] = challenge["challenger"]
            self._transfer_funds(challenge["challenger"], total_prize)
        else:
            challenge["winner"] = challenge["opponent"]
            self._transfer_funds(challenge["opponent"], total_prize)

        challenge["status"] = 3  # Judged
        challenge["verdict_data"] = json.dumps(result)
        
        self.challenges[challenge_id] = json.dumps(challenge)

    @gl.public.write
    def cancel_challenge(self, challenge_id: str) -> None:
        """
        Cancels an open challenge and refunds the challenger.
        Can only be performed by the challenger while the challenge is still open.
        """
        challenge = json.loads(self.challenges[challenge_id])
        
        if challenge["status"] != 0:
            raise gl.advanced.user_error_immediate("Can only cancel open challenges")
        if str(gl.message.sender_address) != challenge["challenger"]:
            raise gl.advanced.user_error_immediate("Only the challenger can cancel this challenge")
            
        challenge["status"] = 3  # Closed/Judged stage (canceled)
        self.challenges[challenge_id] = json.dumps(challenge)
        
        refund_amount = u256(int(challenge["stake_challenger"]))
        self._transfer_funds(challenge["challenger"], refund_amount)

    @gl.public.view
    def get_challenge(self, challenge_id: str) -> str:
        """
        Returns the full state of a challenge as a JSON string.
        """
        return self.challenges[challenge_id]

    @gl.public.view
    def get_challenge_count(self) -> i32:
        """
        Returns the total number of challenges created in the arena.
        """
        return self.challenge_count

    def _transfer_funds(self, recipient: str, amount: u256) -> None:
        """
        Internal utility to emit EVM transfers.
        """
        @gl.evm.contract_interface
        class _RecipientContract:
            class View:
                pass
            class Write:
                pass
                
        _RecipientContract(Address(recipient)).emit_transfer(value=amount)
