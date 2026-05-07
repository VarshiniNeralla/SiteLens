import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell.jsx'
import { LandingPage } from './pages/Landing.jsx'
import { ReportsPage } from './pages/Reports.jsx'
import { WorkspacePage } from './pages/Workspace.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<Shell />}>
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/capture/upload" element={<WorkspacePage />} />
          <Route path="/capture/observations" element={<WorkspacePage />} />
          <Route path="/output/reports" element={<ReportsPage />} />
          {/* Backward compatibility redirects */}
          <Route path="/upload" element={<Navigate to="/capture/upload" replace />} />
          <Route path="/observations/new" element={<Navigate to="/capture/observations" replace />} />
          <Route path="/reports" element={<Navigate to="/output/reports" replace />} />
          <Route path="*" element={<Navigate to="/workspace" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
