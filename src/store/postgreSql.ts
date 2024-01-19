import { create } from "zustand"

import { PostgreSQLConnection } from "@/lib/types"

const usePostgreSqlStore = create<{
  connections: PostgreSQLConnection[]
  setConnections: (connections: PostgreSQLConnection[]) => void
  addConnection: (connection: PostgreSQLConnection) => void
  updateConnection: (updatedConnection: PostgreSQLConnection) => void
  deleteConnection: (connectionId: number) => void
}>((set) => ({
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
