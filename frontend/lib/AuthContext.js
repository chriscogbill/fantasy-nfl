'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userTeamId, setUserTeamId] = useState(null);
  const [teamRosterComplete, setTeamRosterComplete] = useState(false);
  const [currentSeason, setCurrentSeason] = useState(null);

  useEffect(() => {
    initializeApp();
  }, []);

  // Load user's team when user or currentSeason changes
  useEffect(() => {
    if (user && currentSeason) {
      loadUserTeam();
    } else if (!user) {
      setUserTeamId(null);
      setTeamRosterComplete(false);
    }
  }, [user, currentSeason]);

  async function initializeApp() {
    try {
      // Fetch current season and auth check in parallel
      const [seasonData, authResponse] = await Promise.allSettled([
        api.getCurrentSeason(),
        api.getCurrentUser()
      ]);

      if (seasonData.status === 'fulfilled') {
        setCurrentSeason(seasonData.value);
      } else {
        setCurrentSeason(2024); // fallback
      }

      if (authResponse.status === 'fulfilled') {
        setUser(authResponse.value.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Error initializing app:', error);
      setCurrentSeason(2024);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadUserTeam() {
    try {
      const data = await api.getTeams({ season: currentSeason });
      const myTeam = data.teams?.find(t => t.user_email === user?.email);
      if (myTeam) {
        setUserTeamId(myTeam.team_id);
        setTeamRosterComplete(parseInt(myTeam.roster_count) >= 15);
      } else {
        setUserTeamId(null);
        setTeamRosterComplete(false);
      }
    } catch (error) {
      console.error('Error loading user team:', error);
      setUserTeamId(null);
      setTeamRosterComplete(false);
    }
  }

  // Function to refresh user team (call after creating a team)
  async function refreshUserTeam() {
    await loadUserTeam();
  }

  // Function to refresh season (call after season roll-forward)
  async function refreshSeason() {
    try {
      const season = await api.getCurrentSeason();
      setCurrentSeason(season);
    } catch (error) {
      console.error('Error refreshing season:', error);
    }
  }

  async function login(email, password) {
    const response = await api.login(email, password);
    setUser(response.user);
    return response;
  }

  async function register(email, username, password) {
    const response = await api.register(email, username, password);
    setUser(response.user);
    return response;
  }

  async function logout() {
    await api.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, userTeamId, teamRosterComplete, refreshUserTeam, currentSeason, refreshSeason }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
