import { create } from "zustand"

import { QueryResult } from "@/lib/types"

const usePostgreSqlQueryStore = create<{
  query: string
  setQuery: (query: string) => void
  queryResult: QueryResult | undefined
  setQueryResult: (queryResult: QueryResult | undefined) => void
}>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
  queryResult: undefined,
  setQueryResult: (queryResult: QueryResult | undefined) => set({ queryResult }),
}))

export default usePostgreSqlQueryStore
