import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import Dashboard from './pages/Dashboard';
import RunDetail from './pages/RunDetail';
import Reports from './pages/Reports';
import Monitoring from './pages/Monitoring';
import MonitorDetail from './pages/MonitorDetail';
import Navigation from './components/Navigation';

export const SocketContext = createContext(null);

export function useSocket() {
  return useContext(SocketContext);
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const s = io(window.location.origin, {
      transports: ['websocket', 'polling']
    });
    
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    
    setSocket(s);
    return () => s.disconnect();
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      <div className="min-h-screen bg-[#0f1117]">
        <Navigation connected={connected} />
        <main className="pt-16">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/run/:runId" element={<RunDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/monitoring/:monitorId" element={<MonitorDetail />} />
          </Routes>
        </main>
      </div>
    </SocketContext.Provider>
  );
}
