'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, userTeamId, teamRosterComplete, currentSeason } = useAuth();
  const [currentWeek, setCurrentWeek] = useState(null);
  const [currentYear, setCurrentYear] = useState(null);
  const [currentDay, setCurrentDay] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

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

  // Add team management links if user has a team (hidden during Setup)
  if (userTeamId && currentWeek !== 'Setup') {
    if (teamRosterComplete) {
      // Full roster - show all team management options
      // Hide Points during Preseason (no games played yet)
      if (currentWeek !== 'Preseason') {
        navItems.push({ href: `/teams/${userTeamId}`, label: 'Points' });
      }
      navItems.push(
        { href: `/teams/${userTeamId}/transfers`, label: 'Transfers' },
        { href: `/teams/${userTeamId}/lineup`, label: 'Lineup' }
      );
    } else {
      // Roster incomplete - only show Buy Players
      navItems.push(
        { href: `/teams/${userTeamId}/transfers`, label: 'Buy Players' }
      );
    }
  }

  // Add general navigation (Leagues hidden until roster is complete, hidden during Setup)
  if (currentWeek !== 'Setup' && (!userTeamId || teamRosterComplete)) {
    navItems.push({ href: '/leagues', label: 'Leagues' });
  }
  navItems.push({ href: '/players', label: 'Player Stats' });

  // Admin menu items (separate from main nav)
  const adminItems = [
    { href: '/admin/settings', label: 'Season Roll Forward' },
    { href: '/admin/season', label: 'Season Setup' },
    { href: '/admin/scoring', label: 'Scoring Rules' },
    { href: '/admin/starting-prices', label: 'Starting Prices' },
    { href: '/players/prices', label: 'Price Changes' },
    { href: '/admin/deadlines', label: 'Deadlines' },
    { href: '/teams', label: 'All Teams' }
  ];

  return (
    <nav className="shadow-lg border-b border-gray-200">
      {/* Top bar - User info */}
      <div className="bg-primary-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-end h-8 items-center">
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-300">
                  Welcome, <span className="font-semibold text-white">{user.username}</span>
                </span>
                <button onClick={handleLogout} className="text-sm text-gray-300 hover:text-white cursor-pointer">
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login" className="text-sm text-gray-300 hover:text-white">
                  Login
                </Link>
                <span className="text-gray-500">|</span>
                <Link href="/register" className="text-sm text-gray-300 hover:text-white">
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main navigation bar */}
      <div className="bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 justify-between">
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
              <div className="hidden sm:ml-8 sm:flex sm:space-x-8 items-center">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors h-full
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

                {/* Admin dropdown menu - inline with nav items */}
                {user?.role === 'admin' && (
                  <div className="relative flex items-center h-full">
                    <button
                      onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                      className={`inline-flex items-center gap-1 px-1 pt-1 border-b-2 text-sm font-medium transition-colors h-full
                        ${adminMenuOpen || adminItems.some(item => pathname === item.href)
                          ? 'border-primary-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                        }
                      `}
                    >
                      Admin
                      <svg className={`w-4 h-4 transition-transform ${adminMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Dropdown menu */}
                    {adminMenuOpen && (
                      <>
                        {/* Backdrop to close menu when clicking outside */}
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setAdminMenuOpen(false)}
                        />
                        <div className="absolute left-0 top-full mt-0 w-48 bg-white rounded-md shadow-lg border border-gray-200 z-20">
                          <div className="py-1">
                            {adminItems.map((item) => (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setAdminMenuOpen(false)}
                                className={`block px-4 py-2 text-sm transition-colors
                                  ${pathname === item.href
                                    ? 'bg-primary-50 text-primary-700'
                                    : 'text-gray-700 hover:bg-gray-100'
                                  }
                                `}
                              >
                                {item.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right side - Year/Week/Day controls */}
            <div className="flex items-center">
              {user?.role === 'admin' ? (
                <div className="flex items-center gap-4">
                  {/* Year Display (read-only — change via Admin Settings page) */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Year:</span>
                    <span className="px-2 py-1 text-sm font-semibold text-gray-900">
                      {currentYear || '...'}
                    </span>
                  </div>

                  {/* Week Selector */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Week:</span>
                    <select
                      value={currentWeek || ''}
                      onChange={(e) => handleWeekChange(e.target.value)}
                      disabled={isUpdating || currentWeek === null}
                      className="px-2 py-1 border border-gray-300 rounded text-sm font-semibold focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
                    >
                      {currentWeek === null ? (
                        <option value="">...</option>
                      ) : (
                        <>
                          <option value="Setup">Setup</option>
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
                    <span className="text-xs text-gray-500">Day:</span>
                    <select
                      value={currentDay || ''}
                      onChange={(e) => handleDayChange(e.target.value)}
                      disabled={isUpdating || currentDay === null}
                      className="px-2 py-1 border border-gray-300 rounded text-sm font-semibold focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
                    >
                      {currentDay === null ? (
                        <option value="">...</option>
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
                  {currentWeek === 'Setup' ? 'Setup' : currentWeek === 'Preseason' ? 'Preseason' : `Week ${currentWeek}`}
                  {currentWeek !== 'Preseason' && currentWeek !== 'Setup' && currentDay && ` - Day ${currentDay}`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
