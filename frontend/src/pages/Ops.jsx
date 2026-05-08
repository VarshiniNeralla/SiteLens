import { useEffect, useState } from 'react'
import { getOpsHealth, getOpsJobs } from '../api.js'
import { ButtonSecondary } from '../components/ui/Button.jsx'

export function OpsPage() {
  const [health, setHealth] = useState(null)
  const [jobs, setJobs] = useState([])
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [h, j] = await Promise.all([getOpsHealth(), getOpsJobs()])
      setHealth(h)
      setJobs(j.jobs || [])
    } catch (e) {
      setError(e.message || 'Unable to load operations monitor')
    }
  }

  useEffect(() => {
    const bootId = setTimeout(() => {
      void load()
    }, 0)
    const id = setInterval(() => void load(), 5000)
    return () => {
      clearTimeout(bootId)
      clearInterval(id)
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Operations Monitor</h2>
        <ButtonSecondary onClick={() => void load()}>Refresh</ButtonSecondary>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
        <p className="text-sm font-medium">Health</p>
        <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(health, null, 2)}</pre>
      </div>
      <div className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
        <p className="text-sm font-medium">Active / Recent Jobs</p>
        <pre className="mt-2 max-h-[340px] overflow-auto text-xs">{JSON.stringify(jobs, null, 2)}</pre>
      </div>
    </div>
  )
}
