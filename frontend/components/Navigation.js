'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, userTeamId } = useAuth();
  const [currentWeek, setCurrentWeek] = useState(null);
  const [currentYear, setCurrentYear] = useState(null);
  const [currentDay, setCurrentDay] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    loadCurrentSettings();
  }, []);

  async function loadCurrentSettings() {
    try {
      const [week, yearResponse, dayResponse] = await Promise.all([
        api.getCurrentWeek(),
        api.getSetting('current_season'),
        api.getSetting('current_day')
      ]);
      setCurrentWeek(week);
      setCurrentYear(yearResponse?.value || 2024);
      setCurrentDay(dayResponse?.value || 1);
    } catch (error) {
      console.error('Error loading current settings:', error);
    }
  }

  async function handleYearChange(newYear) {
    setIsUpdating(true);
    try {
      await api.updateSetting('current_season', newYear);
      setCurrentYear(newYear);
      // Reload the page to refresh data
      window.location.reload();
    } catch (error) {
      console.error('Error updating year:', error);
      alert('Failed to update year');
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleWeekChange(newWeek) {
    setIsUpdating(true);
    try {
      await api.updateSetting('current_week', newWeek);
      setCurrentWeek(newWeek);
      // Reload the page to refresh data
      window.location.reload();
    } catch (error) {
      console.error('Error updating week:', error);
      alert('Failed to update week');
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleDayChange(newDay) {
    setIsUpdating(true);
    try {
      await api.updateSetting('current_day', newDay);
      setCurrentDay(newDay);
      // Reload the page to refresh data
      window.location.reload();
    } catch (error) {
      console.error('Error updating day:', error);
      alert('Failed to update day');
    } finally {
      setIsUpdating(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  }

  // Build navigation items in order: Home, Team, Transfers, Lineup, Leagues, Players, Teams
  const navItems = [];

  // Home is always first
  navItems.push({ href: '/', label: 'Home' });

  // Add team management links if user has a team
  if (userTeamId) {
    navItems.push(
      { href: `/teams/${userTeamId}`, label: 'Points' },
      { href: `/teams/${userTeamId}/transfers`, label: 'Transfers' },
      { href: `/teams/${userTeamId}/lineup`, label: 'Lineup' }
    );
  }

  // Add general navigation
  navItems.push(
    { href: '/leagues', label: 'Leagues' },
    { href: '/players', label: 'Players' }
  );

  // Add Teams link only for admins
  if (user?.role === 'admin') {
    navItems.push({ href: '/teams', label: 'Teams' });
  }

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/" className="flex items-center">
                <img
                  src="/cogs-fantasy-nfl.svg"
                  alt="Cogs Fantasy NFL"
                  className="h-8"
                />
              </Link>
            </div>
            <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors
                    ${
                      pathname === item.href
                        ? 'border-primary-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }
                  `}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-6">
            {user?.role === 'admin' ? (
              <div className="flex items-center gap-4">
                {/* Year Selector */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600">Year:</span>
                  <select
                    value={currentYear || ''}
                    onChange={(e) => handleYearChange(e.target.value)}
                    disabled={isUpdating || currentYear === null}
                    className="px-2 py-1 border border-gray-300 rounded-md text-sm font-semibold focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
                  >
                    {currentYear === null ? (
                      <option value="">Loading...</option>
                    ) : (
                      <>
                        {[2024, 2025, 2026].map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                {/* Week Selector */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600">Week:</span>
                  <select
                    value={currentWeek || ''}
                    onChange={(e) => handleWeekChange(e.target.value)}
                    disabled={isUpdating || currentWeek === null}
                    className="px-2 py-1 border border-gray-300 rounded-md text-sm font-semibold focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
                  >
                    {currentWeek === null ? (
                      <option value="">Loading...</option>
                    ) : (
                      <>
                        <option value="Preseason">Pre</option>
                        {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>

                {/* Day Selector */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600">Day:</span>
                  <select
                    value={currentDay || ''}
                    onChange={(e) => handleDayChange(e.target.value)}
                    disabled={isUpdating || currentDay === null}
                    className="px-2 py-1 border border-gray-300 rounded-md text-sm font-semibold focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
                  >
                    {currentDay === null ? (
                      <option value="">Loading...</option>
                    ) : (
                      <>
                        {Array.from({ length: 7 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </div>
              </div>
            ) : currentWeek !== null && (
              <div className="text-sm text-gray-600">
                {currentYear && `${currentYear} - `}
                {currentWeek === 'Preseason' ? 'Preseason' : `Week ${currentWeek}`}
                {currentWeek !== 'Preseason' && currentDay && ` - Day ${currentDay}`}
              </div>
            )}

            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-700">
                  Welcome, <span className="font-semibold text-link-600">{user.username}</span>
                </span>
                <button onClick={handleLogout} className="text-sm text-primary-600 hover:underline cursor-pointer">
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login" className="text-sm text-primary-600 hover:underline">
                  Login
                </Link>
                <span className="text-gray-400">|</span>
                <Link href="/register" className="text-sm text-primary-600 hover:underline">
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
