'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    fetchTeams();
  }, []);

  async function fetchTeams() {
    setLoading(true);
    try {
      const data = await api.getTeams({ season: 2024 });
      setTeams(data.teams || []);
    } catch (error) {
      console.error('Error fetching teams:', error);
    } finally {
      setLoading(false);
    }
  }

  // Check if current user already has a team
  const userHasTeam = user && teams.some(team => team.user_email === user.email);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Teams</h1>
        <div className="flex items-center gap-4">
          {user && !userHasTeam && (
            <Link href="/teams/create" className="btn-primary">
              + Create Team
            </Link>
          )}
          <div className="text-sm text-gray-600">
            {teams.length} team{teams.length !== 1 ? 's' : ''} • 2024 Season
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : teams.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No teams found.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Team Name</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Owner</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Value</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Remaining</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Leagues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {teams.map((team) => (
                <tr key={team.team_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4">
                    <Link href={`/teams/${team.team_id}`} className="font-semibold text-link-600 hover:text-link-700 hover:underline">
                      {team.team_name}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-gray-600 text-sm">{team.manager_name}</td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-bold text-primary-600">
                      ${parseFloat(team.current_value || 0).toFixed(1)}M
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-bold text-positive-600">
                      ${parseFloat(team.remaining_budget).toFixed(1)}M
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="font-semibold">{team.leagues_count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
