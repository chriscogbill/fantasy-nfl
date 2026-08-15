'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Public rules page: the full game rules plus the live scoring table
// (fetched from the API so it can never drift from what the engine uses).
export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getScoringRules()
      .then((data) => setRules(data.rules || []))
      .catch((e) => console.error('Error loading scoring rules:', e))
      .finally(() => setLoading(false));
  }, []);

  const sections = [];
  for (const r of rules) {
    let s = sections.find((x) => x.name === r.section_name);
    if (!s) { s = { name: r.section_name, rows: [] }; sections.push(s); }
    s.rows.push(r);
  }

  const label = (t) =>
    t.replace(/_/g, ' ')
      .replace(/\bfg\b/i, 'Field goal')
      .replace(/\bxp\b/i, 'Extra point')
      .replace(/\btd\b/i, 'TD')
      .replace(/^./, (c) => c.toUpperCase());

  const pts = (p) => {
    const v = parseFloat(p);
    return `${v > 0 ? '+' : ''}${v % 1 === 0 ? v.toFixed(0) : v}`;
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold">Rules</h1>

      {/* Team & budget */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">Your Team</h2>
        <ul className="space-y-2 text-gray-700">
          <li>• Build a 15-player roster within a <span className="font-semibold">$100 million budget</span>.</li>
          <li>• Position minimums: 1 QB, 3 RB, 3 WR, 1 TE, 1 K, 1 DEF.</li>
          <li>• Each week you start 9: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (RB/WR/TE), 1 K, 1 DEF. Only starters score.</li>
          <li>• Rosters lock 90 minutes before the week&apos;s first kickoff. The lineup page shows each deadline.</li>
        </ul>
      </div>

      {/* Scoring */}
      <div className="card">
        <h2 className="text-xl font-bold mb-1">Scoring</h2>
        <p className="text-sm text-gray-500 mb-4">
          Full-point <span className="font-semibold">PPR</span> — every reception is worth 1 point.
        </p>
        {loading ? (
          <div className="text-gray-500">Loading scoring table…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sections.map((s) => (
              <div key={s.name} className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold mb-2">{s.name}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.scoring_id} className="border-t border-gray-100">
                        <td className="py-1 text-gray-600">{label(r.scoring_type)}</td>
                        <td className={`py-1 text-right font-semibold ${parseFloat(r.points) < 0 ? 'text-danger-600' : 'text-positive-600'}`}>
                          {pts(r.points)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transfers */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">Transfers</h2>
        <ul className="space-y-2 text-gray-700">
          <li>• <span className="font-semibold">Preseason:</span> unlimited free transfers while you build your squad.</li>
          <li>• <span className="font-semibold">In season:</span> 1 free transfer per week. Unused free transfers bank up, to a maximum of 5.</li>
          <li>• Each transfer beyond your free ones costs <span className="font-semibold text-danger-600">−6 points</span>.</li>
          <li>• Transfers made after the weekly lock apply to the following week.</li>
        </ul>
      </div>

      {/* Prices */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">Player Prices</h2>
        <ul className="space-y-2 text-gray-700">
          <li>• Prices move weekly (Wednesday overnight) based on performance — spot a breakout before the market does and he&apos;s yours at a discount.</li>
          <li>• <span className="font-semibold">Selling:</span> you get your purchase price plus <span className="font-semibold">half of any price rise</span> (rounded down to $0.1M). If a player&apos;s price fell, you sell at the lower current price.</li>
          <li>• Your team&apos;s spare budget can be spent any time.</li>
        </ul>
      </div>

      {/* Auto-subs */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">Auto-Substitutions</h2>
        <ul className="space-y-2 text-gray-700">
          <li>• If a starter doesn&apos;t play in their game, an eligible bench player is automatically substituted in after the week&apos;s games finish.</li>
          <li>• Bench order sets the priority — the first eligible bench player comes in. Set it on the Lineup page.</li>
          <li>• Substitutions respect the lineup shape (a bench kicker can only ever replace your kicker; RB/WR/TE compete for the flexible spots).</li>
        </ul>
      </div>

      {/* Leagues */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">Leagues</h2>
        <ul className="space-y-2 text-gray-700">
          <li>• Every team automatically joins the <span className="font-semibold">Global League</span>.</li>
          <li>• Create private leagues and invite friends with a join code. League scoring runs weeks 1–17.</li>
        </ul>
      </div>
    </div>
  );
}
