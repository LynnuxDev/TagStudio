import { createContext, useContext, type ReactNode } from 'react'
import { useApi } from './useApi'

type Api = ReturnType<typeof useApi>

const ApiContext = createContext<Api | null>(null)

export function ApiProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  return (
    <ApiContext.Provider value={api}>
      {children}
    </ApiContext.Provider>
  )
}

export function useApiContext(): Api {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('useApiContext must be used within ApiProvider')
  return ctx
}
