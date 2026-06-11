"use client"

import { useState } from "react"
import { useTransactions } from "@/lib/transaction-store"
import { Transaction, TransactionType, TransactionContact, ContactRole } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Rocket } from "lucide-react"

// ─── Options ──────────────────────────────────────────────────────────────────
const PROPERTY_CHAR_OPTIONS = [
  "Detached",
  "Attached or Semi-Attached",
  "Ground Rent",
  "HOA/Condo",
  "Water & Sewer Facilities Charge",
  "Leased Items-Propane Tank, Solar, Batteries, Etc",
  "Other",
]

const PAPERWORK_OPTIONS = [
  "DotLoop Paperwork",
  "Moxi Presentation",
  "CMA Assistance",
  "DotLoop is already started and Robert has a Team Invite to the Loop",
  "I need an Offer Completed",
]

// fileType → TransactionType
const FILE_TYPE_MAP: Record<string, TransactionType> = {
  "Buyer File":    "buyer",
  "Seller File":   "seller",
  "Landlord File": "rental",
  "Tenant File":   "tenant",
}

// fileType → client contact roles
const ROLE_MAP: Record<string, [ContactRole, ContactRole]> = {
  "Buyer File":    ["buyer1",    "buyer2"],
  "Seller File":   ["seller1",   "seller2"],
  "Landlord File": ["landlord1", "landlord2"],
  "Tenant File":   ["tenant1",   "tenant2"],
}

// ─── Checkbox group ───────────────────────────────────────────────────────────
function CheckGroup({
  label,
  options,
  selected,
  onChange,
  otherValue,
  onOtherChange,
  idPrefix,
  required,
  error,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  otherValue: string
  onOtherChange: (v: string) => void
  idPrefix: string
  required?: boolean
  error?: string
}) {
  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter(x => x !== opt) : [...selected, opt])
  const hasOther = selected.includes("Other")

  return (
    <div>
      <Label className="text-xs text-gray-600 mb-2 block">
        {label}
        {required
          ? <span className="text-red-500 ml-0.5">*</span>
          : <span className="text-gray-400 font-normal ml-1">(optional)</span>}
      </Label>
      <div className="space-y-2 pl-1">
        {options.map(opt => (
          <div key={opt}>
            <div className="flex items-start gap-2.5">
              <Checkbox
                id={`${idPrefix}-${opt}`}
                checked={selected.includes(opt)}
                onCheckedChange={() => toggle(opt)}
                className="mt-0.5 border-[#012169] data-[state=checked]:bg-[#012169] data-[state=checked]:border-[#012169]"
              />
              <label
                htmlFor={`${idPrefix}-${opt}`}
                className="text-sm text-gray-700 cursor-pointer select-none leading-snug"
              >
                {opt}
              </label>
            </div>
            {opt === "Other" && hasOther && (
              <Input
                className="mt-2 ml-7 h-8 text-sm w-[calc(100%-1.75rem)]"
                placeholder="Please specify…"
                value={otherValue}
                onChange={e => onOtherChange(e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────
export function NewTransactionDialog() {
  const { addTransaction } = useTransactions()
  const [open, setOpen] = useState(false)

  // Phase I fields
  const [teamMemberName, setTeamMemberName] = useState("")
  const [fileType,       setFileType]       = useState("")
  const [c1Name,  setC1Name]  = useState("")
  const [c1Email, setC1Email] = useState("")
  const [c1Phone, setC1Phone] = useState("")
  const [address, setAddress] = useState("")
  const [c2Name,  setC2Name]  = useState("")
  const [c2Email, setC2Email] = useState("")
  const [c2Phone, setC2Phone] = useState("")
  const [propChars,     setPropChars]     = useState<string[]>([])
  const [propCharsOther, setPropCharsOther] = useState("")
  const [paperwork,     setPaperwork]     = useState<string[]>([])
  const [agentRemarks,  setAgentRemarks]  = useState("")

  const [errors, setErrors] = useState<Record<string, string>>({})

  const reset = () => {
    setTeamMemberName(""); setFileType("")
    setC1Name(""); setC1Email(""); setC1Phone("")
    setAddress("")
    setC2Name(""); setC2Email(""); setC2Phone("")
    setPropChars([]); setPropCharsOther("")
    setPaperwork([]); setAgentRemarks("")
    setErrors({})
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!teamMemberName.trim()) e.teamMemberName = "Required"
    if (!fileType)              e.fileType       = "Required"
    if (!c1Name.trim())         e.c1Name         = "Required"
    if (!c1Email.trim())        e.c1Email        = "Required"
    if (!c1Phone.trim())        e.c1Phone        = "Required"
    if (paperwork.length === 0) e.paperwork      = "Select at least one"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleLaunch = () => {
    if (!validate()) return

    const txnId = `txn-${Date.now()}`
    const roles  = ROLE_MAP[fileType] ?? ["buyer1", "buyer2"]

    const contacts: TransactionContact[] = [
      { id: `${txnId}-c0`, name: c1Name.trim(), email: c1Email.trim(), phone: c1Phone.trim(), role: roles[0] },
    ]
    if (c2Name.trim()) {
      contacts.push({ id: `${txnId}-c1`, name: c2Name.trim(), email: c2Email.trim(), phone: c2Phone.trim(), role: roles[1] })
    }

    const txn: Transaction = {
      id:            txnId,
      phase:         1,
      status:        "active",
      type:          FILE_TYPE_MAP[fileType] ?? "buyer",
      createdAt:     new Date().toISOString(),
      teamMemberName: teamMemberName.trim(),
      fileType,
      client1Name:   c1Name.trim(),
      client1Email:  c1Email.trim(),
      client1Phone:  c1Phone.trim(),
      address:       address.trim() || "Address TBD",
      client2Name:   c2Name.trim()  || undefined,
      client2Email:  c2Email.trim() || undefined,
      client2Phone:  c2Phone.trim() || undefined,
      propertyCharacteristics:      propChars.length ? propChars : undefined,
      propertyCharacteristicsOther: propCharsOther   || undefined,
      paperworkItems: paperwork,
      agentRemarks:   agentRemarks.trim() || undefined,
      // Legacy mirrors
      mlsNumber:  teamMemberName.trim(),
      listPrice:  0,
      contacts,
      tasks: [],
    }

    addTransaction(txn)
    setOpen(false)
    reset()
  }

  const err = (k: string) =>
    errors[k] ? <p className="text-xs text-red-500 mt-0.5">{errors[k]}</p> : null

  return (
    <>
      <Button
        onClick={() => { reset(); setOpen(true) }}
        className="bg-[#012169] hover:bg-[#418FDE] text-white gap-2"
      >
        <Rocket className="h-4 w-4" />
        Launch
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v) }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#012169] text-lg flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Launch New Transaction — Phase I
            </DialogTitle>
            <p className="text-sm text-gray-500 mt-0.5">
              Complete the fields below to open a new file.
            </p>
          </DialogHeader>

          <div className="space-y-5 py-1">

            {/* ── Team Member + File Type ─────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">
                  Team Member Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="Agent name"
                  value={teamMemberName}
                  onChange={e => setTeamMemberName(e.target.value)}
                  className={errors.teamMemberName ? "border-red-400" : ""}
                />
                {err("teamMemberName")}
              </div>
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">
                  File Type <span className="text-red-500">*</span>
                </Label>
                <Select value={fileType} onValueChange={setFileType}>
                  <SelectTrigger className={errors.fileType ? "border-red-400" : ""}>
                    <SelectValue placeholder="Select type…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Buyer File">Buyer File</SelectItem>
                    <SelectItem value="Seller File">Seller File</SelectItem>
                    <SelectItem value="Landlord File">Landlord File</SelectItem>
                    <SelectItem value="Tenant File">Tenant File</SelectItem>
                  </SelectContent>
                </Select>
                {err("fileType")}
              </div>
            </div>

            <Separator />

            {/* ── Client 1 ────────────────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                Client 1 <span className="text-red-500">*</span>
              </p>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">Full Name *</Label>
                  <Input
                    placeholder="John Smith"
                    value={c1Name}
                    onChange={e => setC1Name(e.target.value)}
                    className={errors.c1Name ? "border-red-400" : ""}
                  />
                  {err("c1Name")}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Email *</Label>
                    <Input
                      type="email"
                      placeholder="john@email.com"
                      value={c1Email}
                      onChange={e => setC1Email(e.target.value)}
                      className={errors.c1Email ? "border-red-400" : ""}
                    />
                    {err("c1Email")}
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Phone *</Label>
                    <Input
                      placeholder="410-555-0100"
                      value={c1Phone}
                      onChange={e => setC1Phone(e.target.value)}
                      className={errors.c1Phone ? "border-red-400" : ""}
                    />
                    {err("c1Phone")}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* ── Subject Property ─────────────────────────────────────── */}
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">
                Subject Property Address <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Input
                placeholder="1234 Maple Drive, Columbia, MD 21044"
                value={address}
                onChange={e => setAddress(e.target.value)}
              />
            </div>

            <Separator />

            {/* ── Client 2 ────────────────────────────────────────────── */}
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                Client 2 <span className="text-gray-300 font-normal normal-case tracking-normal text-xs">(optional)</span>
              </p>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">Full Name</Label>
                  <Input
                    placeholder="Jane Smith"
                    value={c2Name}
                    onChange={e => setC2Name(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Email</Label>
                    <Input
                      type="email"
                      placeholder="jane@email.com"
                      value={c2Email}
                      onChange={e => setC2Email(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Phone</Label>
                    <Input
                      placeholder="410-555-0101"
                      value={c2Phone}
                      onChange={e => setC2Phone(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* ── Property Characteristics ─────────────────────────────── */}
            <CheckGroup
              label="A Little About the Subject Property — Select All That Apply"
              options={PROPERTY_CHAR_OPTIONS}
              selected={propChars}
              onChange={setPropChars}
              otherValue={propCharsOther}
              onOtherChange={setPropCharsOther}
              idPrefix="prop"
            />

            <Separator />

            {/* ── Paperwork Preparation ────────────────────────────────── */}
            <CheckGroup
              label="Paperwork Preparation — Select All That Apply"
              options={PAPERWORK_OPTIONS}
              selected={paperwork}
              onChange={setPaperwork}
              otherValue=""
              onOtherChange={() => {}}
              idPrefix="paper"
              required
              error={errors.paperwork}
            />

            <Separator />

            {/* ── Agent Remarks ─────────────────────────────────────────── */}
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">
                Agent Remarks <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Textarea
                placeholder="Any additional notes for the team…"
                value={agentRemarks}
                onChange={e => setAgentRemarks(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>

          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => { reset(); setOpen(false) }}>
              Cancel
            </Button>
            <Button
              onClick={handleLaunch}
              className="bg-[#012169] hover:bg-[#418FDE] text-white gap-2"
            >
              <Rocket className="h-4 w-4" />
              Launch File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
