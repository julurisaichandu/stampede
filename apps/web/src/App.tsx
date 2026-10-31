import { PermitStatus, emptyPermit, missingMinimum } from '../../api/contracts.ts'

export default function App() {
  const permit = emptyPermit('probe')
  return <pre id="probe">{JSON.stringify({ first: PermitStatus.options[0], missing: missingMinimum(permit) })}</pre>
}
