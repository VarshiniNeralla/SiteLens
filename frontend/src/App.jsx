import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell.jsx'
import { HomePage } from './pages/Home.jsx'
import { ObservationEntry } from './routes/ObservationEntry.jsx'
import { ReportsPage } from './pages/Reports.jsx'
import { UploadPage } from './pages/Upload.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/observations/new" element={<ObservationEntry />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
