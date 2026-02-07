#!/bin/bash

# Fantasy NFL API Example Requests
# Make sure the server is running first: npm start

API_URL="http://localhost:3000"

echo "=== Fantasy NFL API Example Requests ==="
echo ""

# Health Check
echo "1. Health Check:"
curl -s "$API_URL/health" | jq .
echo ""

# Search Players
echo "2. Search for QBs:"
curl -s "$API_URL/api/players?position=QB&limit=5" | jq .
echo ""

# Get Specific Player
echo "3. Get Player Details (ID 6639 - Jalen Hurts):"
curl -s "$API_URL/api/players/6639" | jq .
echo ""

# Get Player Stats
echo "4. Get Player Stats:"
curl -s "$API_URL/api/players/6639/stats?season=2024" | jq '.stats | length' 2>/dev/null || echo "Stats available"
echo ""

# List Teams
echo "5. List All Teams:"
curl -s "$API_URL/api/teams?season=2024" | jq '.teams | length'
echo "teams found"
echo ""

# Get Team Roster
echo "6. Get Team Roster (Team ID 18, Week 1):"
curl -s "$API_URL/api/teams/18/roster?week=1&season=2024" | jq '{totalPoints, startersCount: (.starters | length), benchCount: (.bench | length)}'
echo ""

# List Leagues
echo "7. List Leagues:"
curl -s "$API_URL/api/leagues?season=2024" | jq '.leagues | length'
echo "leagues found"
echo ""

# League Standings
echo "8. League Standings (League 10, Week 1):"
curl -s "$API_URL/api/leagues/10/standings?week=1&season=2024" | jq '.standings[0:3]'
echo ""

# Preview Transfer
echo "9. Preview Transfer (selling player 100, buying player 200):"
curl -s -X POST "$API_URL/api/transfers/preview" \
  -H "Content-Type: application/json" \
  -d '{
    "teamId": 18,
    "week": 2,
    "season": 2024,
    "playersOut": [],
    "playersIn": [6639]
  }' | jq .preview
echo ""

echo "=== All Tests Complete ==="
