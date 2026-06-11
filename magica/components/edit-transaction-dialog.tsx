"use client"

import { useState } from "react"
import { useTransactions } from "@/lib/transaction-store"
import { Transaction, TransactionType, PhaseNumber, ContactRole } from "@/types"
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
import { Pencil } from "lucide-react"

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

const FINANCING_OPTIONS  = ["Cash", "Conventional", "FHA", "VA", "Other"]

const INSPECTION_OPTIONS = [
  "Structural/Mechanical",
  "Mold",
  "Environmental",
  "Radon",
  "Chimney",
  "Lead Based Paint",
  "Other",
]

const PHASE_ITEMS: { value: PhaseNumber; label: string }[] = [
  { value: 1, label: "Phase I — Interview to Active"                },
  { value: 2, label: "Phase II — Offer / Compromise"                },
  { value: 3, label: "Phase III — Acceptance to Contingency Release" },
  { value: 4, label: "Phase IV — Settlement"                         },
  { value: 5, label: "Phase V — Post Closing / Follow Up"            },
]

// fileType → TransactionType
const FILE_TYPE_MAP: Record<string, TransactionType> = {
  "Buyer File":    "buyer",
  "Seller File":   "seller",
  "Landlord File": "rental",
  "Tenant File":   "tenant",
}

// fileType → contact roles
const ROLE_MAP: Record<string, [ContactRole, ContactRole]> = {
  "Buyer File":    ["buyer1",    "buyer2"],
  "Seller File":   ["seller1",   "seller2"],
  "Landlord File": ["landlord1", "landlord2"],
  "Tenant File":   ["tenant1",   "tenant2"],
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function SectionHead({ children, tag }: { children: React.ReactNode; tag?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{children}</p>
      {tag && (
        <span className="text-[10px] font-semibold text-[#012169] bg-[#012169]/8 px-2 py-0.5 rounded-full">
          {tag}
        </span>
      )}
    </div>
  )
}

function CheckGroup({
  options,
  selected,
  onChange,
  otherValue,
  onOtherChange,
  idPrefix,
}: {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  otherValue: string
  onOtherChange: (v: string) => void
  idPrefix: string
}) {
  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter(x => x !== opt) : [...selected, opt])
  const hasOther = selected.includes("Other")

  return (
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
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  transaction: Transaction
  onUpdated?: () => void
}

export function EditTransactionDialog({ transaction, onUpdated }: Props) {
  const { updateTransaction } = useTransactions()
  const [open, setOpen] = useState(false)

  // Phase selector
  const [selectedPhase, setSelectedPhase] = useState<PhaseNumber>(transaction.phase)

  // Phase I
  const [teamMemberName,      setTeamMemberName]      = useState(transaction.teamMemberName ?? transaction.mlsNumber ?? "")
  const [fileType,             setFileType]            = useState(transaction.fileType ?? "")
  const [c1Name,               setC1Name]              = useState(transaction.client1Name ?? transaction.contacts[0]?.name  ?? "")
  const [c1Email,              setC1Email]             = useState(transaction.client1Email ?? transaction.contacts[0]?.email ?? "")
  const [c1Phone,              setC1Phone]             = useState(transaction.client1Phone ?? transaction.contacts[0]?.phone ?? "")
  const [address,              setAddress]             = useState(transaction.address === "Address TBD" ? "" : transaction.address)
  const [c2Name,               setC2Name]              = useState(transaction.client2Name  ?? transaction.contacts[1]?.name  ?? "")
  const [c2Email,              setC2Email]             = useState(transaction.client2Email ?? transaction.contacts[1]?.email ?? "")
  const [c2Phone,              setC2Phone]             = useState(transaction.client2Phone ?? transaction.contacts[1]?.phone ?? "")
  const [propChars,            setPropChars]           = useState<string[]>(transaction.propertyCharacteristics ?? [])
  const [propCharsOther,       setPropCharsOther]      = useState(transaction.propertyCharacteristicsOther ?? "")
  const [paperwork,            setPaperwork]           = useState<string[]>(transaction.paperworkItems ?? [])
  const [agentRemarks,         setAgentRemarks]        = useState(transaction.agentRemarks ?? "")

  // Phase II
  const [offerPrice,           setOfferPrice]          = useState(transaction.offerPrice    ? String(transaction.offerPrice)    : "")
  const [earnestMoney,         setEarnestMoney]        = useState(transaction.earnestMoney  ? String(transaction.earnestMoney)  : "")
  const [settlementDate,       setSettlementDate]      = useState(transaction.settlementDate ?? transaction.closingDate ?? "")
  const [sellerConcession,     setSellerConcession]    = useState(transaction.sellerConcession ? String(transaction.sellerConcession) : "")
  const [financingTypes,       setFinancingTypes]      = useState<string[]>(transaction.financingTypes ?? [])
  const [financingTypeOther,   setFinancingTypeOther]  = useState(transaction.financingTypeOther ?? "")
  const [inclusions,           setInclusions]          = useState(transaction.inclusions ?? "")
  const [homeWarranty,         setHomeWarranty]        = useState(transaction.homeWarranty ?? "")
  const [propInspections,      setPropInspections]     = useState<string[]>(transaction.propertyInspections ?? [])
  const [inspectionsOther,     setInspectionsOther]    = useState(transaction.propertyInspectionsOther ?? "")
  const [additionalInfo,       setAdditionalInfo]      = useState(transaction.additionalInfo ?? "")
  const [escrowCompany,        setEscrowCompany]       = useState(transaction.escrowCompany ?? "")
  const [inspectionDays,       setInspectionDays]      = useState(transaction.inspectionDays ? String(transaction.inspectionDays) : "")
  const [agentEmail,           setAgentEmail]          = useState(transaction.agentEmail ?? "")
  const [noteToClient,         setNoteToClient]        = useState(transaction.noteToClient ?? "")
  const [noteToCoop,           setNoteToCoop]          = useState(transaction.noteToCoop ?? "")

  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Re-sync when dialog opens ──
  const handleOpen = () => {
    setSelectedPhase(transaction.phase)
    setTeamMemberName(transaction.teamMemberName ?? transaction.mlsNumber ?? "")
    setFileType(transaction.fileType ?? "")
    setC1Name(transaction.client1Name  ?? transaction.contacts[0]?.name  ?? "")
    setC1Email(transaction.client1Email ?? transaction.contacts[0]?.email ?? "")
    setC1Phone(transaction.client1Phone ?? transaction.contacts[0]?.phone ?? "")
    setAddress(transaction.address === "Address TBD" ? "" : transaction.address)
    setC2Name(transaction.client2Name  ?? transaction.contacts[1]?.name  ?? "")
    setC2Email(transaction.client2Email ?? transaction.contacts[1]?.email ?? "")
    setC2Phone(transaction.client2Phone ?? transaction.contacts[1]?.phone ?? "")
    setPropChars(transaction.propertyCharacteristics ?? [])
    setPropCharsOther(transaction.propertyCharacteristicsOther ?? "")
    setPaperwork(transaction.paperworkItems ?? [])
    setAgentRemarks(transaction.agentRemarks ?? "")
    setOfferPrice(transaction.offerPrice    ? String(transaction.offerPrice)    : "")
    setEarnestMoney(transaction.earnestMoney ? String(transaction.earnestMoney) : "")
    setSettlementDate(transaction.settlementDate ?? transaction.closingDate ?? "")
    setSellerConcession(transaction.sellerConcession ? String(transaction.sellerConcession) : "")
    setFinancingTypes(transaction.financingTypes ?? [])
    setFinancingTypeOther(transaction.financingTypeOther ?? "")
    setInclusions(transaction.inclusions ?? "")
    setHomeWarranty(transaction.homeWarranty ?? "")
    setPropInspections(transaction.propertyInspections ?? [])
    setInspectionsOther(transaction.propertyInspectionsOther ?? "")
    setAdditionalInfo(transaction.additionalInfo ?? "")
    setEscrowCompany(transaction.escrowCompany ?? "")
    setInspectionDays(transaction.inspectionDays ? String(transaction.inspectionDays) : "")
    setAgentEmail(transaction.agentEmail ?? "")
    setNoteToClient(transaction.noteToClient ?? "")
    setNoteToCoop(transaction.noteToCoop ?? "")
    setErrors({})
    setOpen(true)
  }

  // ── Validation ──
  const validate = () => {
    const e: Record<string, string> = {}
    if (!teamMemberName.trim()) e.teamMemberName = "Required"
    if (!c1Name.trim())         e.c1Name         = "Required"
    if (!c1Email.trim())        e.c1Email         = "Required"
    if (!c1Phone.trim())        e.c1Phone         = "Required"
    if (selectedPhase >= 2 && !agentEmail.trim()) e.agentEmail = "Required"
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Save ──
  const handleSave = () => {
    if (!validate()) return

    const resolvedFileType = fileType || transaction.fileType || "Buyer File"
    const roles = ROLE_MAP[resolvedFileType] ?? ["buyer1", "buyer2"]

    const contacts = [
      {
        id:    transaction.contacts[0]?.id ?? `${transaction.id}-c0`,
        name:  c1Name.trim(),
        email: c1Email.trim(),
        phone: c1Phone.trim(),
        role:  (transaction.contacts[0]?.role ?? roles[0]) as ContactRole,
      },
    ]
    if (c2Name.trim()) {
      contacts.push({
        id:    transaction.contacts[1]?.id ?? `${transaction.id}-c1`,
        name:  c2Name.trim(),
        email: c2Email.trim(),
        phone: c2Phone.trim(),
        role:  (transaction.contacts[1]?.role ?? roles[1]) as ContactRole,
      })
    }

    updateTransaction(transaction.id, {
      phase:         selectedPhase,
      status:        selectedPhase >= 4 ? "pending_close" : transaction.status,
      type:          FILE_TYPE_MAP[resolvedFileType] ?? transaction.type,
      teamMemberName: teamMemberName.trim(),
      fileType:      resolvedFileType,
      mlsNumber:     teamMemberName.trim(),
      client1Name:   c1Name.trim(),
      client1Email:  c1Email.trim(),
      client1Phone:  c1Phone.trim(),
      address:       address.trim() || "Address TBD",
      client2Name:   c2Name.trim()  || undefined,
      client2Email:  c2Email.trim() || undefined,
      client2Phone:  c2Phone.trim() || undefined,
      propertyCharacteristics:      propChars.length ? propChars : undefined,
      propertyCharacteristicsOther: propCharsOther || undefined,
      paperworkItems: paperwork.length ? paperwork : undefined,
      agentRemarks:   agentRemarks.trim() || undefined,
      // Phase II
      offerPrice:        selectedPhase >= 2 && offerPrice       ? Number(offerPrice)       : undefined,
      earnestMoney:      selectedPhase >= 2 && earnestMoney     ? Number(earnestMoney)     : undefined,
      settlementDate:    selectedPhase >= 2 ? (settlementDate   || undefined) : undefined,
      closingDate:       selectedPhase >= 2 ? (settlementDate   || undefined) : undefined,
      sellerConcession:  selectedPhase >= 2 && sellerConcession ? Number(sellerConcession) : undefined,
      financingTypes:    selectedPhase >= 2 ? (financingTypes.length  ? financingTypes  : undefined) : undefined,
      financingTypeOther: selectedPhase >= 2 ? (financingTypeOther   || undefined) : undefined,
      inclusions:        selectedPhase >= 2 ? (inclusions.trim()     || undefined) : undefined,
      homeWarranty:      selectedPhase >= 2 ? (homeWarranty.trim()   || undefined) : undefined,
      propertyInspections:      selectedPhase >= 2 ? (propInspections.length ? propInspections : undefined) : undefined,
      propertyInspectionsOther: selectedPhase >= 2 ? (inspectionsOther || undefined) : undefined,
      additionalInfo:    selectedPhase >= 2 ? (additionalInfo.trim() || undefined) : undefined,
      escrowCompany:     selectedPhase >= 2 ? (escrowCompany.trim()  || undefined) : undefined,
      inspectionDays:    selectedPhase >= 2 && inspectionDays ? Number(inspectionDays) : undefined,
      agentEmail:        selectedPhase >= 2 ? (agentEmail.trim()     || undefined) : undefined,
      noteToClient:      selectedPhase >= 2 ? (noteToClient.trim()   || undefined) : undefined,
      noteToCoop:        selectedPhase >= 2 ? (noteToCoop.trim()     || undefined) : undefined,
      contacts,
    })

    setOpen(false)
    onUpdated?.()
  }

  const err = (k: string) =>
    errors[k] ? <p className="text-xs text-red-500 mt-0.5">{errors[k]}</p> : null

  const phaseRoman = ["I", "II", "III", "IV", "V"][selectedPhase - 1]

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleOpen}
        className="gap-1.5 border-[#012169] text-[#012169] hover:bg-[#012169] hover:text-white"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[#012169] text-lg">
              Edit Transaction — Phase {phaseRoman}
            </DialogTitle>
            <p className="text-sm text-gray-500 mt-0.5">{transaction.address}</p>
          </DialogHeader>

          <div className="space-y-5 py-1">

            {/* ── Phase Selector ─────────────────────────────────────── */}
            <div className="bg-[#012169]/5 border border-[#012169]/15 rounded-xl p-4">
              <Label className="text-xs font-semibold text-[#012169] mb-2 block uppercase tracking-wider">
                Transaction Phase
              </Label>
              <Select
                value={String(selectedPhase)}
                onValueChange={v => setSelectedPhase(Number(v) as PhaseNumber)}
              >
                <SelectTrigger className="bg-white border-[#012169]/20 focus:ring-[#012169]/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHASE_ITEMS.map(({ value, label }) => (
                    <SelectItem key={value} value={String(value)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-gray-400 mt-2">
                Advancing the phase unlocks additional data entry fields.
              </p>
            </div>

            <Separator />

            {/* ══ PHASE I ════════════════════════════════════════════════ */}

            {/* Team Member + File Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">Team Member Name *</Label>
                <Input
                  value={teamMemberName}
                  onChange={e => setTeamMemberName(e.target.value)}
                  className={errors.teamMemberName ? "border-red-400" : ""}
                />
                {err("teamMemberName")}
              </div>
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">File Type</Label>
                <Select value={fileType} onValueChange={setFileType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Buyer File">Buyer File</SelectItem>
                    <SelectItem value="Seller File">Seller File</SelectItem>
                    <SelectItem value="Landlord File">Landlord File</SelectItem>
                    <SelectItem value="Tenant File">Tenant File</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Client 1 */}
            <div>
              <SectionHead>Client 1 *</SectionHead>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">Full Name *</Label>
                  <Input
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
                      value={c1Email}
                      onChange={e => setC1Email(e.target.value)}
                      className={errors.c1Email ? "border-red-400" : ""}
                    />
                    {err("c1Email")}
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Phone *</Label>
                    <Input
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

            {/* Property Address */}
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

            {/* Client 2 */}
            <div>
              <SectionHead>Client 2 <span className="text-gray-300 font-normal normal-case tracking-normal text-xs">(optional)</span></SectionHead>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">Full Name</Label>
                  <Input value={c2Name} onChange={e => setC2Name(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Email</Label>
                    <Input type="email" value={c2Email} onChange={e => setC2Email(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600 mb-1 block">Phone</Label>
                    <Input value={c2Phone} onChange={e => setC2Phone(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Property Characteristics */}
            <div>
              <SectionHead>A Little About the Subject Property</SectionHead>
              <CheckGroup
                options={PROPERTY_CHAR_OPTIONS}
                selected={propChars}
                onChange={setPropChars}
                otherValue={propCharsOther}
                onOtherChange={setPropCharsOther}
                idPrefix="edit-prop"
              />
            </div>

            <Separator />

            {/* Paperwork Preparation */}
            <div>
              <SectionHead>Paperwork Preparation — Select All That Apply</SectionHead>
              <CheckGroup
                options={PAPERWORK_OPTIONS}
                selected={paperwork}
                onChange={setPaperwork}
                otherValue=""
                onOtherChange={() => {}}
                idPrefix="edit-paper"
              />
            </div>

            <Separator />

            {/* Agent Remarks */}
            <div>
              <Label className="text-xs text-gray-600 mb-1 block">
                Agent Remarks <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Textarea
                value={agentRemarks}
                onChange={e => setAgentRemarks(e.target.value)}
                className="resize-none"
                rows={2}
              />
            </div>

            {/* ══ PHASE II ═══════════════════════════════════════════════ */}
            {selectedPhase >= 2 && (
              <>
                <div className="bg-[#012169]/5 border border-[#012169]/15 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-[#012169] uppercase tracking-widest">
                    Phase II — Offer Details
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Fields below become available when advancing to Phase II or beyond.
                  </p>
                </div>

                <Separator />

                {/* Offer financials */}
                <div>
                  <SectionHead tag="Phase II">Offer Financials</SectionHead>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-gray-600 mb-1 block">
                          Confirm Initial Offer Price <span className="text-gray-400 font-normal">(optional)</span>
                        </Label>
                        <Input
                          type="number"
                          placeholder="450000"
                          value={offerPrice}
                          onChange={e => setOfferPrice(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-600 mb-1 block">
                          Earnest Money Amount <span className="text-gray-400 font-normal">(optional)</span>
                        </Label>
                        <Input
                          type="number"
                          placeholder="5000"
                          value={earnestMoney}
                          onChange={e => setEarnestMoney(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-gray-600 mb-1 block">
                          Settlement on or Before <span className="text-gray-400 font-normal">(optional)</span>
                        </Label>
                        <Input
                          type="date"
                          value={settlementDate}
                          onChange={e => setSettlementDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-gray-600 mb-1 block">
                          Seller Concession Amount <span className="text-gray-400 font-normal">(optional)</span>
                        </Label>
                        <Input
                          type="number"
                          placeholder="5000"
                          value={sellerConcession}
                          onChange={e => setSellerConcession(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Financial Contingency */}
                <div>
                  <SectionHead tag="Phase II">Financial Contingency Type</SectionHead>
                  <CheckGroup
                    options={FINANCING_OPTIONS}
                    selected={financingTypes}
                    onChange={setFinancingTypes}
                    otherValue={financingTypeOther}
                    onOtherChange={setFinancingTypeOther}
                    idPrefix="edit-fin"
                  />
                </div>

                <Separator />

                {/* Inclusions + Warranty */}
                <div>
                  <SectionHead tag="Phase II">Terms</SectionHead>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Additional Inclusions / Exclusions <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Textarea
                        value={inclusions}
                        onChange={e => setInclusions(e.target.value)}
                        className="resize-none"
                        rows={2}
                        placeholder="e.g. Refrigerator included, washer/dryer excluded…"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Home Warranty <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Input
                        value={homeWarranty}
                        onChange={e => setHomeWarranty(e.target.value)}
                        placeholder="e.g. Paid by Seller — $500"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Property Inspections */}
                <div>
                  <SectionHead tag="Phase II">Property Inspection Contingency</SectionHead>
                  <div className="space-y-4">
                    <CheckGroup
                      options={INSPECTION_OPTIONS}
                      selected={propInspections}
                      onChange={setPropInspections}
                      otherValue={inspectionsOther}
                      onOtherChange={setInspectionsOther}
                      idPrefix="edit-insp"
                    />
                    <div className="w-1/2">
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Inspection Contingency Days <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Input
                        type="number"
                        placeholder="10"
                        value={inspectionDays}
                        onChange={e => setInspectionDays(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Additional info + Escrow */}
                <div>
                  <SectionHead tag="Phase II">Additional Details</SectionHead>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Escrow Company <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Input
                        value={escrowCompany}
                        onChange={e => setEscrowCompany(e.target.value)}
                        placeholder="e.g. First American Title"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Additional Information <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Textarea
                        value={additionalInfo}
                        onChange={e => setAdditionalInfo(e.target.value)}
                        className="resize-none"
                        rows={2}
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Agent + Notes */}
                <div>
                  <SectionHead tag="Phase II">Communications</SectionHead>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Agent Email Address <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        type="email"
                        value={agentEmail}
                        onChange={e => setAgentEmail(e.target.value)}
                        placeholder="agent@email.com"
                        className={errors.agentEmail ? "border-red-400" : ""}
                      />
                      {err("agentEmail")}
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Note to Client <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Textarea
                        value={noteToClient}
                        onChange={e => setNoteToClient(e.target.value)}
                        className="resize-none"
                        rows={2}
                        placeholder="Message that will be sent to your client…"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600 mb-1 block">
                        Note to Coop <span className="text-gray-400 font-normal">(optional)</span>
                      </Label>
                      <Textarea
                        value={noteToCoop}
                        onChange={e => setNoteToCoop(e.target.value)}
                        className="resize-none"
                        rows={2}
                        placeholder="Message for the cooperating agent…"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              className="bg-[#012169] hover:bg-[#418FDE] text-white"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
