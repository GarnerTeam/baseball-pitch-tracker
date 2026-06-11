"use client"

import { useState, useMemo } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  PHASES, ROLE_LABELS, STATUS_LABELS,
  formatCurrency, formatDate, getDaysUntil, getPhaseColor,
} from "@/lib/data"
import { Transaction, TransactionContact, ContactRole, UserRole, Task, PhaseNumber } from "@/types"
import { PhaseStepper } from "@/components/phase-stepper"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  ArrowLeft, Calendar, CheckCircle, Clock,
  Phone, Mail, Hash, MapPin, AlertCircle, FileText,
  Pencil, X, Check, Trash2, UserPlus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { EditTransactionDialog } from "@/components/edit-transaction-dialog"
import { useTransactions } from "@/lib/transaction-store"

// ─── Role colour palette ──────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  // Legacy
  buyer:       "bg-blue-100 text-blue-800",
  seller:      "bg-purple-100 text-purple-800",
  coop_agent:  "bg-orange-100 text-orange-800",
  lender:      "bg-green-100 text-green-800",
  title:       "bg-teal-100 text-teal-800",
  tc:          "bg-[#012169]/10 text-[#012169]",
  agent:       "bg-[#012169]/10 text-[#012169]",
  // Client
  buyer1:      "bg-blue-100 text-blue-800",
  buyer2:      "bg-blue-50 text-blue-700",
  seller1:     "bg-purple-100 text-purple-800",
  seller2:     "bg-purple-50 text-purple-700",
  landlord1:   "bg-amber-100 text-amber-800",
  landlord2:   "bg-amber-50 text-amber-700",
  tenant1:     "bg-teal-100 text-teal-800",
  tenant2:     "bg-teal-50 text-teal-700",
  // Agent
  listing_agent: "bg-[#012169]/10 text-[#012169]",
  buyers_agent:  "bg-indigo-100 text-indigo-800",
  // Lender
  loan_officer:   "bg-green-100 text-green-800",
  loan_processor: "bg-emerald-100 text-emerald-800",
  // Settlement / Title
  settlement_officer: "bg-cyan-100 text-cyan-800",
  title_processor:    "bg-teal-100 text-teal-800",
  // Transaction Admin
  ta_list:       "bg-orange-100 text-orange-800",
  ta_buy_tenant: "bg-rose-100 text-rose-800",
  // Inspection / Appraisal
  home_inspector: "bg-slate-100 text-slate-700",
  appraiser:      "bg-gray-100 text-gray-700",
}

const STATUS_STYLES: Record<string, string> = {
  active:        "bg-emerald-100 text-emerald-800",
  pending_close: "bg-amber-100 text-amber-800",
  closed:        "bg-gray-100 text-gray-600",
  withdrawn:     "bg-red-100 text-red-800",
}

// ─── Role dropdown options (grouped) ─────────────────────────────────────────
const ROLE_OPTION_GROUPS: { label: string; options: { value: ContactRole; label: string }[] }[] = [
  {
    label: "Client",
    options: [
      { value: "buyer1",    label: "Buyer 1"    },
      { value: "seller1",   label: "Seller 1"   },
      { value: "landlord1", label: "Landlord 1" },
      { value: "tenant1",   label: "Tenant 1"   },
      { value: "buyer2",    label: "Buyer 2"    },
      { value: "seller2",   label: "Seller 2"   },
      { value: "landlord2", label: "Landlord 2" },
      { value: "tenant2",   label: "Tenant 2"   },
    ],
  },
  {
    label: "Agent",
    options: [
      { value: "listing_agent", label: "Listing Agent"  },
      { value: "buyers_agent",  label: "Buyer's Agent"  },
    ],
  },
  {
    label: "Lender",
    options: [
      { value: "loan_officer",   label: "Loan Officer"   },
      { value: "loan_processor", label: "Loan Processor" },
    ],
  },
  {
    label: "Settlement / Title",
    options: [
      { value: "settlement_officer", label: "Settlement Officer" },
      { value: "title_processor",    label: "Title Processor"    },
    ],
  },
  {
    label: "Transaction Admin",
    options: [
      { value: "ta_list",       label: "T/A List"       },
      { value: "ta_buy_tenant", label: "T/A Buy/Tenant" },
    ],
  },
  {
    label: "Inspection / Appraisal",
    options: [
      { value: "home_inspector", label: "Home Inspector" },
      { value: "appraiser",      label: "Appraiser"      },
    ],
  },
]

// ─── Role-specific task filter ────────────────────────────────────────────────
function getVisibleTasks(tasks: Task[], role: UserRole, currentPhase: PhaseNumber) {
  if (role === "tc") return tasks
  if (role === "client") {
    return tasks.filter(
      (t) => t.phase === currentPhase || (t.phase === (currentPhase + 1 as PhaseNumber) && !t.completed)
    )
  }
  return tasks.filter((t) => t.phase === currentPhase || t.priority === "high")
}

// ─── Phase summary messages ───────────────────────────────────────────────────
const PHASE_CLIENT_MSG: Record<number, { heading: string; body: string }> = {
  1: { heading: "We're getting started!", body: "We're preparing your listing or buyer consultation. Our team is setting everything up to get you to market quickly." },
  2: { heading: "Offer stage — let's negotiate!", body: "We're working on your offer. Our job is to get you the best terms possible. We'll keep you posted on every response." },
  3: { heading: "Under contract — working through contingencies", body: "Great news — you have an accepted contract! Now we're navigating inspections, appraisal, and financing. Stay close, we may need a few things from you." },
  4: { heading: "Almost there — settlement is near!", body: "All contingencies are cleared. We're heading to the closing table! Keep an eye on your email for the closing disclosure and final numbers." },
  5: { heading: "Congratulations — you did it!", body: "Settlement is complete. Thank you for trusting the Garner Team. We'll check in soon — and we'd love a review if you have a moment!" },
}

// ─── Role Select (shared by ContactCard and AddContactCard) ──────────────────
function RoleSelect({ value, onChange }: { value: ContactRole; onChange: (v: ContactRole) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ContactRole)}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder="Select role…" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {ROLE_OPTION_GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              {group.label}
            </SelectLabel>
            {group.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── Contact Card (view + inline edit + delete) ───────────────────────────────
interface ContactCardProps {
  contact: TransactionContact
  canEdit: boolean
  onSave: (updated: TransactionContact) => void
  onDelete: (id: string) => void
}

function ContactCard({ contact, canEdit, onSave, onDelete }: ContactCardProps) {
  const [editing, setEditing] = useState(false)
  const [name,  setName]  = useState(contact.name)
  const [email, setEmail] = useState(contact.email)
  const [phone, setPhone] = useState(contact.phone)
  const [role,  setRole]  = useState<ContactRole>(contact.role)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSave = () => {
    if (!name.trim()) return
    onSave({ ...contact, name: name.trim(), email: email.trim(), phone: phone.trim(), role })
    setEditing(false)
  }

  const handleCancel = () => {
    setName(contact.name)
    setEmail(contact.email)
    setPhone(contact.phone)
    setRole(contact.role)
    setEditing(false)
  }

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(contact.id)
    } else {
      setConfirmDelete(true)
      // auto-reset after 3 s if no second click
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  const initials = contact.name.split(" ").map((n) => n[0]).slice(0, 2).join("")
  const roleLabel = ROLE_LABELS[contact.role] ?? contact.role
  const roleColor = ROLE_COLORS[contact.role] ?? "bg-gray-100 text-gray-600"

  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        {editing ? (
          <div className="space-y-3">
            {/* Header row: role badge + save/cancel */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Edit Contact</p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSave}
                  className="p-1.5 rounded-md bg-[#012169] text-white hover:bg-[#418FDE] transition-colors"
                  title="Save"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleCancel}
                  className="p-1.5 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {/* Role */}
            <div>
              <Label className="text-[10px] text-gray-500 mb-1 block">Role</Label>
              <RoleSelect value={role} onChange={setRole} />
            </div>
            {/* Name */}
            <div>
              <Label className="text-[10px] text-gray-500 mb-1 block">Full Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-sm"
                placeholder="Full name"
              />
            </div>
            {/* Email + Phone */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <Label className="text-[10px] text-gray-500 mb-1 block">Phone</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="410-555-0100"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-gray-500">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-[#2D2926] text-sm leading-snug">{contact.name}</p>
                {/* Controls */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", roleColor)}>
                    {roleLabel}
                  </span>
                  {canEdit && (
                    <>
                      <button
                        onClick={() => setEditing(true)}
                        className="p-1 rounded-md text-gray-400 hover:text-[#012169] hover:bg-[#012169]/8 transition-colors"
                        title="Edit contact"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={handleDeleteClick}
                        className={cn(
                          "p-1 rounded-md transition-colors",
                          confirmDelete
                            ? "bg-red-100 text-red-600 hover:bg-red-200"
                            : "text-gray-300 hover:text-red-500 hover:bg-red-50"
                        )}
                        title={confirmDelete ? "Click again to confirm delete" : "Delete contact"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <a
                  href={`mailto:${contact.email}`}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#012169] transition-colors"
                >
                  <Mail className="h-3 w-3" />
                  {contact.email || <span className="text-gray-300 italic">No email on file</span>}
                </a>
                <a
                  href={`tel:${contact.phone}`}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#012169] transition-colors"
                >
                  <Phone className="h-3 w-3" />
                  {contact.phone || <span className="text-gray-300 italic">No phone on file</span>}
                </a>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Add Contact Card ─────────────────────────────────────────────────────────
interface AddContactCardProps {
  transactionId: string
  onSave: (contact: TransactionContact) => void
  onCancel: () => void
}

function AddContactCard({ transactionId, onSave, onCancel }: AddContactCardProps) {
  const [name,  setName]  = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [role,  setRole]  = useState<ContactRole>("buyer1")
  const [nameError, setNameError] = useState(false)

  const handleSave = () => {
    if (!name.trim()) { setNameError(true); return }
    onSave({
      id:    `${transactionId}-c${Date.now()}`,
      name:  name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      role,
    })
  }

  return (
    <Card className="border-2 border-dashed border-[#012169]/25 shadow-none col-span-1 md:col-span-2">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-[#012169] uppercase tracking-widest flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              New Contact
            </p>
            <button
              onClick={onCancel}
              className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Role */}
            <div className="md:col-span-2">
              <Label className="text-[10px] text-gray-500 mb-1 block">Role</Label>
              <RoleSelect value={role} onChange={setRole} />
            </div>
            {/* Name */}
            <div className="md:col-span-2">
              <Label className="text-[10px] text-gray-500 mb-1 block">Full Name *</Label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setNameError(false) }}
                className={cn("h-8 text-sm", nameError && "border-red-400")}
                placeholder="Full name"
              />
              {nameError && <p className="text-xs text-red-500 mt-0.5">Name is required</p>}
            </div>
            {/* Email */}
            <div>
              <Label className="text-[10px] text-gray-500 mb-1 block">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-8 text-sm"
                placeholder="email@example.com"
              />
            </div>
            {/* Phone */}
            <div>
              <Label className="text-[10px] text-gray-500 mb-1 block">Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-8 text-sm"
                placeholder="410-555-0100"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSave}
              className="bg-[#012169] hover:bg-[#418FDE] text-white gap-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Add Contact
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TransactionDetailClient() {
  const params = useParams()
  const id = (params?.id ?? "") as string
  const { transactions, updateTransaction } = useTransactions()

  const transaction = transactions.find((t) => t.id === id) ?? null
  const [role, setRole] = useState<UserRole>("tc")
  const [addingContact, setAddingContact] = useState(false)

  if (!transaction) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">Transaction not found.</p>
        <Link href="/" className="text-[#012169] hover:underline text-sm mt-2 inline-block">
          ← Back to Dashboard
        </Link>
      </div>
    )
  }

  const phaseColor = getPhaseColor(transaction.phase)
  const daysToClose = transaction.closingDate ? getDaysUntil(transaction.closingDate) : null
  const visibleTasks = getVisibleTasks(transaction.tasks, role, transaction.phase)

  const tasksByPhase = useMemo(() => {
    const map: Partial<Record<PhaseNumber, Task[]>> = {}
    for (const task of visibleTasks) {
      if (!map[task.phase]) map[task.phase] = []
      map[task.phase]!.push(task)
    }
    return map
  }, [visibleTasks])

  const completedAll = transaction.tasks.filter((t) => t.completed).length
  const totalAll = transaction.tasks.length
  const overallProgress = totalAll > 0 ? Math.round((completedAll / totalAll) * 100) : 0

  const toggleTask = (taskId: string) => {
    updateTransaction(transaction.id, {
      tasks: transaction.tasks.map((t) =>
        t.id === taskId ? { ...t, completed: !t.completed } : t
      ),
    })
  }

  // ── Contact handlers ──
  const handleContactSave = (updated: TransactionContact) => {
    updateTransaction(transaction.id, {
      contacts: transaction.contacts.map((c) => (c.id === updated.id ? updated : c)),
    })
  }

  const handleContactDelete = (contactId: string) => {
    updateTransaction(transaction.id, {
      contacts: transaction.contacts.filter((c) => c.id !== contactId),
    })
  }

  const handleContactAdd = (newContact: TransactionContact) => {
    updateTransaction(transaction.id, {
      contacts: [...transaction.contacts, newContact],
    })
    setAddingContact(false)
  }

  // Contacts visible per role view
  const visibleContacts = transaction.contacts.filter((c) => {
    if (role === "tc") return true
    if (role === "client") return ["agent", "listing_agent", "buyers_agent", "tc", "loan_officer", "settlement_officer", "title_processor"].includes(c.role)
    if (role === "coop_agent") return ["agent", "listing_agent", "buyers_agent", "tc"].includes(c.role)
    return true
  })

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Back + Edit */}
      <div className="flex items-center justify-between mb-4">
        <Link
          href="/transactions"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#012169] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All Transactions
        </Link>
        <EditTransactionDialog transaction={transaction} />
      </div>

      {/* Header card */}
      <Card className="border-0 shadow-sm mb-4 overflow-hidden">
        <div className="h-1.5 w-full" style={{ backgroundColor: phaseColor }} />
        <CardContent className="p-5">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", STATUS_STYLES[transaction.status])}>
                  {STATUS_LABELS[transaction.status]}
                </span>
                <span className={cn(
                  "text-xs font-semibold px-2.5 py-1 rounded-full",
                  transaction.type === "buyer"  ? "bg-blue-50 text-blue-700"   :
                  transaction.type === "seller" ? "bg-purple-50 text-purple-700" :
                  transaction.type === "rental" ? "bg-amber-50 text-amber-700"  :
                  "bg-teal-50 text-teal-700"
                )}>
                  {transaction.type === "buyer"  ? "Buyer Side"  :
                   transaction.type === "seller" ? "Seller Side" :
                   transaction.type === "rental" ? "Rental Side" : "Tenant Side"}
                </span>
              </div>
              <div className="flex items-start gap-2 mb-1">
                <MapPin className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <h1 className="text-xl font-bold text-[#2D2926] leading-snug">{transaction.address}</h1>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-500 ml-6">
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {transaction.mlsNumber}
                </span>
                <span className="font-bold text-[#2D2926] text-base">
                  {transaction.salePrice
                    ? formatCurrency(transaction.salePrice)
                    : formatCurrency(transaction.listPrice)}
                </span>
                {transaction.salePrice && transaction.salePrice !== transaction.listPrice && (
                  <span className="line-through text-gray-400 text-sm">{formatCurrency(transaction.listPrice)}</span>
                )}
              </div>
            </div>

            {/* Key date callout */}
            {transaction.closingDate && daysToClose !== null && (
              <div className={cn(
                "text-center px-5 py-3 rounded-xl border-2",
                daysToClose <= 7  ? "border-red-200 bg-red-50"    :
                daysToClose <= 14 ? "border-amber-200 bg-amber-50" :
                "border-gray-100 bg-gray-50"
              )}>
                <p className={cn("text-2xl font-bold",
                  daysToClose <= 7 ? "text-red-600" : daysToClose <= 14 ? "text-amber-600" : "text-[#012169]"
                )}>
                  {daysToClose < 0 ? "Past" : daysToClose === 0 ? "Today" : daysToClose}
                </p>
                <p className="text-xs text-gray-500 font-medium">
                  {daysToClose > 0 ? "days to closing" : "Closing date"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(transaction.closingDate)}</p>
              </div>
            )}
          </div>

          {/* Overall progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-gray-500">Overall Progress</span>
              <span className="font-semibold text-gray-700">{completedAll}/{totalAll} tasks · {overallProgress}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${overallProgress}%`, backgroundColor: phaseColor }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Phase Stepper */}
      <Card className="border-0 shadow-sm mb-4">
        <CardContent className="py-5 px-6">
          <PhaseStepper currentPhase={transaction.phase} />
        </CardContent>
      </Card>

      {/* Role toggle */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-500 font-medium">Viewing as:</span>
        {(["tc", "client", "coop_agent"] as UserRole[]).map((r) => {
          const labels: Record<UserRole, string> = {
            tc: "TC / Staff",
            client: "Client",
            coop_agent: "Coop Agent",
          }
          return (
            <button
              key={r}
              onClick={() => { setRole(r); setAddingContact(false) }}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                role === r
                  ? "bg-[#012169] text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-[#012169]/40"
              )}
            >
              {labels[r]}
            </button>
          )
        })}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-white border border-gray-100 shadow-sm mb-4 p-1">
          <TabsTrigger value="overview"  className="text-xs data-[state=active]:bg-[#012169] data-[state=active]:text-white">Overview</TabsTrigger>
          <TabsTrigger value="tasks"     className="text-xs data-[state=active]:bg-[#012169] data-[state=active]:text-white">
            Tasks ({visibleTasks.filter((t) => !t.completed).length} open)
          </TabsTrigger>
          <TabsTrigger value="contacts"  className="text-xs data-[state=active]:bg-[#012169] data-[state=active]:text-white">
            Contacts ({transaction.contacts.length})
          </TabsTrigger>
          <TabsTrigger value="dates"     className="text-xs data-[state=active]:bg-[#012169] data-[state=active]:text-white">Key Dates</TabsTrigger>
        </TabsList>

        {/* ─── OVERVIEW ─── */}
        <TabsContent value="overview">
          <div className="space-y-4">
            {role === "client" && (
              <Card className="border-0 shadow-sm" style={{ borderLeft: `4px solid ${phaseColor}` }}>
                <CardContent className="p-5">
                  <p className="font-bold text-[#2D2926] mb-1">{PHASE_CLIENT_MSG[transaction.phase].heading}</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{PHASE_CLIENT_MSG[transaction.phase].body}</p>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-gray-600">Current Phase</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: phaseColor }}>
                      {["I", "II", "III", "IV", "V"][transaction.phase - 1]}
                    </div>
                    <div>
                      <p className="font-semibold text-[#2D2926] text-sm">{PHASES[transaction.phase - 1].name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{PHASES[transaction.phase - 1].description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-gray-600">
                    {role === "client" ? "Your Next Steps" : "Upcoming Tasks"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4 space-y-2">
                  {visibleTasks.filter((t) => !t.completed).slice(0, 4).map((task) => (
                    <div key={task.id} className="flex items-start gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#012169] mt-1.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-gray-700">{task.title}</span>
                        {task.dueDate && (
                          <span className={cn("ml-2 font-medium", getDaysUntil(task.dueDate) <= 3 ? "text-red-500" : "text-gray-400")}>
                            Due {formatDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                      {task.priority === "high" && <AlertCircle className="h-3 w-3 text-red-400 flex-shrink-0" />}
                    </div>
                  ))}
                  {visibleTasks.filter((t) => !t.completed).length === 0 && (
                    <p className="text-xs text-gray-400">All tasks complete! 🎉</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {role === "tc" && transaction.notes && (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-semibold text-gray-600 flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Internal Notes
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <p className="text-sm text-gray-600 leading-relaxed">{transaction.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ─── TASKS ─── */}
        <TabsContent value="tasks">
          <div className="space-y-4">
            {role === "client" && (
              <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5">
                Showing tasks for your current phase and next steps. Your TC manages the full checklist behind the scenes.
              </p>
            )}
            {(Object.keys(tasksByPhase) as unknown as PhaseNumber[])
              .map(Number).sort((a, b) => a - b)
              .map((phaseNum) => {
                const phaseTasks = tasksByPhase[phaseNum as PhaseNumber] ?? []
                const completed = phaseTasks.filter((t) => t.completed).length
                const pc = getPhaseColor(phaseNum)
                return (
                  <Card key={phaseNum} className="border-0 shadow-sm overflow-hidden">
                    <div className="h-0.5 w-full" style={{ backgroundColor: pc }} />
                    <CardHeader className="py-3 px-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded text-white text-[10px] font-bold flex items-center justify-center" style={{ backgroundColor: pc }}>
                            {["I", "II", "III", "IV", "V"][phaseNum - 1]}
                          </span>
                          <span className="text-sm font-semibold text-[#2D2926]">{PHASES[phaseNum - 1].name}</span>
                        </div>
                        <span className="text-xs text-gray-400">{completed}/{phaseTasks.length} done</span>
                      </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 space-y-2">
                      {phaseTasks.map((task) => (
                        <div
                          key={task.id}
                          className={cn(
                            "flex items-start gap-3 p-2.5 rounded-lg transition-colors",
                            task.completed ? "bg-gray-50" : "bg-white hover:bg-gray-50",
                          )}
                        >
                          <button
                            onClick={() => role === "tc" && toggleTask(task.id)}
                            className={cn(
                              "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all",
                              task.completed ? "border-transparent" : "border-gray-300",
                              role === "tc" && !task.completed && "hover:border-[#012169] cursor-pointer",
                              role !== "tc" && "cursor-default"
                            )}
                            style={task.completed ? { backgroundColor: pc, borderColor: pc } : {}}
                          >
                            {task.completed && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm leading-snug", task.completed ? "line-through text-gray-400" : "text-gray-700")}>
                              {task.title}
                            </p>
                            {task.dueDate && !task.completed && (
                              <p className={cn(
                                "text-xs mt-0.5 flex items-center gap-1",
                                getDaysUntil(task.dueDate) <= 0 ? "text-red-500 font-medium" :
                                getDaysUntil(task.dueDate) <= 3 ? "text-amber-500" : "text-gray-400"
                              )}>
                                <Clock className="h-3 w-3" />
                                Due {formatDate(task.dueDate)}
                                {getDaysUntil(task.dueDate) <= 0 && " — OVERDUE"}
                              </p>
                            )}
                          </div>
                          {task.priority === "high" && !task.completed && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 uppercase tracking-wide flex-shrink-0">
                              High
                            </span>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )
              })}
          </div>
        </TabsContent>

        {/* ─── CONTACTS ─── */}
        <TabsContent value="contacts">
          {/* TC/Staff hint banner */}
          {role === "tc" && (
            <div className="flex items-center gap-3 text-xs text-gray-500 bg-[#012169]/5 border border-[#012169]/10 rounded-lg px-4 py-2.5 mb-3">
              <Pencil className="h-3.5 w-3.5 text-[#012169] flex-shrink-0" />
              <span>
                TC / Staff — <strong>pencil</strong> to edit name, email, phone &amp; role &nbsp;·&nbsp;
                <strong>trash</strong> to remove (click twice to confirm) &nbsp;·&nbsp;
                <strong>Add Contact</strong> below to create a new entry
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleContacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                canEdit={role === "tc"}
                onSave={handleContactSave}
                onDelete={handleContactDelete}
              />
            ))}

            {/* Add Contact form card */}
            {role === "tc" && addingContact && (
              <AddContactCard
                transactionId={transaction.id}
                onSave={handleContactAdd}
                onCancel={() => setAddingContact(false)}
              />
            )}

            {visibleContacts.length === 0 && !addingContact && (
              <p className="text-sm text-gray-400 col-span-2 py-8 text-center">
                No contacts to display for this view.
              </p>
            )}
          </div>

          {/* Add Contact button */}
          {role === "tc" && !addingContact && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddingContact(true)}
                className="gap-2 border-[#012169]/30 text-[#012169] hover:bg-[#012169] hover:text-white"
              >
                <UserPlus className="h-4 w-4" />
                Add Contact
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── KEY DATES ─── */}
        <TabsContent value="dates">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="space-y-0">
                {[
                  { label: "Contract Date",       value: transaction.contractDate,       icon: FileText    },
                  { label: "Inspection Deadline",  value: transaction.inspectionDeadline, icon: AlertCircle },
                  { label: "Financing Deadline",   value: transaction.financingDeadline,  icon: CheckCircle },
                  { label: "Closing / Settlement", value: transaction.closingDate,        icon: Calendar    },
                ].map((item, idx) => {
                  if (!item.value) return null
                  const days    = getDaysUntil(item.value)
                  const isPast  = days < 0
                  const isUrgent = days >= 0 && days <= 7
                  const Icon = item.icon
                  return (
                    <div key={idx} className={cn("flex items-center gap-4 py-4", idx > 0 && "border-t border-gray-50")}>
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                        isPast ? "bg-gray-100" : isUrgent ? "bg-red-50" : "bg-[#012169]/8"
                      )}>
                        <Icon className={cn("h-4 w-4", isPast ? "text-gray-400" : isUrgent ? "text-red-500" : "text-[#012169]")} />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 font-medium">{item.label}</p>
                        <p className="text-sm font-semibold text-[#2D2926]">{formatDate(item.value)}</p>
                      </div>
                      <div className="text-right">
                        {isPast ? (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Passed</span>
                        ) : days === 0 ? (
                          <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full">TODAY</span>
                        ) : (
                          <span className={cn(
                            "text-xs font-semibold px-2 py-1 rounded-full",
                            isUrgent ? "bg-red-50 text-red-600" : days <= 14 ? "bg-amber-50 text-amber-600" : "bg-[#012169]/8 text-[#012169]"
                          )}>
                            {days}d away
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
