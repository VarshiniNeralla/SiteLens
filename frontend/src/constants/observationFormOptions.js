/** Canonical labels for QA analytics — edit only via product change requests. */

export const PROJECT_NAMES = ['Grava', 'Apas', 'Udyan']

export const TOWERS = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
  'T11',
  'T12',
]

export const FLOORS = Array.from({ length: 40 }, (_, i) => String(i + 1))

export const FLATS = ['1', '2', '3', '4']

export const ROOMS = [
  'Lobby',
  'Hall',
  'Kitchen',
  'Drawing Room',
  'Master Bedroom',
  'Bedroom',
  'Bedroom 1',
  'Bedroom 2',
  'Bedroom 3',
  'Bathroom',
  'Balcony',
  'Utility Area',
  'Dining Area',
  'Passage',
  'Staircase',
  'Lift Lobby',
  'Terrace',
  'Parking',
  'Store Room',
  'Dressing Room',
]

export const OBSERVATION_TYPES = [
  'Honeycombing',
  'Joints',
  'Cracks',
  'Seepage',
  'Uneven Surface',
  'Reinforcement Exposure',
  'Alignment Issue',
  'Finishing Defect',
  'Leakage',
  'Void Formation',
  'Concrete Damage',
  'Plaster Damage',
]

export const SEVERITIES = ['Minor', 'Moderate', 'Major', 'Critical']

export const INSPECTION_STATUSES = ['Yet to be Confirmed', 'Pending', 'In Progress', 'Completed']

export const THIRD_PARTY_INSPECTION_STATUSES = ['Yet to be Confirmed', 'Pending', 'Approved', 'Rejected']
