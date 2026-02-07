import './globals.css';
import Navigation from '../components/Navigation';
import { AuthProvider } from '../lib/AuthContext';

export const metadata = {
  title: 'Fantasy NFL',
  description: 'Manage your Fantasy NFL team with dynamic salary cap',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
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
