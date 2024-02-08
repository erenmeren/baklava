import { create } from "zustand"

import { DatabaseSchema, PostgreSQLConnection } from "@/lib/types"

const usePostgreSqlConnectionStore = create<{
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

export default usePostgreSqlConnectionStore
