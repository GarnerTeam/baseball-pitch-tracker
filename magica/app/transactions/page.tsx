"use client"

export const dynamic = "force-dynamic"

import { useState, useMemo, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTransactions } from "@/lib/transaction-store"
import { Transaction } from "@/types"
import { NewTransactionDialog } from "@/components/new-transaction-dialog"
import { EditTransactionDialog } from "@/components/edit-transaction-dialog"
import { formatCurrency, formatDate, getDaysUntil, getPhaseColor, PHASES, STATUS_LABELS } from "@/lib/data"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, ChevronUp, ChevronDown, Trash2, AlertTriangle, Lock } from "lucide-react"
import { cn } from "@/lib/utils"

// ─── Admin PIN ────────────────────────────────────────────────────────────────
const ADMIN_PIN = "3577"

const STATUS_STYLES: Record<string, string> = {
  active:        "bg-emerald-100 text-emerald-800",
  pending_close: "bg-amber-100 text-amber-800",
  closed:        "bg-gray-100 text-gray-600",
  withdrawn:     "bg-red-100 text-red-800",
}

type SortKey = "address" | "phase" | "listPrice" | "closingDate" | "status"

// ─── PIN Gate Dialog ──────────────────────────────────────────────────────────
function PinGateDialog({
  open,
  onSuccess,
  onCancel,
}: {
  open: boolean
  onSuccess: () => void
  onCancel: () => void
}) {
  const [pin,   setPin]   = useState("")
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input whenever dialog opens; reset state on close
  useEffect(() => {
    if (open) {
      setPin("")
      setError(false)
      setShake(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleSubmit = () => {
    if (pin === ADMIN_PIN) {
      setPin("")
      setError(false)
      onSuccess()
    } else {
      setError(true)
      setShake(true)
      setPin("")
      setTimeout(() => setShake(false), 500)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit()
    if (e.key === "Escape") { onCancel(); setPin("") }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onCancel(); setPin("") } }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-[#012169]/10 flex items-center justify-center flex-shrink-0">
              <Lock className="h-5 w-5 text-[#012169]" />
            </div>
            <DialogTitle className="text-[#2D2926]">Admin PIN Required</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-gray-500 pl-[3.25rem]">
            Enter your 4-digit PIN to delete this transaction.
          </DialogDescription>
        </DialogHeader>

        <div className={cn("px-1 transition-all", shake && "animate-[shake_0.4s_ease-in-out]")}>
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 4)
              setPin(val)
              setError(false)
            }}
            onKeyDown={handleKey}
            className={cn(
              "text-center text-xl tracking-[0.5em] font-bold h-12",
              error ? "border-red-400 focus-visible:ring-red-300" : "border-gray-200"
            )}
          />
          {error && (
            <p className="text-xs text-red-500 text-center mt-1.5">Incorrect PIN — try again</p>
          )}
        </div>

        <DialogFooter className="gap-2 pt-1">
          <Button variant="outline" onClick={() => { onCancel(); setPin("") }}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={pin.length !== 4}
            className="bg-[#012169] hover:bg-[#418FDE] text-white"
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete Confirmation Dialog ───────────────────────────────────────────────
function DeleteConfirmDialog({
  transaction,
  open,
  onCancel,
  onConfirm,
}: {
  transaction: Transaction | null
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!transaction) return null
  const clientName = transaction.contacts[0]?.name ?? ""

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <DialogTitle className="text-[#2D2926]">Delete Transaction?</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-gray-600 leading-relaxed pl-[3.25rem]">
            You are about to permanently delete:
            <span className="block mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
              <span className="font-semibold text-[#2D2926] block">{transaction.address}</span>
              {clientName && <span className="text-gray-500 text-xs">{clientName}</span>}
            </span>
            <span className="block mt-3 font-medium text-red-600">
              This cannot be undone. All tasks, contacts, and notes will be lost.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            Yes, Delete Transaction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { transactions, deleteTransaction } = useTransactions()
  const router = useRouter()
  const [search,       setSearch]       = useState("")
  const [sortKey,      setSortKey]      = useState<SortKey>("phase")
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("asc")
  const [pinTarget,    setPinTarget]    = useState<Transaction | null>(null)   // waiting for PIN
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)  // passed PIN, confirm delete

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    const list = transactions.filter(
      (t) =>
        t.address.toLowerCase().includes(q) ||
        t.mlsNumber.toLowerCase().includes(q) ||
        t.contacts.some((c) => c.name.toLowerCase().includes(q))
    )
    return [...list].sort((a, b) => {
      let av: string | number = ""
      let bv: string | number = ""
      if (sortKey === "address")     { av = a.address;                  bv = b.address }
      if (sortKey === "phase")       { av = a.phase;                    bv = b.phase }
      if (sortKey === "listPrice")   { av = a.salePrice ?? a.listPrice; bv = b.salePrice ?? b.listPrice }
      if (sortKey === "closingDate") { av = a.closingDate ?? "";        bv = b.closingDate ?? "" }
      if (sortKey === "status")      { av = a.status;                   bv = b.status }
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1  : -1
      return 0
    })
  }, [transactions, search, sortKey, sortDir])

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col
      ? sortDir === "asc"
        ? <ChevronUp   className="h-3 w-3 inline ml-1" />
        : <ChevronDown className="h-3 w-3 inline ml-1" />
      : null

  // PIN passed → move transaction to delete-confirm stage
  const handlePinSuccess = () => {
    setDeleteTarget(pinTarget)
    setPinTarget(null)
  }

  const handleDeleteConfirm = () => {
    if (deleteTarget) {
      deleteTransaction(deleteTarget.id)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#2D2926]">All Transactions</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {transactions.length} total · {transactions.filter(t => t.status === "active" || t.status === "pending_close").length} active
          </p>
        </div>
        <NewTransactionDialog />
      </div>

      {/* Search */}
      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="p-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search by address, team member, or client name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 border-0 bg-transparent focus-visible:ring-0 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="text-xs font-semibold text-gray-500 cursor-pointer select-none" onClick={() => toggleSort("address")}>
                Property <SortIcon col="address" />
              </TableHead>
              <TableHead className="text-xs font-semibold text-gray-500">Type</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 cursor-pointer select-none" onClick={() => toggleSort("phase")}>
                Phase <SortIcon col="phase" />
              </TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 cursor-pointer select-none" onClick={() => toggleSort("status")}>
                Status <SortIcon col="status" />
              </TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 cursor-pointer select-none text-right" onClick={() => toggleSort("listPrice")}>
                Price <SortIcon col="listPrice" />
              </TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 cursor-pointer select-none" onClick={() => toggleSort("closingDate")}>
                Closing <SortIcon col="closingDate" />
              </TableHead>
              <TableHead className="text-xs font-semibold text-gray-500">Tasks</TableHead>
              <TableHead className="text-xs font-semibold text-gray-500 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((txn) => {
              const phaseColor  = getPhaseColor(txn.phase)
              const done        = txn.tasks.filter((t) => t.completed).length
              const total       = txn.tasks.length
              const pct         = total > 0 ? Math.round((done / total) * 100) : 0
              const daysToClose = txn.closingDate ? getDaysUntil(txn.closingDate) : null
              const client      = txn.contacts.find(
                (c) => ["buyer","seller","buyer1","seller1","tenant1","landlord1"].includes(c.role)
              )

              return (
                <TableRow
                  key={txn.id}
                  className="hover:bg-blue-50/40 transition-colors cursor-pointer group"
                  onClick={() => router.push(`/transactions/${txn.id}`)}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium text-[#012169] text-sm leading-snug group-hover:underline">
                        {txn.address}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {txn.mlsNumber}
                        {client && <span className="ml-2 text-gray-500">{client.name}</span>}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                      txn.type === "buyer"  ? "bg-blue-50 text-blue-700"     :
                      txn.type === "seller" ? "bg-purple-50 text-purple-700" :
                      txn.type === "rental" ? "bg-amber-50 text-amber-700"   :
                                              "bg-teal-50 text-teal-700"
                    )}>
                      {{ buyer:"Buyer", seller:"Seller", rental:"Rental", tenant:"Tenant" }[txn.type]}
                    </span>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: phaseColor }}
                      >
                        {["I","II","III","IV","V"][txn.phase - 1]}
                      </span>
                      <span className="text-xs text-gray-600 hidden lg:block">
                        {PHASES[txn.phase - 1].shortName}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", STATUS_STYLES[txn.status])}>
                      {STATUS_LABELS[txn.status]}
                    </span>
                  </TableCell>

                  <TableCell className="text-right">
                    <p className="font-semibold text-sm text-[#2D2926]">
                      {formatCurrency(txn.salePrice ?? txn.listPrice)}
                    </p>
                    {txn.salePrice && txn.salePrice !== txn.listPrice && (
                      <p className="text-xs text-gray-400 line-through">{formatCurrency(txn.listPrice)}</p>
                    )}
                  </TableCell>

                  <TableCell>
                    {txn.closingDate && daysToClose !== null ? (
                      <div>
                        <p className="text-xs text-gray-600">{formatDate(txn.closingDate)}</p>
                        <p className={cn(
                          "text-[10px] font-medium",
                          daysToClose < 0   ? "text-gray-400"  :
                          daysToClose <= 7  ? "text-red-500"   :
                          daysToClose <= 14 ? "text-amber-500" : "text-gray-400"
                        )}>
                          {daysToClose < 0 ? "Passed" : daysToClose === 0 ? "TODAY" : `${daysToClose}d away`}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: phaseColor }} />
                      </div>
                      <span className="text-[10px] text-gray-400">{pct}%</span>
                    </div>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      <EditTransactionDialog transaction={txn} />
                      <button
                        onClick={() => setPinTarget(txn)}
                        className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Delete transaction"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-gray-400 text-sm">
                  No transactions match your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Step 1 — PIN gate */}
      <PinGateDialog
        open={!!pinTarget}
        onSuccess={handlePinSuccess}
        onCancel={() => setPinTarget(null)}
      />

      {/* Step 2 — Delete confirmation (only reached after correct PIN) */}
      <DeleteConfirmDialog
        transaction={deleteTarget}
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
