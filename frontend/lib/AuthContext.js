'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userTeamId, setUserTeamId] = useState(null);

  useEffect(() => {
    checkAuth();
  }, []);

  // Load user's team when user changes
  useEffect(() => {
    if (user) {
      loadUserTeam();
    } else {
      setUserTeamId(null);
    }
  }, [user]);

  async function loadUserTeam() {
    try {
      const data = await api.getTeams({ season: 2024 });
      const myTeam = data.teams?.find(t => t.user_email === user?.email);
      if (myTeam) {
        setUserTeamId(myTeam.team_id);
      } else {
        setUserTeamId(null);
      }
    } catch (error) {
      console.error('Error loading user team:', error);
      setUserTeamId(null);
    }
  }

  // Function to refresh user team (call after creating a team)
  async function refreshUserTeam() {
    await loadUserTeam();
  }

  async function checkAuth() {
    try {
      const response = await api.getCurrentUser();
      setUser(response.user);
    } catch (error) {
      // Only log if it's not a simple "not authenticated" error
      if (!error.message?.includes('Not authenticated')) {
        console.error('Auth check error:', error);
      }
      setUser(null);
    } finally {
      setLoading(false);
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
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkAuth, userTeamId, refreshUserTeam }}>
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
