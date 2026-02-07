# Fantasy NFL Salary Cap API Documentation

Base URL: `http://localhost:3000`

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start

# Start with auto-reload (development)
npm run dev
```

## Overview

This API provides endpoints for managing a fantasy NFL salary cap game with:
- Player search and statistics
- Team management with $100m budgets
- League creation and standings
- Player transfers (buy/sell)
- Dynamic pricing based on performance

---

## Players Endpoints

### Search Players
```http
GET /api/players?position=QB&minPrice=5&maxPrice=15&search=mahomes&season=2024
```

**Query Parameters:**
- `position` - Filter by position (QB, RB, WR, TE, K, DEF)
- `minPrice` - Minimum price (in millions)
- `maxPrice` - Maximum price (in millions)
- `search` - Search by player name
- `season` - Season year (default: 2024)
- `limit` - Results per page (default: 50)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "count": 10,
  "players": [
    {
      "player_id": 123,
      "player_name": "Patrick Mahomes",
      "player_position": "QB",
      "player_team": "KC",
      "current_price": 15.2,
      "avg_points": 24.5
    }
  ]
}
```

### Get Player Details
```http
GET /api/players/:id?season=2024
```

**Response:**
```json
{
  "success": true,
  "player": {
    "player_id": 123,
    "name": "Patrick Mahomes",
    "position": "QB",
    "team": "KC",
    "current_price": 15.2,
    "season_avg_points": 24.5,
    "games_played": 11
  }
}
```

### Get Player Stats
```http
GET /api/players/:id/stats?season=2024&format=ppr
```

**Response:**
```json
{
  "success": true,
  "count": 11,
  "stats": [
    {
      "week": 1,
      "total_points": 28.5,
      "passing_points": 22.0,
      "rushing_points": 2.5,
      "opponent": "DET"
    }
  ]
}
```

### Get Top Players by Position
```http
GET /api/players/top/QB?season=2024&limit=20
```

---

## Teams Endpoints

### List Teams
```http
GET /api/teams?season=2024&userEmail=alice@example.com
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "teams": [
    {
      "team_id": 1,
      "team_name": "GridIron Giants",
      "user_email": "alice@example.com",
      "current_spent": 87.5,
      "remaining_budget": 12.5,
      "leagues_count": 2,
      "roster_count": 15
    }
  ]
}
```

### Create Team
```http
POST /api/teams
Content-Type: application/json

{
  "teamName": "My Awesome Team",
  "userEmail": "user@example.com",
  "season": 2024
}
```

### Get Team Details
```http
GET /api/teams/:id
```

### Get Team Roster
```http
GET /api/teams/:id/roster?week=11&season=2024
```

**Response:**
```json
{
  "success": true,
  "week": 11,
  "totalPoints": 125.5,
  "starters": [
    {
      "player_name": "Patrick Mahomes",
      "position_slot": "QB",
      "current_price": 15.2,
      "week_points": 28.5,
      "is_starter": true
    }
  ],
  "bench": [...]
}
```

### Get Team Standings
```http
GET /api/teams/:id/standings?week=11&season=2024
```

### Set Starting Lineup
```http
PUT /api/teams/:id/lineup
Content-Type: application/json

{
  "week": 11,
  "season": 2024
}
```

### Get Transfer History
```http
GET /api/teams/:id/transfers?season=2024&limit=20
```

---

## Leagues Endpoints

### List Leagues
```http
GET /api/leagues?season=2024&status=active
```

**Response:**
```json
{
  "success": true,
  "count": 3,
  "leagues": [
    {
      "league_id": 1,
      "league_name": "Premier League",
      "season": 2024,
      "max_teams": 12,
      "current_teams": 8,
      "status": "active"
    }
  ]
}
```

### Create League
```http
POST /api/leagues
Content-Type: application/json

{
  "leagueName": "My League",
  "season": 2024,
  "maxTeams": 10,
  "startWeek": 1,
  "endWeek": 18
}
```

### Get League Details
```http
GET /api/leagues/:id
```

**Response:**
```json
{
  "success": true,
  "league": {
    "league_id": 1,
    "league_name": "Premier League",
    "current_teams": 8,
    "teams": [
      {
        "team_id": 1,
        "team_name": "GridIron Giants",
        "user_email": "alice@example.com"
      }
    ]
  }
}
```

### Get League Standings
```http
GET /api/leagues/:id/standings?week=11&season=2024
```

**Response:**
```json
{
  "success": true,
  "week": 11,
  "standings": [
    {
      "rank": 1,
      "team_name": "GridIron Giants",
      "week_points": 125.5,
      "total_points": 1245.2
    }
  ]
}
```

### Join League
```http
POST /api/leagues/:id/join
Content-Type: application/json

{
  "teamId": 1
}
```

### Leave League
```http
DELETE /api/leagues/:id/leave
Content-Type: application/json

{
  "teamId": 1
}
```

---

## Transfers Endpoints

### Preview Transfer
Calculate the budget impact before executing.

```http
POST /api/transfers/preview
Content-Type: application/json

{
  "teamId": 1,
  "week": 12,
  "season": 2024,
  "playersOut": [45, 67],
  "playersIn": [123, 456]
}
```

**Response:**
```json
{
  "success": true,
  "preview": {
    "currentSpent": 87.5,
    "moneyFreed": 12.0,
    "moneyNeeded": 18.5,
    "newTotalSpent": 94.0,
    "remainingBudget": 6.0,
    "isAffordable": true
  }
}
```

### Execute Transfer
Buy and sell players in one transaction.

```http
POST /api/transfers/execute
Content-Type: application/json

{
  "teamId": 1,
  "week": 12,
  "season": 2024,
  "playersOut": [45, 67],
  "playersIn": [123, 456]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transfer executed successfully",
  "transfers": {
    "playersOut": [
      { "playerId": 45, "price": 6.5 }
    ],
    "playersIn": [
      { "playerId": 123, "price": 15.2 }
    ]
  },
  "newBudget": {
    "spent": 94.0,
    "remaining": 6.0
  }
}
```

### Validate Roster
Check if a roster meets all constraints.

```http
POST /api/transfers/validate-roster
Content-Type: application/json

{
  "playerIds": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  "season": 2024
}
```

**Response:**
```json
{
  "success": true,
  "validation": {
    "isValid": true,
    "totalCost": 98.5,
    "remainingBudget": 1.5,
    "playerCount": 15,
    "positions": {
      "qb": 2,
      "rb": 4,
      "wr": 4,
      "te": 2,
      "k": 1,
      "def": 2
    },
    "message": "Valid roster"
  }
}
```

---

## Settings Endpoints

### Get All Settings
```http
GET /api/settings
```

**Response:**
```json
{
  "success": true,
  "settings": {
    "current_week": {
      "value": "11",
      "description": "Current NFL week for the season",
      "updated_at": "2026-01-06T17:55:42.089Z"
    },
    "current_season": {
      "value": "2024",
      "description": "Current NFL season year",
      "updated_at": "2026-01-06T17:55:42.089Z"
    }
  }
}
```

### Get Specific Setting
```http
GET /api/settings/:key
```

**Example:**
```http
GET /api/settings/current_week
```

**Response:**
```json
{
  "success": true,
  "key": "current_week",
  "value": "11",
  "description": "Current NFL week for the season",
  "updated_at": "2026-01-06T17:55:42.089Z"
}
```

### Update Setting
```http
PUT /api/settings/:key
Content-Type: application/json

{
  "value": "12"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Setting 'current_week' updated successfully",
  "setting": {
    "key": "current_week",
    "value": "12",
    "description": "Current NFL week for the season",
    "updated_at": "2026-01-06T17:58:21.835Z"
  }
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message here"
}
```

**Common HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

---

## Database Functions Used

The API leverages PostgreSQL functions for complex queries:

- `get_available_players()` - Efficient player search
- `get_lineup_with_points()` - Roster with weekly points
- `get_league_standings()` - League rankings
- `calculate_transfer_impact()` - Budget calculations
- `validate_roster()` - Roster constraint checking
- `set_starting_lineup()` - Auto-optimize lineup

See `schema.sql` for function definitions.
