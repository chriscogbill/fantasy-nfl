import './globals.css';
import { Geist_Mono } from 'next/font/google';
import Navigation from '../components/Navigation';
import { AuthProvider } from '../lib/AuthContext';

// Monospace body — trialling the hub/productivity-suite voice on a game app
// (Chris, 2026-08-13); if it sticks, the brand skill gets updated to a single
// mono voice across the estate.
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata = {
  metadataBase: new URL('https://fantasynfl.cogs.tech'),
  title: 'Fantasy NFL',
  description: 'Build your NFL team with a $100M budget — player prices move with form. Set weekly lineups, make transfers and compete in leagues.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={geistMono.variable}>
      <body>
        <AuthProvider>
          <Navigation />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
