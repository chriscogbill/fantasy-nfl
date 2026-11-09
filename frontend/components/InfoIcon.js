// Small outlined "i" used for the player-stats buttons. Inherits the button's
// text colour (currentColor) so hover states keep working; replaces the ℹ️ emoji.
export default function InfoIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" className={`inline-block align-middle ${className}`} aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9v5" strokeLinecap="round" />
      <circle cx="10" cy="6.25" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
