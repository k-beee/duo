"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CONTRACT_ADDRESS, connectWallet, disconnectWallet, readClient, shortAddr, type WalletState } from "@/lib/genlayer";
import { TransactionStatus } from "genlayer-js/types";

type Challenge = {
  id: string;
  challenger: string;
  opponent: string;
  category: string;
  prompt: string;
  solution_challenger: string;
  solution_opponent: string;
  stake_challenger: string;
  stake_opponent: string;
  status: number; // 0 = Open, 1 = Matched, 2 = SolutionsSubmitted, 3 = Judged
  winner: string;
  verdict_data: string;
  created_at: number;
};

type Verdict = {
  winner: number;
  score_challenger: number;
  score_opponent: number;
  reasoning: string;
};

const CATEGORIES = ["Coding", "Writing", "Design", "Math", "Trivia"] as const;
const STATUS_LABELS = ["Recruiting", "Active Match", "Submissions In Review", "Resolved"];
const STATUS_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#a855f7"];

const CAT_THEMES: Record<string, { icon: string; bg: string; text: string; gradient: string }> = {
  Coding: { icon: "⌨", bg: "#6366f112", text: "#818cf8", gradient: "linear-gradient(135deg, #6366f1, #4f46e5)" },
  Writing: { icon: "✍", bg: "#d946ef12", text: "#f472b6", gradient: "linear-gradient(135deg, #d946ef, #c084fc)" },
  Design: { icon: "◆", bg: "#f43f5e12", text: "#fb7185", gradient: "linear-gradient(135deg, #f43f5e, #fb7185)" },
  Math: { icon: "∑", bg: "#10b98112", text: "#34d399", gradient: "linear-gradient(135deg, #10b981, #059669)" },
  Trivia: { icon: "❓", bg: "#f59e0b12", text: "#fbbf24", gradient: "linear-gradient(135deg, #f59e0b, #d97706)" },
};

export default function ArenaHome() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, client: null });
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Challenge | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ category: "Coding", prompt: "", stake: "" });
  const [solutionInput, setSolutionInput] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside clicks
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadChallenges = useCallback(async () => {
    try {
      const client = readClient();
      const count = Number(
        await client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_challenge_count",
          args: [],
        })
      );
      
      const list: Challenge[] = [];
      for (let i = 1; i <= count; i++) {
        const raw = await client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_challenge",
          args: [String(i)],
        });
        list.push(JSON.parse(raw as string));
      }
      setChallenges(list.reverse());
    } catch (e) {
      console.error("Failed to load challenges from contract:", e);
    }
  }, []);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

  async function handleConnect() {
    setToastMsg("Initializing secure connection…");
    try {
      const w = await connectWallet();
      setWallet(w);
      setToastMsg("");
      setDropdownOpen(false);
    } catch (e: any) {
      setToastMsg(e.message || "Failed to connect wallet");
      setTimeout(() => setToastMsg(""), 3500);
    }
  }

  function handleDisconnect() {
    setWallet(disconnectWallet());
    setDropdownOpen(false);
    setToastMsg("Wallet disconnected");
    setTimeout(() => setToastMsg(""), 2000);
  }

  async function executeWrite(functionName: string, args: any[], value?: bigint) {
    if (!wallet.client) {
      setToastMsg("⚠ Please connect your wallet first.");
      setTimeout(() => setToastMsg(""), 3000);
      return;
    }
    setLoading(true);
    setToastMsg("Awaiting wallet approval…");
    try {
      const hash = await wallet.client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args,
        value: value ?? BigInt(0),
      });
      
      setToastMsg("Compiling state & reaching AI Consensus…");
      const receipt = await wallet.client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.ACCEPTED,
      });

      if (receipt && (receipt as any).status === TransactionStatus.CANCELED) {
        setToastMsg("⚠ Consensus Draw: AI validators diverged in their grading. No winner declared. Stake preserved - retry judgment.");
        setLoading(false);
        return;
      }

      setToastMsg("✓ Transaction verified on-chain!");
      await loadChallenges();
      
      // Update selected challenge modal state if currently viewed
      if (selected) {
        const updatedRaw = await readClient().readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_challenge",
          args: [selected.id],
        });
        setSelected(JSON.parse(updatedRaw as string));
      }
      
      setTimeout(() => setToastMsg(""), 3000);
      setShowCreate(false);
    } catch (e: any) {
      const msg = e?.message || String(e);
      
      // Load latest updates from the chain anyway to see if transaction resolved
      try {
        await loadChallenges();
        if (selected) {
          const updatedRaw = await readClient().readContract({
            address: CONTRACT_ADDRESS,
            functionName: "get_challenge",
            args: [selected.id],
          });
          setSelected(JSON.parse(updatedRaw as string));
        }
      } catch (loadErr) {
        console.error("Failed to reload state during error cleanup:", loadErr);
      }

      if (/timeout/i.test(msg)) {
        setToastMsg("⌛ Network timeout waiting for receipt. Updating state from chain…");
        setTimeout(() => setToastMsg(""), 3500);
      } else if (/consensus|abort|canceled/i.test(msg)) {
        setToastMsg("⚠ AI Consensus Failure: The validator pool disagreed on the scores. You can trigger the evaluation again.");
        setTimeout(() => setToastMsg(""), 4500);
      } else if (/insufficient funds/i.test(msg)) {
        setToastMsg("⚠ Transaction failed: Insufficient GEN balance.");
        setTimeout(() => setToastMsg(""), 4500);
      } else if (/user rejected|rejected/i.test(msg)) {
        setToastMsg("Transaction rejected by user.");
        setTimeout(() => setToastMsg(""), 2500);
      } else {
        setToastMsg(`Error: ${msg.slice(0, 80)}…`);
        setTimeout(() => setToastMsg(""), 4500);
      }
    }
    setLoading(false);
  }

  const formatGEN = (wei: string) => {
    return (Number(BigInt(wei || "0")) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const getAvatarColor = (address: string) => {
    if (!address || address.length < 8) return "hsl(0, 0%, 20%)";
    const intVal = parseInt(address.slice(2, 10), 16);
    return `hsl(${intVal % 360}, 65%, 45%)`;
  };

  const filteredChallenges = activeCategory === "All"
    ? challenges
    : challenges.filter(c => c.category === activeCategory);

  const getVerdict = (challenge: Challenge): Verdict | null => {
    if (!challenge.verdict_data) return null;
    try {
      return JSON.parse(challenge.verdict_data) as Verdict;
    } catch {
      return null;
    }
  };

  return (
    <div className="arena-container">
      {/* Navbar */}
      <nav className="nav-bar">
        <div className="nav-content">
          <div className="logo-group" onClick={() => setSelected(null)}>
            <span className="logo-icon">✦</span>
            <span className="logo-name">Duo</span>
            <span className="logo-tag">Arena</span>
          </div>

          <div className="nav-actions" ref={dropdownRef}>
            {wallet.address ? (
              <div className="wallet-wrapper">
                <button className="wallet-connect-btn active" onClick={() => setDropdownOpen(!dropdownOpen)}>
                  <span className="dot-pulse" />
                  {shortAddr(wallet.address)}
                  <span className="chevron">▼</span>
                </button>
                {dropdownOpen && (
                  <div className="wallet-dropdown-menu">
                    <div className="drop-header">Account Connected</div>
                    <div className="drop-address">{wallet.address}</div>
                    <div className="drop-network">Network: GenLayer Studionet</div>
                    <button className="disconnect-btn" onClick={handleDisconnect}>
                      Disconnect Wallet
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="wallet-connect-btn" onClick={handleConnect}>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Toast Alert */}
      {toastMsg && <div className="toast-notification">{toastMsg}</div>}

      {/* Main Container */}
      {!selected ? (
        <>
          {/* Hero / Header Section */}
          <header className="hero-section">
            <div className="hero-main-details">
              <span className="pill-badge">Decentralized AI Consensus Arena</span>
              <h1 className="hero-heading">
                Subjective Challenges.<br />
                Neutral AI Consensus.<br />
                Trustless Payouts.
              </h1>
              <p className="hero-paragraph">
                Duo matches you in 1v1 skill duels—from software algorithms to copy editing. Dual stakes are secured in a smart contract. Independent validators evaluate submissions using Large Language Models under the Equivalence Principle. Winner takes the pool.
              </p>
              <div className="hero-cta">
                <button className="btn-primary-action" onClick={() => setShowCreate(true)}>
                  Create Challenge
                </button>
              </div>
            </div>

            {/* Quick stats board */}
            <div className="analytics-card">
              <div className="stat-row">
                <div className="stat-item">
                  <div className="stat-value">{challenges.length}</div>
                  <div className="stat-label">Created Duels</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{challenges.filter(c => c.status === 0).length}</div>
                  <div className="stat-label">Open Slots</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{challenges.filter(c => c.status === 3).length}</div>
                  <div className="stat-label">Settled Duels</div>
                </div>
              </div>
              <div className="analytics-footer">
                <span>Active Network: GenLayer Studio RPC</span>
              </div>
            </div>
          </header>

          {/* Arena Section */}
          <main className="arena-grid-section">
            <div className="arena-filter-bar">
              <h2 className="section-title">Active Challenges</h2>
              <div className="category-filters">
                <button
                  className={`filter-btn ${activeCategory === "All" ? "selected" : ""}`}
                  onClick={() => setActiveCategory("All")}
                >
                  All
                </button>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    className={`filter-btn ${activeCategory === cat ? "selected" : ""}`}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredChallenges.length === 0 ? (
              <div className="empty-arena">
                <div className="empty-icon">🛡️</div>
                <p>No duels currently match this category. Take the initiative and open a new challenge!</p>
              </div>
            ) : (
              <div className="challenges-grid">
                {filteredChallenges.map(c => {
                  const theme = CAT_THEMES[c.category] || { icon: "◆", bg: "#1f2937", text: "#9ca3af", gradient: "" };
                  return (
                    <div key={c.id} className="challenge-card" onClick={() => setSelected(c)}>
                      <div className="card-top-header">
                        <span className="category-tag" style={{ background: theme.bg, color: theme.text }}>
                          <span className="tag-icon">{theme.icon}</span> {c.category}
                        </span>
                        <span
                          className="status-tag"
                          style={{
                            color: STATUS_COLORS[c.status],
                            border: `1px solid ${STATUS_COLORS[c.status]}30`,
                            background: `${STATUS_COLORS[c.status]}10`,
                          }}
                        >
                          {STATUS_LABELS[c.status]}
                        </span>
                      </div>

                      <div className="opponent-stack">
                        <div className="avatar-disc" style={{ background: getAvatarColor(c.challenger) }}>
                          C
                        </div>
                        <span className="vs-divider">VS</span>
                        {c.opponent ? (
                          <div className="avatar-disc" style={{ background: getAvatarColor(c.opponent) }}>
                            O
                          </div>
                        ) : (
                          <div className="avatar-disc empty" title="Awaiting Opponent">
                            ?
                          </div>
                        )}
                      </div>

                      <p className="card-prompt">{c.prompt}</p>

                      <div className="card-footer-pot">
                        <span className="pot-lbl">Total Pot</span>
                        <span className="pot-val">
                          {formatGEN(String(BigInt(c.stake_challenger) + BigInt(c.stake_opponent)))} GEN
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </>
      ) : (
        /* Matchup Detail View */
        <main className="detail-view-container">
          <button className="btn-back" onClick={() => { setSelected(null); setSolutionInput(""); }}>
            ← Back to Arena
          </button>

          <div className="detail-header-card">
            <div className="detail-meta">
              <span className="category-tag" style={{ background: CAT_THEMES[selected.category]?.bg, color: CAT_THEMES[selected.category]?.text }}>
                {CAT_THEMES[selected.category]?.icon} {selected.category}
              </span>
              <span
                className="status-tag"
                style={{
                  color: STATUS_COLORS[selected.status],
                  border: `1px solid ${STATUS_COLORS[selected.status]}30`,
                  background: `${STATUS_COLORS[selected.status]}10`,
                }}
              >
                {STATUS_LABELS[selected.status]}
              </span>
            </div>

            <div className="vs-matchup-panel">
              <div className={`participant-card ${selected.winner === selected.challenger ? "winner" : ""}`}>
                <div className="avatar-large" style={{ background: getAvatarColor(selected.challenger) }}>
                  {selected.winner === selected.challenger && <span className="winner-crown">👑</span>}
                  C
                </div>
                <div className="p-title">Challenger</div>
                <div className="p-address">{shortAddr(selected.challenger)}</div>
                <div className="p-stake">Stake: {formatGEN(selected.stake_challenger)} GEN</div>
              </div>

              <div className="vs-giant">VS</div>

              <div className={`participant-card ${selected.winner === selected.opponent ? "winner" : ""}`}>
                <div className="avatar-large" style={{ background: selected.opponent ? getAvatarColor(selected.opponent) : "#1f2937", border: selected.opponent ? "none" : "2px dashed #4b5563" }}>
                  {selected.winner === selected.opponent && <span className="winner-crown">👑</span>}
                  {selected.opponent ? "O" : "?"}
                </div>
                <div className="p-title">Opponent</div>
                <div className="p-address">{selected.opponent ? shortAddr(selected.opponent) : "Open Slot"}</div>
                <div className="p-stake">Stake: {selected.opponent ? formatGEN(selected.stake_opponent) : "0"} GEN</div>
              </div>
            </div>

            <div className="challenge-prompt-container">
              <div className="prompt-label">Challenge Prompt</div>
              <div className="prompt-content-text">{selected.prompt}</div>
              <div className="prize-banner">
                Prize Pool: 💰 {formatGEN(String(BigInt(selected.stake_challenger) + BigInt(selected.stake_opponent)))} GEN
              </div>
            </div>
          </div>

          {/* Submissions Display */}
          {(selected.solution_challenger || selected.solution_opponent) && (
            <div className="submissions-box">
              <div className="submission-col">
                <div className="submission-col-header challenger-head">Challenger Submission</div>
                <pre className="submission-col-body">{selected.solution_challenger || "No submission provided yet."}</pre>
              </div>
              <div className="submission-col">
                <div className="submission-col-header opponent-head">Opponent Submission</div>
                <pre className="submission-col-body">{selected.solution_opponent || "No submission provided yet."}</pre>
              </div>
            </div>
          )}

          {/* AI Verdict Display */}
          {selected.status === 3 && getVerdict(selected) && (
            <div className="verdict-summary-card">
              <div className="verdict-title">⚖️ AI consensus ruling</div>
              
              {/* Score bars comparing Challenger & Opponent */}
              <div className="scores-meter-grid">
                <div className="meter-wrapper">
                  <div className="meter-label">Challenger Score: {getVerdict(selected)?.score_challenger}/10</div>
                  <div className="meter-bar-outer">
                    <div
                      className="meter-bar-inner challenger"
                      style={{ width: `${(getVerdict(selected)?.score_challenger || 0) * 10}%` }}
                    />
                  </div>
                </div>
                
                <div className="meter-wrapper">
                  <div className="meter-label">Opponent Score: {getVerdict(selected)?.score_opponent}/10</div>
                  <div className="meter-bar-outer">
                    <div
                      className="meter-bar-inner opponent"
                      style={{ width: `${(getVerdict(selected)?.score_opponent || 0) * 10}%` }}
                    />
                  </div>
                </div>
              </div>

              <p className="verdict-explanation">
                <strong>Analysis:</strong> {getVerdict(selected)?.reasoning}
              </p>
            </div>
          )}

          {/* User Actions */}
          <div className="action-buttons-group">
            {/* Accept challenge */}
            {selected.status === 0 && (
              <button
                className="action-btn-primary"
                disabled={loading}
                onClick={() => executeWrite("accept_challenge", [selected.id], BigInt(selected.stake_challenger))}
              >
                Accept Challenge & Match Stake
              </button>
            )}

            {/* Cancel challenge (only creator if open) */}
            {selected.status === 0 && wallet.address && wallet.address.toLowerCase() === selected.challenger.toLowerCase() && (
              <button
                className="action-btn-danger"
                disabled={loading}
                onClick={() => executeWrite("cancel_challenge", [selected.id])}
              >
                Cancel Challenge & Refund Stake
              </button>
            )}

            {/* Submit answer */}
            {(selected.status === 1 || selected.status === 2) && (
              <div className="solution-composer-panel">
                <textarea
                  className="solution-textarea"
                  placeholder="Draft your solution details here..."
                  rows={8}
                  value={solutionInput}
                  onChange={e => setSolutionInput(e.target.value)}
                />
                <button
                  className="action-btn-primary"
                  disabled={loading || !solutionInput.trim()}
                  onClick={() => {
                    executeWrite("submit_solution", [selected.id, solutionInput]);
                    setSolutionInput("");
                  }}
                >
                  Submit Solution
                </button>
              </div>
            )}

            {/* Evaluate duel */}
            {selected.status === 2 && (
              <button
                className="action-btn-evaluate"
                disabled={loading}
                onClick={() => executeWrite("evaluate_challenge", [selected.id])}
              >
                Evaluate & Trigger AI consensus
              </button>
            )}
          </div>
        </main>
      )}

      {/* Challenge Creation Modal */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal-content-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Duel Challenge</h3>
              <button className="modal-close-btn" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            
            <form
              onSubmit={e => {
                e.preventDefault();
                executeWrite(
                  "open_challenge",
                  [form.category, form.prompt],
                  BigInt(form.stake || "0") * BigInt(10 ** 18)
                );
              }}
            >
              <div className="input-group">
                <label>Category</label>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map(cat => (
                    <option key={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label>Challenge Instructions / Prompt</label>
                <textarea
                  required
                  placeholder="Describe the challenge parameters (e.g. write a Python function to reverse a binary tree)"
                  rows={4}
                  value={form.prompt}
                  onChange={e => setForm({ ...form, prompt: e.target.value })}
                />
              </div>

              <div className="input-group">
                <label>Stake Amount (GEN)</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="10"
                  value={form.stake}
                  onChange={e => setForm({ ...form, stake: e.target.value })}
                />
              </div>

              <button type="submit" className="action-btn-primary full-width" disabled={loading}>
                {loading ? "Approving…" : "Submit to Arena"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* CSS Styling Block */}
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          background-color: #030712;
          color: #f3f4f6;
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
        }

        .arena-container {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          padding-bottom: 60px;
        }

        /* Nav Bar */
        .nav-bar {
          background: rgba(3, 7, 18, 0.85);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid #1f2937;
          position: sticky;
          top: 0;
          z-index: 100;
          height: 70px;
        }

        .nav-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .logo-group {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }

        .logo-icon {
          font-size: 24px;
          background: linear-gradient(135deg, #818cf8, #d946ef);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .logo-name {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: #f9fafb;
        }

        .logo-tag {
          font-size: 11px;
          font-weight: 600;
          background: #818cf815;
          color: #818cf8;
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid #818cf830;
          text-transform: uppercase;
        }

        /* Wallet Button & Dropdown */
        .wallet-wrapper {
          position: relative;
        }

        .wallet-connect-btn {
          background: #6366f1;
          color: #ffffff;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.25s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .wallet-connect-btn:hover {
          background: #4f46e5;
          transform: translateY(-1px);
        }

        .wallet-connect-btn.active {
          background: #111827;
          border: 1px solid #374151;
          color: #d1d5db;
        }

        .wallet-connect-btn.active:hover {
          border-color: #4b5563;
        }

        .dot-pulse {
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 10px #10b981;
        }

        .chevron {
          font-size: 9px;
          color: #9ca3af;
        }

        .wallet-dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          background: #111827;
          border: 1px solid #374151;
          border-radius: 12px;
          padding: 16px;
          width: 290px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          animation: drop-fade 0.2s ease-out;
        }

        @keyframes drop-fade {
          from { opacity: 0; transform: translateY(-5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .drop-header {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
          margin-bottom: 6px;
        }

        .drop-address {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #9ca3af;
          background: #030712;
          padding: 8px;
          border-radius: 6px;
          border: 1px solid #1f2937;
          word-break: break-all;
          margin-bottom: 12px;
        }

        .drop-network {
          font-size: 12px;
          color: #818cf8;
          margin-bottom: 14px;
        }

        .disconnect-btn {
          width: 100%;
          background: #ef444415;
          color: #f87171;
          border: 1px solid #ef444430;
          padding: 8px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .disconnect-btn:hover {
          background: #ef444425;
        }

        /* Toast Alert */
        .toast-notification {
          position: fixed;
          top: 85px;
          left: 50%;
          transform: translateX(-50%);
          background: #1e1b4b;
          border: 1px solid #3b0764;
          color: #fcd34d;
          padding: 14px 24px;
          border-radius: 10px;
          z-index: 1000;
          font-size: 14px;
          font-weight: 500;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
          text-align: center;
          max-width: 600px;
          animation: slide-down 0.25s ease-out;
        }

        @keyframes slide-down {
          from { top: 60px; opacity: 0; }
          to { top: 85px; opacity: 1; }
        }

        /* Hero / Header Section */
        .hero-section {
          max-width: 1200px;
          margin: 60px auto 40px;
          padding: 0 24px;
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 60px;
          align-items: center;
        }

        .hero-main-details {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .pill-badge {
          background: #818cf815;
          color: #818cf8;
          border: 1px solid #818cf835;
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 24px;
        }

        .hero-heading {
          font-size: 48px;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -1.5px;
          background: linear-gradient(135deg, #f9fafb, #a5b4fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 24px;
        }

        .hero-paragraph {
          color: #9ca3af;
          font-size: 16px;
          line-height: 1.6;
          margin-bottom: 36px;
        }

        .hero-cta {
          display: flex;
          gap: 16px;
        }

        .btn-primary-action {
          background: #6366f1;
          color: white;
          border: none;
          padding: 14px 28px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 15px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary-action:hover {
          background: #4f46e5;
          box-shadow: 0 5px 15px rgba(99, 102, 241, 0.4);
          transform: translateY(-1px);
        }

        .btn-secondary-action {
          background: transparent;
          border: 1px solid #374151;
          color: #e5e7eb;
          padding: 14px 28px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 15px;
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
        }

        .btn-secondary-action:hover {
          background: #111827;
          border-color: #4b5563;
        }

        /* Analytics Card */
        .analytics-card {
          background: #0b0f19;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 32px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }

        .stat-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          text-align: center;
          margin-bottom: 28px;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .stat-value {
          font-size: 36px;
          font-weight: 800;
          color: #f3f4f6;
        }

        .stat-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
        }

        .analytics-footer {
          border-top: 1px solid #1f2937;
          padding-top: 16px;
          font-size: 12px;
          color: #4b5563;
          text-align: center;
        }

        /* Arena Grid Section */
        .arena-grid-section {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px 80px;
          width: 100%;
        }

        .arena-filter-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 32px;
          border-bottom: 1px solid #1f2937;
          padding-bottom: 16px;
        }

        .section-title {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }

        .category-filters {
          display: flex;
          gap: 8px;
        }

        .filter-btn {
          background: #111827;
          border: 1px solid #1f2937;
          color: #9ca3af;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-btn:hover {
          border-color: #4b5563;
          color: #e5e7eb;
        }

        .filter-btn.selected {
          background: #6366f1;
          border-color: #6366f1;
          color: white;
        }

        .empty-arena {
          text-align: center;
          padding: 80px 20px;
          background: #0b0f19;
          border: 1px dashed #1f2937;
          border-radius: 16px;
          color: #6b7280;
        }

        .empty-icon {
          font-size: 40px;
          margin-bottom: 16px;
        }

        /* Challenges Grid */
        .challenges-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }

        .challenge-card {
          background: #0b0f19;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 24px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 250px;
        }

        .challenge-card:hover {
          border-color: #4f46e570;
          transform: translateY(-3px);
          box-shadow: 0 10px 30px rgba(99, 102, 241, 0.08);
        }

        .card-top-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .category-tag {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 4px;
          text-transform: uppercase;
        }

        .tag-icon {
          font-size: 10px;
        }

        .status-tag {
          font-size: 10px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .opponent-stack {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin: 16px 0;
        }

        .avatar-disc {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: 16px;
          color: white;
        }

        .avatar-disc.empty {
          background: transparent;
          color: #4b5563;
        }

        .vs-divider {
          font-size: 12px;
          font-weight: 800;
          font-style: italic;
          color: #6366f1;
        }

        .card-prompt {
          font-size: 14px;
          line-height: 1.5;
          color: #9ca3af;
          text-align: center;
          margin-bottom: 20px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .card-footer-pot {
          border-top: 1px solid #1f2937;
          padding-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .pot-lbl {
          font-size: 11px;
          text-transform: uppercase;
          color: #6b7280;
          font-weight: 600;
        }

        .pot-val {
          font-size: 15px;
          font-weight: 700;
          color: #fbbf24;
        }

        /* Detail View Container */
        .detail-view-container {
          max-width: 800px;
          margin: 40px auto 80px;
          padding: 0 24px;
          width: 100%;
        }

        .btn-back {
          background: none;
          border: none;
          color: #818cf8;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 24px;
          transition: all 0.2s;
        }

        .btn-back:hover {
          color: #6366f1;
          text-decoration: underline;
        }

        .detail-header-card {
          background: #0b0f19;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 32px;
          margin-bottom: 24px;
        }

        .detail-meta {
          display: flex;
          justify-content: space-between;
          margin-bottom: 28px;
        }

        .vs-matchup-panel {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 20px;
          margin-bottom: 36px;
        }

        .participant-card {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          position: relative;
        }

        .participant-card.winner {
          border-color: #10b981;
          box-shadow: 0 0 15px rgba(16, 185, 129, 0.15);
        }

        .avatar-large {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          display: grid;
          place-items: center;
          margin: 0 auto 12px;
          font-weight: 800;
          font-size: 24px;
          position: relative;
          color: white;
        }

        .winner-crown {
          position: absolute;
          top: -15px;
          font-size: 20px;
        }

        .p-title {
          font-size: 14px;
          font-weight: 700;
          color: #f3f4f6;
        }

        .p-address {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #6b7280;
          margin-top: 4px;
        }

        .p-stake {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 600;
          color: #fbbf24;
        }

        .vs-giant {
          font-size: 44px;
          font-weight: 900;
          font-style: italic;
          background: linear-gradient(135deg, #6366f1, #d946ef);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .challenge-prompt-container {
          background: #030712;
          border: 1px solid #1f2937;
          border-radius: 12px;
          padding: 24px;
          text-align: center;
        }

        .prompt-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #6b7280;
          font-weight: 700;
          margin-bottom: 12px;
        }

        .prompt-content-text {
          font-size: 16px;
          line-height: 1.6;
          color: #d1d5db;
          margin-bottom: 16px;
        }

        .prize-banner {
          display: inline-block;
          background: #fbbf2415;
          color: #fbbf24;
          border: 1px solid #fbbf2430;
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 700;
        }

        /* Submissions Display */
        .submissions-box {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-bottom: 24px;
        }

        .submission-col {
          background: #0b0f19;
          border: 1px solid #1f2937;
          border-radius: 16px;
          overflow: hidden;
        }

        .submission-col-header {
          padding: 12px 20px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .submission-col-header.challenger-head {
          color: #818cf8;
          background: #818cf810;
          border-bottom: 1px solid #818cf820;
        }

        .submission-col-header.opponent-head {
          color: #f472b6;
          background: #f472b610;
          border-bottom: 1px solid #f472b620;
        }

        .submission-col-body {
          padding: 20px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          line-height: 1.6;
          color: #d1d5db;
          white-space: pre-wrap;
          max-height: 250px;
          overflow-y: auto;
        }

        /* Verdict Summary Card */
        .verdict-summary-card {
          background: #052e1610;
          border: 1px solid #10b98130;
          border-radius: 16px;
          padding: 28px;
          margin-bottom: 24px;
        }

        .verdict-title {
          font-size: 14px;
          font-weight: 700;
          color: #10b981;
          text-transform: uppercase;
          margin-bottom: 20px;
          text-align: center;
        }

        .scores-meter-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          margin-bottom: 24px;
        }

        .meter-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .meter-label {
          font-size: 13px;
          font-weight: 600;
          color: #d1d5db;
        }

        .meter-bar-outer {
          height: 10px;
          background: #111827;
          border-radius: 5px;
          overflow: hidden;
          width: 100%;
        }

        .meter-bar-inner {
          height: 100%;
          border-radius: 5px;
        }

        .meter-bar-inner.challenger {
          background: #818cf8;
        }

        .meter-bar-inner.opponent {
          background: #f472b6;
        }

        .verdict-explanation {
          color: #9ca3af;
          font-size: 14px;
          line-height: 1.6;
        }

        /* User Action Buttons */
        .action-buttons-group {
          max-width: 500px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .action-btn-primary {
          background: #6366f1;
          color: white;
          border: none;
          padding: 14px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          text-align: center;
        }

        .action-btn-primary:hover {
          background: #4f46e5;
        }

        .action-btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .action-btn-danger {
          background: #ef444415;
          color: #f87171;
          border: 1px solid #ef444430;
          padding: 14px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          text-align: center;
        }

        .action-btn-danger:hover {
          background: #ef444425;
        }

        .action-btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .action-btn-evaluate {
          background: linear-gradient(90deg, #f59e0b, #ec4899);
          color: white;
          border: none;
          padding: 14px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s;
          width: 100%;
          text-align: center;
        }

        .action-btn-evaluate:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 15px rgba(236, 72, 153, 0.4);
        }

        .action-btn-evaluate:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .solution-composer-panel {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .solution-textarea {
          width: 100%;
          background: #0b0f19;
          border: 1px solid #1f2937;
          border-radius: 10px;
          color: #f3f4f6;
          padding: 14px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          outline: none;
          resize: vertical;
        }

        .solution-textarea:focus {
          border-color: #6366f1;
        }

        /* Modal backdrop and card */
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(3, 7, 18, 0.7);
          backdrop-filter: blur(8px);
          display: grid;
          place-items: center;
          z-index: 1000;
          padding: 20px;
        }

        .modal-content-card {
          background: #0b0f19;
          border: 1px solid #1f2937;
          border-radius: 16px;
          padding: 32px;
          width: 100%;
          max-width: 500px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .modal-header h3 {
          font-size: 18px;
          font-weight: 800;
        }

        .modal-close-btn {
          background: none;
          border: none;
          color: #6b7280;
          font-size: 18px;
          cursor: pointer;
        }

        .modal-close-btn:hover {
          color: #f3f4f6;
        }

        .input-group {
          margin-bottom: 20px;
        }

        .input-group label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }

        .input-group input,
        .input-group select,
        .input-group textarea {
          width: 100%;
          background: #030712;
          border: 1px solid #1f2937;
          border-radius: 8px;
          padding: 12px 14px;
          color: #f3f4f6;
          font-family: inherit;
          font-size: 14px;
          outline: none;
        }

        .input-group input:focus,
        .input-group select:focus,
        .input-group textarea:focus {
          border-color: #6366f1;
        }

        .full-width {
          width: 100%;
        }

        /* Responsive Breakpoints */
        @media (max-width: 900px) {
          .hero-section {
            grid-template-columns: 1fr;
            margin-top: 40px;
            gap: 40px;
          }
        }

        @media (max-width: 600px) {
          .nav-content {
            padding: 0 16px;
          }
          .hero-section {
            padding: 0 16px;
          }
          .arena-grid-section {
            padding: 0 16px 60px;
          }
          .hero-heading {
            font-size: 32px;
          }
          .scores-meter-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
          .submissions-box {
            grid-template-columns: 1fr;
          }
          .vs-matchup-panel {
            grid-template-columns: 1fr;
          }
          .vs-giant {
            text-align: center;
            margin: 10px 0;
            font-size: 28px;
          }
        }
      `}</style>
    </div>
  );
}
