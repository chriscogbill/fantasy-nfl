# Fantasy NFL App

## Overview
A full-stack Fantasy NFL salary cap management game where users build NFL fantasy teams with a fixed $100 million budget, manage rosters week-by-week, compete in leagues, and execute trades.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express.js (Port 3000) |
| Frontend | Next.js 16 + React 19 (Port 3001) |
| Database | PostgreSQL with PL/pgSQL functions |
| Styling | Tailwind CSS 4 |
| Data Source | Sleeper API (NFL stats) |
| Auth | Express Session + bcrypt |

## Project Structure

```
fantasy-nfl/
├── server.js                     # Express entry point
├── schema.sql                    # Database schema (13 tables, 11 PL/pgSQL functions)
├── src/
│   ├── db/connection.js          # PostgreSQL connection pool
│   └── routes/
│       ├── players.js            # Player search & stats
│       ├── teams.js              # Team CRUD & rosters
│       ├── leagues.js            # League management
│       ├── transfers.js          # Trade execution
│       ├── auth.js               # Authentication
│       └── settings.js           # System settings (admin only for writes)
├── importStats.js                # Import from Sleeper API
├── calculatePrices.js            # Dynamic pricing algorithm
├── generateSampleData.js         # Test data generation
├── createAdminUser.js            # Admin user creation script
├── createUsers.js                # Batch user creation script
├── resetAdminPassword.js         # Admin password reset
├── scripts/
│   └── importNflFixtures.js      # NFL schedule import
├── frontend/
│   ├── app/
│   │   ├── layout.js             # Root layout (AuthProvider + Navigation)
│   │   ├── page.js               # Home dashboard
│   │   ├── login/page.js         # Login form
│   │   ├── register/page.js      # Registration form
│   │   ├── players/page.js       # Player search & browse
│   │   ├── teams/
│   │   │   ├── page.js           # All teams list (admin)
│   │   │   ├── create/page.js    # Create team form
│   │   │   └── [id]/
│   │   │       ├── page.js       # Team points view
│   │   │       ├── lineup/page.js    # Set starting lineup
│   │   │       ├── points/page.js    # Points breakdown
│   │   │       └── transfers/page.js # Trade management + auto-pick
│   │   └── leagues/
│   │       ├── page.js           # League browser
│   │       ├── create/page.js    # Create league form
│   │       └── [id]/page.js      # League standings & history
│   ├── components/
│   │   ├── Navigation.js         # Nav bar + admin week/year/day controls
│   │   └── PlayerStatsModal.js   # Position-specific stats for 18 weeks
│   └── lib/
│       ├── api.js                # API client class
│       └── AuthContext.js        # Auth context + team ID resolution
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
- **Key tables**: players, player_stats, player_current_prices, player_price_history, player_scores (view), teams, rosters, transfers, leagues, league_entries, league_standings, nfl_fixtures, scoring, scoring_sections, roster_constraints, users, app_settings, lineup_deadlines
- **Key view**: `player_scores` - Computed view that cross-joins `player_stats` with `scoring` rules to calculate fantasy points per format (PPR, standard, etc.). This is the core scoring engine.
- **Key functions**: calculate_transfer_impact(), get_available_players(), get_lineup_with_points(), get_league_standings(), get_league_history(), set_starting_lineup(), validate_roster(), copy_all_rosters_to_next_week()
- **Indexes**: 12 indexes on common query patterns (rosters by team/week, standings, fixtures, price history)

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
- [x] Add 'Player Prices' admin page with ability to increase/decrease a player price by 0.1 on a specific day - DONE: Added `/players/prices` admin page with +/- 0.1 buttons, season/week/day selectors, player search/filter. Backend: `PUT /api/players/:id/price` endpoint updates `player_current_prices` and records in `player_price_history` with day column. Added `day` column to `player_price_history` schema. Nav link added for admins.

### New User Experience
- [x] If user signs in without a team, hide transfers, lineup, and points menus - FIXED
- [x] Create separate 'Build your team' page for initial team selection (similar to transfers page but with all positions initially blank) - FIXED

### Features
- [ ] Add manager history (track previous team owners)

### Deployment
- [ ] Make the app accessible online (deploy to hosting platform)
- [ ] Security audit (check for vulnerabilities, secure API endpoints, input validation, etc.)

### Build Your Roster Screen
- [x] Remove 'Back to Team' page link (not needed for initial team selection) - DONE: Hidden when roster is empty
- [x] Make 'Welcome! Let's build your team' smaller or match width of team value/budget boxes below, or remove boxes entirely for initial selection - KEPT AS-IS (user happy with current design)
- [x] Make available players section vertically bigger before scrolling through it - DONE: Increased max-h from 384px to 600px
- [x] Error message shouldn't show in red with cross when first selecting players - DONE: Shows yellow warning style during initial roster selection, red only for existing roster transfers
- [x] 'Change' should be 'Spending' for first selection - DONE: Label shows "Spending" when roster is empty, "Change" otherwise
- [x] Total points should be replaced by previous year points during preseason - DONE: Imported 2023 stats from Sleeper API, added `prev_season_total` to `get_available_players()`, shows "{year} Pts" during preseason (0 for rookies)
- [x] Fix players currently showing on wrong teams - RESOLVED: Removed team_2024 column (was redundant). Now using `players.team` (current team from Sleeper API) for display, and `player_stats.team` for per-game opponent tracking. Note: During backtesting, players show their current real-world team, not their historical team - this is expected behavior

### Set Lineup Page
- [x] Show deadline for choosing lineup - DONE: Created `lineup_deadlines` table, ESPN auto-import, admin management page, deadline display on lineup page and home page, enforcement via simulated day comparison (locks lineup when `current_day >= deadline_day`), works during Preseason too (shows deadline but doesn't lock)

### Admin Features (Upcoming)
- [ ] Add 'Set Starting Prices' admin page — lets admin import player data from different sources and adjust prices before the season starts, available to all users once published
- [x] Add a pre-preseason "Setup" phase where users can't select or modify teams - DONE: Added "Setup" option to admin week selector. During Setup: nav hides team management links, home page shows "season being prepared" message, transfers/lineup/create-team pages show blocking message. Points nav hidden during Preseason too

### Player Stats Modal
- [x] Fix opponent display: Past weeks (based on current_week setting) should show opponent from `player_stats.team`, future weeks should show fixtures from `nfl_fixtures` based on `players.team` - DONE
- [x] Show all 18 weeks: Past weeks show actual stats, future weeks show dashes for stats - DONE
- [x] Style future weeks in a different theme color to distinguish from played weeks - DONE
- [x] During preseason, all weeks should show as "future" (fixtures only, no stats) - DONE
- [ ] Create player_team_history table to track which team a player was on each week (independent of stats). Currently, weeks without stats fall back to the player's current team, which may be incorrect if the player changed teams mid-season. This would allow accurate opponent display even for weeks where a player didn't record stats.

### Security (from codebase analysis)
- [ ] Add authorization middleware to verify the logged-in user owns the team they're modifying (currently any user can execute transfers, modify lineups, etc. for any team)
- [x] Move hardcoded session secret to environment variable - DONE: server.js now reads `SESSION_SECRET` from env with fallback
- [x] Move DB credentials to environment variables - DONE: connection.js now reads `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT` from env with fallbacks. Added `.env.example` for reference
- [ ] Add rate limiting on login endpoint and other sensitive routes to prevent brute-force attacks
- [ ] Stop exposing internal error messages to clients (`error.message` is returned directly in API responses)
- [x] Add a persistent session store (currently uses in-memory store which won't scale and loses sessions on restart) - DONE: Using connect-pg-simple with PostgreSQL session table in cogsAuth database

### Multi-Site / Subdomain Architecture
- [ ] Configure session cookies at parent domain level (e.g., `.cogs.tech`) to share authentication across subdomains
- [x] Set up shared persistent session store (Redis or PostgreSQL) accessible by all apps - DONE: PostgreSQL session store in cogsAuth database shared across apps
- [x] Consider extracting auth into a shared service or shared database for users table - DONE: Created cogs-auth service on port 3002 with dedicated cogsAuth database
- [ ] Potential subdomains: fantasynfl.cogs.tech, plpicker.cogs.tech, chris.cogs.tech

### Code Quality (from codebase analysis)
- [ ] Remove hardcoded `season = 2024` across the codebase (~20 places in frontend and some backend routes) - should use the `current_season` setting instead
- [ ] Decompose transfers/page.js (1,117 lines) into smaller components (e.g., separate auto-pick, player list, roster display)
- [x] Consolidate duplicate DB pool configurations - DONE: calculatePrices.js, importStats.js, generateSampleData.js, createUsers.js now all import from src/db/connection.js instead of creating their own pools
- [ ] Leverage Next.js SSR/SSG where appropriate (currently all pages use `'use client'` with no server-side rendering)
- [ ] Add test coverage (no tests exist in the codebase)
- [x] Add the `users` and `app_settings` table definitions to schema.sql - DONE: Both were missing from the pg_dump; added with sequences, PKs, and unique constraints

### To Test / Check
- [ ] Validate that entering an incorrect league code gives an error

