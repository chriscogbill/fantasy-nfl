'use client';

// Small NFL team logo, served from Sleeper's CDN by team abbreviation.
// Hides itself if the logo 404s (free agents, unknown abbreviations),
// so callers can always render it next to the abbreviation text.
export default function TeamLogo({ team, className = 'w-5 h-5' }) {
  if (!team) return null;
  return (
    <img
      src={`https://sleepercdn.com/images/team_logos/nfl/${String(team).toLowerCase()}.png`}
      alt=""
      className={`${className} inline-block object-contain align-middle`}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}
