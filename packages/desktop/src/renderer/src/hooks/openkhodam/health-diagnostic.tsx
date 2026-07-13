import { useOpenKhodamClient } from './client'

export function OpenKhodamHealthDiagnostic() {
  const { health } = useOpenKhodamClient()
  return <span data-openkhodam-health={health} hidden />
}
