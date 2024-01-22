import { ColumnDef } from "@tanstack/react-table"
import React from "react"

type Props<T> = { customColumns: ColumnDef<T>[] }

// Bu fonksiyon, genel bir tür parametresi olan T'yi alır ve ColumnDef türündeki bir dizi döndürür.
export function createColumns<T extends object>({ customColumns }: Props<T>): ColumnDef<T>[] {
  return customColumns
}
