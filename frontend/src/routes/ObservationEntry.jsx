import { useLocation } from 'react-router-dom'
import { ObservationPage } from '../pages/Observation.jsx'

/** Fresh form when navigation entry changes (e.g. returning from Upload with a new image). */
export function ObservationEntry() {
  const loc = useLocation()
  return <ObservationPage key={loc.key} />
}
