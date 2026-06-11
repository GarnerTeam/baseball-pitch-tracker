"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { Transaction } from "@/types"

const STORAGE_KEY = "garner-team-transactions"

// ── Helpers ───────────────────────────────────────────────────────────────────
function load(): Transaction[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Transaction[]) : []
  } catch {
    return []
  }
}

function save(list: Transaction[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    console.warn("[Store] localStorage write failed")
  }
}

// ── Store interface ───────────────────────────────────────────────────────────
interface Store {
  transactions: Transaction[]
  loading: boolean
  addTransaction:    (txn: Transaction) => void
  updateTransaction: (id: string, updates: Partial<Transaction>) => void
  deleteTransaction: (id: string) => void
}

const Ctx = createContext<Store | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────
export function TransactionProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading,      setLoading]      = useState(true)

  // Load on mount (browser only)
  useEffect(() => {
    setTransactions(load())
    setLoading(false)
  }, [])

  // Persist on every change
  useEffect(() => {
    if (!loading) save(transactions)
  }, [transactions, loading])

  const addTransaction = (txn: Transaction) => {
    setTransactions((prev) => [txn, ...prev])
  }

  const updateTransaction = (id: string, updates: Partial<Transaction>) => {
    setTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    )
  }

  const deleteTransaction = (id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <Ctx.Provider value={{ transactions, loading, addTransaction, updateTransaction, deleteTransaction }}>
      {children}
    </Ctx.Provider>
  )
}

export function useTransactions() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useTransactions must be used inside TransactionProvider")
  return ctx
}
