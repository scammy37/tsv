import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import WarmupNotice from './components/WarmupNotice';

import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import HomeownerDashboard from './pages/HomeownerDashboard';
import ManagementDashboard from './pages/ManagementDashboard';
import NewTicket from './pages/NewTicket';
import TicketDetail from './pages/TicketDetail';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';
import Home from './pages/Home';

const STAFF = ['staff', 'management'];

// "/" means different things to the two audiences: a homeowner sees their own
// requests, staff see the triage queue.
function Dashboard() {
  const { isStaff } = useAuth();
  return isStaff ? <ManagementDashboard /> : <HomeownerDashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <WarmupNotice />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* The front door is public: a resident who has never signed in still
              needs to find out who the association is and how to file a request. */}
          <Route path="/" element={<Home />} />

          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/tickets" element={<Navigate to="/dashboard" replace />} />
          <Route path="/tickets/new" element={<ProtectedRoute><NewTicket /></ProtectedRoute>} />
          <Route path="/tickets/:id" element={<ProtectedRoute><TicketDetail /></ProtectedRoute>} />

          <Route path="/reports" element={
            <ProtectedRoute roles={STAFF}><Reports /></ProtectedRoute>
          } />
          <Route path="/users" element={
            <ProtectedRoute roles={['management']}><Users /></ProtectedRoute>
          } />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

          {/* Not behind ProtectedRoute: the site has a public front door, so a
              stranger on a bad URL must get "no such page", not a login form.
              NotFound renders the signed-in or signed-out version itself. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
