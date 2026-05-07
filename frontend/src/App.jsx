import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell.jsx'
import { ReportsPage } from './pages/Reports.jsx'
import { WorkspacePage } from './pages/Workspace.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<WorkspacePage />} />
          <Route path="/upload" element={<WorkspacePage />} />
          <Route path="/observations/new" element={<WorkspacePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
