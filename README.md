# Fantasy NFL Application

A full-stack fantasy football application with dynamic player pricing and salary cap management.

## 🏗️ Project Structure

```
fantasy-nfl-import/
├── frontend/              # Next.js React frontend
│   ├── app/              # Pages and layouts
│   ├── components/       # Reusable UI components
│   ├── lib/              # API client and utilities
│   └── README.md         # Frontend documentation
├── src/                  # Backend API
│   ├── db/              # Database connection
│   └── routes/          # API endpoints
├── server.js            # Express API server
├── importStats.js       # Import NFL player stats
├── calculatePrices.js   # Calculate dynamic player prices
├── generateSampleData.js # Generate test data
├── schema.sql           # Database schema
└── API.md               # API documentation
```

## 🚀 Quick Start

### 1. Start the Backend API

```bash
# From the root directory
npm start
```

The API runs on **http://localhost:3000**

### 2. Start the Frontend

```bash
# In a new terminal
cd frontend
npm run dev
```

The frontend runs on **http://localhost:3001**

### 3. Open Your Browser

Visit **http://localhost:3001** to see the application!

## 📋 Prerequisites

- **Node.js 18+** installed
- **PostgreSQL** running (Postgres.app or similar)
- Database **fantasyNFL** created with schema loaded

## 🎮 Features

### Frontend Pages

- **Home** (/) - Dashboard with stats and feature overview
- **Players** (/players) - Search and filter NFL players by position, price, name
- **Teams** (/teams) - Browse fantasy teams with budgets and rosters
- **Team Detail** (/teams/[id]) - View weekly lineup, starters, bench, and points
- **Leagues** (/leagues) - Active fantasy leagues
- **League Detail** (/leagues/[id]) - Weekly standings and rankings

### API Endpoints

- **Players** - Search, stats, pricing, top players
- **Teams** - CRUD operations, roster management, lineup optimization
- **Leagues** - Create, join, standings, history
- **Transfers** - Preview and execute player trades

## 🛠️ Development Scripts

### Backend

```bash
npm start              # Start API server
npm run import:stats   # Import NFL stats from Sleeper API
npm run calc:prices    # Calculate player prices
npm run generate:sample # Create sample data
```

### Frontend

```bash
cd frontend
npm run dev            # Development server with hot reload
npm run build          # Production build
npm start              # Production server
```

## 📊 Database Setup

### Create Database

```sql
CREATE DATABASE fantasyNFL;
```

### Load Schema

```bash
psql -U chriscogbill -d fantasyNFL -f schema.sql
```

### Import Data

```bash
# 1. Import all players
node importStats.js

# 2. Calculate initial prices
node calculatePrices.js

# 3. Generate sample teams and leagues (optional)
node generateSampleData.js
```

## 🎯 Game Rules

- **Budget**: $100 million per team
- **Roster Size**: 15 players
  - 2 QB, 4 RB, 4 WR, 2 TE, 1 K, 2 DEF

- **Starting Lineup**: 9 players
  - 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (RB/WR/TE), 1 K, 1 DEF

- **Scoring**: PPR (Point Per Reception)
- **Transfers**: Buy/sell players week-to-week within budget
- **Pricing**: Dynamic prices based on performance and ownership

## 📚 Documentation

- **Frontend**: See `frontend/README.md`
- **API**: See `API.md` for all endpoints
- **Database**: See `schema.sql` for schema documentation

## 🔧 Tech Stack

### Backend
- **Node.js** + **Express** - API server
- **PostgreSQL** - Database with advanced functions
- **Sleeper API** - Real NFL stats

### Frontend
- **Next.js 14** - React framework
- **React 19** - UI library
- **Tailwind CSS 4** - Styling
- **JavaScript** - Programming language

## 🐛 Troubleshooting

### Backend won't start
- Check PostgreSQL is running
- Verify database **fantasyNFL** exists
- Check port 3000 is not in use

### Frontend shows errors
- Make sure backend is running on port 3000
- Check `.env.local` has correct API URL
- Run `npm install` in frontend directory

### No data showing
- Import stats with `npm run import:stats`
- Calculate prices with `npm run calc:prices`
- Generate sample data with `npm run generate:sample`

## 📝 Example Usage

1. **Import Week 1-11 Stats**
   ```bash
   node importStats.js  # Edit file to set weeks
   ```

2. **Calculate Prices**
   ```bash
   node calculatePrices.js
   ```

3. **Create Sample Teams**
   ```bash
   node generateSampleData.js
   ```

4. **Start Servers**
   ```bash
   # Terminal 1
   npm start

   # Terminal 2
   cd frontend && npm run dev
   ```

5. **Browse**
   - Visit http://localhost:3001
   - Search for players
   - View team rosters
   - Check league standings

## 🎉 You're Ready!

Your full-stack Fantasy NFL application is now running!

- Backend API: http://localhost:3000
- Frontend App: http://localhost:3001
- API Health: http://localhost:3000/health

Enjoy managing your fantasy team! 🏈
