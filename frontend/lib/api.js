// API Client for Fantasy NFL Backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const AUTH_BASE_URL = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:3002';

class ApiClient {
  // Request to the Fantasy NFL backend
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // Include cookies for session
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'API request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Players
  async getPlayers(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/players?${query}`);
  }

  async getPlayer(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/players/${id}?${query}`);
  }

  async getPlayerStats(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/players/${id}/stats?${query}`);
  }

  async getTopPlayers(position, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/players/top/${position}?${query}`);
  }

  async updatePlayerPrice(id, data) {
    return this.request(`/api/players/${id}/price`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Teams
  async getTeams(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/teams?${query}`);
  }

  async createTeam(teamData) {
    return this.request('/api/teams', {
      method: 'POST',
      body: JSON.stringify(teamData),
    });
  }

  async getTeam(id) {
    return this.request(`/api/teams/${id}`);
  }

  async getTeamRoster(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/teams/${id}/roster?${query}`);
  }

  async getTeamStandings(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/teams/${id}/standings?${query}`);
  }

  async setTeamLineup(id, data) {
    return this.request(`/api/teams/${id}/lineup`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getTeamTransfers(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/teams/${id}/transfers?${query}`);
  }

  // Leagues
  async getLeagues(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/leagues?${query}`);
  }

  async createLeague(leagueData) {
    return this.request('/api/leagues', {
      method: 'POST',
      body: JSON.stringify(leagueData),
    });
  }

  async getLeague(id) {
    return this.request(`/api/leagues/${id}`);
  }

  async getLeagueStandings(id, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/leagues/${id}/standings?${query}`);
  }

  async joinLeague(id, teamId, inviteCode = null) {
    return this.request(`/api/leagues/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({ teamId, inviteCode }),
    });
  }

  async joinLeagueByCode(teamId, inviteCode) {
    return this.request('/api/leagues/join-by-code', {
      method: 'POST',
      body: JSON.stringify({ teamId, inviteCode }),
    });
  }

  // Transfers
  async previewTransfer(transferData) {
    return this.request('/api/transfers/preview', {
      method: 'POST',
      body: JSON.stringify(transferData),
    });
  }

  async executeTransfer(transferData) {
    return this.request('/api/transfers/execute', {
      method: 'POST',
      body: JSON.stringify(transferData),
    });
  }

  async validateRoster(playerIds, season = 2024) {
    return this.request('/api/transfers/validate-roster', {
      method: 'POST',
      body: JSON.stringify({ playerIds, season }),
    });
  }

  // Auth - requests go to the shared auth service
  async authRequest(endpoint, options = {}) {
    const url = `${AUTH_BASE_URL}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Auth request failed');
      }

      return data;
    } catch (error) {
      console.error('Auth Error:', error);
      throw error;
    }
  }

  async register(email, username, password) {
    return this.authRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    });
  }

  async login(email, password) {
    return this.authRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async logout() {
    return this.authRequest('/api/auth/logout', {
      method: 'POST',
    });
  }

  async getCurrentUser() {
    return this.authRequest('/api/auth/me');
  }

  // Settings
  async getSettings() {
    return this.request('/api/settings');
  }

  async getSetting(key) {
    return this.request(`/api/settings/${key}`);
  }

  async updateSetting(key, value) {
    return this.request(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }

  async getCurrentWeek() {
    const response = await this.getSetting('current_week');
    // Return 'Preseason' as-is, otherwise parse as integer
    return response.value === 'Preseason' ? 'Preseason' : parseInt(response.value);
  }

  async getCurrentSeason() {
    const response = await this.getSetting('current_season');
    return parseInt(response.value);
  }
}

export const api = new ApiClient();
