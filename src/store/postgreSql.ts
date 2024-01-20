import { create } from "zustand"

import { DatabaseSchema, PostgreSQLConnection, QueryResult } from "@/lib/types"

const usePostgreSqlStore = create<{
  query: string
  setQuery: (query: string) => void
  queryResult: QueryResult | undefined
  setQueryResult: (queryResult: QueryResult | undefined) => void
  schemas: DatabaseSchema[] | []
  setSchemas: (schemas: DatabaseSchema[]) => void
  connectionId: number | null
  setConnectionId: (connectionId: number | null) => void
  connections: PostgreSQLConnection[]
  setConnections: (connections: PostgreSQLConnection[]) => void
  addConnection: (connection: PostgreSQLConnection) => void
  updateConnection: (updatedConnection: PostgreSQLConnection) => void
  deleteConnection: (connectionId: number) => void
}>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
  queryResult: undefined,
  setQueryResult: (queryResult: QueryResult | undefined) => set({ queryResult }),
  connectionId: null,
  setConnectionId: (connectionId) => set({ connectionId }),
  schemas: [],
  setSchemas: (schemas) => set({ schemas }),
  connections: [],
  setConnections: (connections) => set({ connections }),
  addConnection: (connection) =>
    set((state) => ({
      connections: [...state.connections, connection],
    })),
  updateConnection: (updatedConnection) =>
    set((state) => ({
      connections: state.connections.map((connection) =>
        connection.id === updatedConnection.id ? updatedConnection : connection
      ),
    })),
  deleteConnection: (connectionId: number) =>
    set((state) => ({
      connections: state.connections.filter((connection) => connection.id !== connectionId),
    })),
}))

export default usePostgreSqlStore
