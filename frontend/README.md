# Fantasy NFL Frontend

Modern React frontend built with Next.js and Tailwind CSS.

## Getting Started

### Prerequisites
- Node.js 18+ installed
- Backend API running on `http://localhost:3000`

### Installation

```bash
npm install
```

### Development

```bash
# Start development server (runs on port 3001)
npm run dev
```

Visit http://localhost:3001

### Build for Production

```bash
npm run build
npm start
```

## Features

### Pages

- **Home** (`/`) - Dashboard with stats and features overview
- **Players** (`/players`) - Search and filter NFL players
  - Filter by position, price range, name
  - View player stats and pricing
- **Teams** (`/teams`) - Browse all fantasy teams
  - View team budgets and roster sizes
  - Click to see detailed team view
- **Team Detail** (`/teams/[id]`) - Detailed team view
  - Week-by-week roster
  - Starting lineup vs bench
  - Player stats and points
- **Leagues** (`/leagues`) - All fantasy leagues
  - League status and team counts
- **League Detail** (`/leagues/[id]`) - League standings
  - Weekly rankings
  - Team points and roster values

### Components

- **Navigation** - Responsive navbar with active link highlighting
- **API Client** - Centralized API communication

### Styling

- Tailwind CSS for utility-first styling
- Custom components (buttons, cards, stat boxes)
- Responsive design for mobile/tablet/desktop
- Position-based color coding for players

## API Integration

The frontend connects to the Fantasy NFL API at `http://localhost:3000`.

Configure the API URL in `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Tech Stack

- **Next.js 14** - React framework with App Router
- **React 19** - UI library
- **Tailwind CSS** - Styling
- **JavaScript** - Programming language

## Project Structure

```
frontend/
├── app/                    # Next.js App Router
│   ├── page.js            # Home page
│   ├── layout.js          # Root layout with navigation
│   ├── globals.css        # Global styles
│   ├── players/
│   │   └── page.js        # Players list
│   ├── teams/
│   │   ├── page.js        # Teams list
│   │   └── [id]/
│   │       └── page.js    # Team detail
│   └── leagues/
│       ├── page.js        # Leagues list
│       └── [id]/
│           └── page.js    # League detail with standings
├── components/
│   └── Navigation.js      # Main navigation component
├── lib/
│   └── api.js            # API client
└── public/               # Static assets
```

## Development Tips

- Frontend runs on port **3001** (backend uses 3000)
- All API calls go through the `api` client in `lib/api.js`
- Use `'use client'` directive for interactive components
- Week numbers range from 1-18 for NFL season
