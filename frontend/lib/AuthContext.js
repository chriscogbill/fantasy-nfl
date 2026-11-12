'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';
import { retryUntilAnswered } from './sessionLookup';
import AuthUnavailable from '../components/AuthUnavailable';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // True when the session check got no answer (not the same as signed out).
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [userTeamId, setUserTeamId] = useState(null);
  const [teamRosterComplete, setTeamRosterComplete] = useState(false);
  const [currentSeason, setCurrentSeason] = useState(null);

  useEffect(() => {
    initializeApp();
  }, []);

  // While the session check can't get an answer, keep asking in the
  // background and bring the app back as soon as it does.
  useEffect(() => {
    if (!authUnavailable) return;
    return retryUntilAnswered(() => api.lookupSession(), applySession);
  }, [authUnavailable]);

  function applySession(session) {
    setAuthUnavailable(session.kind === 'unavailable');
    setUser(session.kind === 'ok' ? session.user : null);
  }

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
      const [seasonData, session] = await Promise.allSettled([
        api.getCurrentSeason(),
        api.lookupSession()
      ]);

      if (seasonData.status === 'fulfilled') {
        setCurrentSeason(seasonData.value);
      } else {
        setCurrentSeason(new Date().getFullYear()); // fallback
      }

      // lookupSession never rejects; "unavailable" is its answer for a failed check.
      applySession(session.status === 'fulfilled' ? session.value : { kind: 'unavailable' });
    } catch (error) {
      console.error('Error initializing app:', error);
      setCurrentSeason(new Date().getFullYear());
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
      {authUnavailable ? <AuthUnavailable /> : children}
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
