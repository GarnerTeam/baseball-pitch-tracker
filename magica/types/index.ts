export type PhaseNumber = 1 | 2 | 3 | 4 | 5

export interface Phase {
  number: PhaseNumber
  name: string
  shortName: string
  description: string
}

export type ContactRole =
  | 'buyer' | 'seller' | 'coop_agent' | 'lender' | 'title' | 'tc' | 'agent'
  | 'buyer1' | 'buyer2'
  | 'seller1' | 'seller2'
  | 'landlord1' | 'landlord2'
  | 'tenant1'  | 'tenant2'
  | 'listing_agent' | 'buyers_agent'
  | 'loan_officer' | 'loan_processor'
  | 'settlement_officer' | 'title_processor'
  | 'ta_list' | 'ta_buy_tenant'
  | 'home_inspector' | 'appraiser'

export type TransactionType   = 'buyer' | 'seller' | 'rental' | 'tenant'
export type TransactionStatus = 'active' | 'pending_close' | 'closed' | 'withdrawn'
export type UserRole          = 'tc' | 'client' | 'coop_agent'

export interface TransactionContact {
  id: string
  name: string
  email: string
  phone: string
  role: ContactRole
}

export interface Task {
  id: string
  phase: PhaseNumber
  title: string
  completed: boolean
  dueDate?: string
  assignedTo?: string
  priority?: 'high' | 'medium' | 'low'
}

export interface Transaction {
  id: string
  phase: PhaseNumber
  status: TransactionStatus
  type: TransactionType
  createdAt: string

  // ── Phase I — always present ────────────────────────────────────────────────
  teamMemberName: string          // required on launch
  fileType: string                // "Buyer File" | "Seller File" | "Landlord File" | "Tenant File"

  // Client 1 (required)
  client1Name: string
  client1Email: string
  client1Phone: string

  // Property address (optional)
  address: string

  // Client 2 (all optional)
  client2Name?: string
  client2Email?: string
  client2Phone?: string

  // Subject property characteristics (optional multi-select + Other)
  propertyCharacteristics?: string[]
  propertyCharacteristicsOther?: string

  // Paperwork preparation (required multi-select)
  paperworkItems?: string[]

  // Agent remarks (optional)
  agentRemarks?: string

  // Meeting date (Phase I, optional)
  meetingDate?: string

  // ── Phase II — visible when phase ≥ 2 ──────────────────────────────────────
  offerPrice?: number
  earnestMoney?: number
  settlementDate?: string          // Settlement on or Before (calendar)
  sellerConcession?: number
  financingTypes?: string[]        // multi-select
  financingTypeOther?: string
  inclusions?: string              // Additional Inclusions / Exclusions
  homeWarranty?: string
  propertyInspections?: string[]   // multi-select
  propertyInspectionsOther?: string
  additionalInfo?: string
  escrowCompany?: string
  inspectionDays?: number
  agentEmail?: string              // required when advancing to Phase II
  noteToClient?: string
  noteToCoop?: string

  // ── Legacy / computed ───────────────────────────────────────────────────────
  mlsNumber: string               // mirrors teamMemberName for list display
  listPrice: number               // unused, kept at 0
  salePrice?: number
  closingDate?: string            // legacy alias for settlementDate
  notes?: string
  contractDate?: string
  inspectionDeadline?: string
  financingDeadline?: string

  contacts: TransactionContact[]
  tasks: Task[]
}
