# Fantasy NFL App

## Overview
A full-stack Fantasy NFL salary cap management game where users build NFL fantasy teams with a fixed $100 million budget, manage rosters week-by-week, compete in leagues, and execute trades.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express.js (Port 3000) |
| Frontend | Next.js 14 + React 19 (Port 3001) |
| Database | PostgreSQL with PL/pgSQL functions |
| Styling | Tailwind CSS 4 |
| Data Source | Sleeper API (NFL stats) |
| Auth | Express Session + bcrypt |

## Project Structure

```
fantasy-nfl-import/
├── backend/
│   ├── server.js                 # Express entry point
│   ├── src/
│   │   ├── db/connection.js      # PostgreSQL connection pool
│   │   └── routes/
│   │       ├── players.js        # Player search & stats
│   │       ├── teams.js          # Team CRUD & rosters
│   │       ├── leagues.js        # League management
│   │       ├── transfers.js      # Trade execution
│   │       ├── auth.js           # Authentication
│   │       └── settings.js       # System settings
│   ├── schema.sql                # Database schema
│   └── scripts/
│       ├── importStats.js        # Import from Sleeper API
│       ├── calculatePrices.js    # Dynamic pricing
│       └── generateSampleData.js # Test data
├── frontend/
│   ├── app/
│   │   ├── page.js               # Home dashboard
│   │   ├── players/page.js       # Player search
│   │   ├── teams/[id]/
│   │   │   ├── page.js           # Team detail
│   │   │   ├── lineup/page.js    # Set starting lineup
│   │   │   └── transfers/page.js # Trade management
│   │   └── leagues/[id]/page.js  # League standings
│   ├── components/
│   │   ├── Navigation.js
│   │   └── PlayerStatsModal.js
│   └── lib/
│       ├── api.js                # API client
│       └── AuthContext.js        # Auth context
```

## Game Rules

- **Budget**: $100 million salary cap per team
- **Roster Size**: Exactly 15 players
- **Position Minimums**: 1 QB, 3 RB, 3 WR, 1 TE, 1 K, 1 DEF
- **Starting Lineup**: 9 players (1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF)
- **Scoring**: PPR format (1 point per reception)
- **Minimum Player Price**: $4.5 million
- **Transfers**: Limited free transfers per week, point penalties for extras
- **Preseason**: Unlimited transfers

## Key API Endpoints

```
GET  /api/players           # Search players (filters: position, price, name)
GET  /api/players/:id/stats # Player weekly stats
GET  /api/teams/:id/roster  # Team roster with points
PUT  /api/teams/:id/lineup  # Set starting lineup
POST /api/transfers/preview # Preview trade impact
POST /api/transfers/execute # Execute trades
GET  /api/leagues/:id/standings # League rankings
GET  /api/settings          # Current week/season
```

## Development Commands

```bash
# Backend (from root)
npm start                 # Production
npm run dev               # Watch mode
npm run import:stats      # Import NFL stats from Sleeper
npm run calc:prices       # Recalculate player prices

# Frontend
cd frontend && npm run dev  # Dev server on 3001
```

## Database

- **Database name**: fantasyNFL
- **Key tables**: players, player_current_prices, player_stats, teams, rosters, transfers, leagues, league_entries
- **Key functions**: calculate_transfer_impact(), get_available_players(), get_lineup_with_points()

## Recent Work

### Auto-Pick Feature (transfers/page.js:229-500)
- **Fixed**: Budget reservation bug - algorithm now properly reserves $4.5M per remaining roster spot before each pick, ensuring all 15 spots can be filled
- **Fixed**: Desperation mode now uses full remaining budget (ignores buffer) to fill final roster spots
- **Added**: Randomness to player selection - picks randomly from top 5 candidates at each position instead of always selecting the same players

### Pricing Algorithm (calculatePrices.js)
- Position multipliers: RB (1.2x), TE (1.3x), WR (1.1x), QB (0.9x), DEF (0.8x), K (0.7x)
- Based on average points across played weeks
- Percentile ranking against position peers
- Minimum 3 games required for meaningful pricing

## Known Issues

- [x] Players who change team mid-season show on their old team instead of their current team when selecting - FIXED: Added team_2024 column to players table and team column to player_stats for per-week tracking. Updated DB functions to use COALESCE(player_stats.team, team_2024, team). Mid-season trades (Davante Adams LV→NYJ, Amari Cooper CLE→BUF, DeAndre Hopkins TEN→KC) now show correct team per week.
- [x] Menus disappeared for new user once they selected their team - FIXED
- [x] First time selecting should say 'Confirm Team' not 'Confirm Transfer'. Also should say 'Confirm Transfers' (plural) - FIXED: Button now shows 'Confirm Roster' for initial selection, 'Confirm Transfers' (plural) when multiple, 'Confirm Transfer' (singular) when one

## TODO

### Admin Features
- [ ] Add 'Player Prices' admin page with ability to increase/decrease a player price by 0.1 on a specific day

### New User Experience
- [x] If user signs in without a team, hide transfers, lineup, and points menus - FIXED
- [x] Create separate 'Build your team' page for initial team selection (similar to transfers page but with all positions initially blank) - FIXED

### Features
- [ ] Add manager history (track previous team owners)

### Deployment
- [ ] Make the app accessible online (deploy to hosting platform)
- [ ] Security audit (check for vulnerabilities, secure API endpoints, input validation, etc.)

### Build Your Roster Screen
- [ ] Remove 'Back to Team' page link (not needed for initial team selection)
- [ ] Make 'Welcome! Let's build your team' smaller or match width of team value/budget boxes below, or remove boxes entirely for initial selection
- [ ] Make available players section vertically bigger before scrolling through it
- [ ] Error message shouldn't show in red with cross when first selecting players (implies they've done something wrong). Should be yellow without allowing transfers to be completed
- [ ] 'Change' should be 'Spending' for first selection
- [ ] Total points should be replaced by previous year points during preseason (as total points is 0 at that point). For rookies, show 0
- [x] Fix players currently showing on wrong teams - RESOLVED: Removed team_2024 column (was redundant). Now using `players.team` (current team from Sleeper API) for display, and `player_stats.team` for per-game opponent tracking. Note: During backtesting, players show their current real-world team, not their historical team - this is expected behavior

### Set Lineup Page
- [ ] Show deadline for choosing lineup

### Player Stats Modal
- [x] Fix opponent display: Past weeks (based on current_week setting) should show opponent from `player_stats.team`, future weeks should show fixtures from `nfl_fixtures` based on `players.team` - DONE
- [x] Show all 18 weeks: Past weeks show actual stats, future weeks show dashes for stats - DONE
- [x] Style future weeks in a different theme color to distinguish from played weeks - DONE
- [x] During preseason, all weeks should show as "future" (fixtures only, no stats) - DONE
- [ ] Create player_team_history table to track which team a player was on each week (independent of stats). Currently, weeks without stats fall back to the player's current team, which may be incorrect if the player changed teams mid-season. This would allow accurate opponent display even for weeks where a player didn't record stats.

### To Test / Check
- [ ] Validate that entering an incorrect league code gives an error

