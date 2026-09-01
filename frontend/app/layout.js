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
  // PWA: app/manifest.webmanifest + app/apple-icon.png are auto-linked by
  // Next; this makes Add to Home Screen (iOS) / Add to Dock (macOS Safari)
  // open full-screen with the app's own identity.
  appleWebApp: { capable: true, title: "Fantasy NFL", statusBarStyle: "default" },
  metadataBase: new URL('https://fantasynfl.cogs.tech'),
  title: 'Fantasy NFL',
  description: 'Build your NFL dream team with a $100M budget.',
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
