import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { NAV } from '../lib/nav';

export default function Layout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const items = NAV.filter((n) => can(n.module, 'read'));

  const getFormattedRole = (type?: string) => {
    if (!type) return '';
    switch (type) {
      case 'super_admin':
        return 'Super Admin';
      case 'admin':
        return 'Admin';
      case 'doctor':
        return 'Doctor';
      default:
        return type.replace(/_/g, ' ');
    }
  };

  const getRoleIcon = (type?: string) => {
    switch (type) {
      case 'super_admin':
        return '';
      case 'doctor':
        return '';
      default:
        return '';
    }
  };

  const renderUserInfo = () => {
    if (!user) return null;
    const roleLabel = getFormattedRole(user.type);
    const nameLabel = user.name?.trim() || '';
    const icon = getRoleIcon(user.type);

    const isDuplicate =
      !nameLabel ||
      nameLabel.toLowerCase().replace(/[\s_]/g, '') ===
      roleLabel.toLowerCase().replace(/[\s_]/g, '');

    return (
      <div className="user-profile-badge">
        <span className="user-icon" aria-hidden>{icon}</span>
        {isDuplicate ? (
          <span className="user-role-title">{roleLabel}</span>
        ) : (
          <span className="user-role-title">
            <span className="user-name">{nameLabel}</span>
            <span className="user-sep">·</span>
            <span className="user-role">{roleLabel}</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="app-shell">
      {drawerOpen && (
        <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />
      )}
      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">+</span> OPD Admin
        </div>
        {items.map((n) => (
          <NavLink
            key={n.path}
            to={n.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span aria-hidden>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
        {user?.type === 'doctor' && (
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span aria-hidden>🧑‍⚕️</span>
            My profile
          </NavLink>
        )}
        <div className="spacer" />
        <button
          className="btn btn-logout"
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          Sign out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="hamburger"
            aria-label="Menu"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="who">
            {renderUserInfo()}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
