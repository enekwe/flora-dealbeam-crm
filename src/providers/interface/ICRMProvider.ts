/**
 * Core CRM Provider Interface
 * All CRM providers (internal and external) must implement this interface
 */

export interface ConnectionConfig {
  type: 'oauth' | 'apikey' | 'internal';
  credentials?: {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;
  };
  settings?: {
    baseUrl?: string;
    portalId?: string;
    domain?: string;
    syncInterval?: number;
  };
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface SyncResult {
  success: boolean;
  entities: {
    contacts: { created: number; updated: number; failed: number };
    deals: { created: number; updated: number; failed: number };
    activities: { created: number; updated: number; failed: number };
  };
  errors: Array<{
    entity: string;
    entityId: string;
    error: string;
    timestamp: Date;
  }>;
  duration: number;
}

export interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{
    index: number;
    data: any;
    error: string;
  }>;
}

export interface WebhookEvent {
  type: 'created' | 'updated' | 'deleted';
  entityType: 'contact' | 'deal' | 'activity';
  entityId: string;
  data: any;
  timestamp: Date;
}

export interface FieldSchema {
  fields: Array<{
    name: string;
    type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object';
    required: boolean;
    description?: string;
    allowedValues?: any[];
    maxLength?: number;
    minLength?: number;
  }>;
}

export type EntityType = 'contact' | 'deal' | 'activity';

export interface ProviderCapabilities {
  contacts: boolean;
  deals: boolean;
  activities: boolean;
  customFields: boolean;
  webhooks: boolean;
  bulkOperations: boolean;
  realTimeSync: boolean;
  bidirectionalSync: boolean;
  fieldMapping: boolean;
  conflictResolution: boolean;
}

export interface ContactFilters {
  search?: string;
  email?: string;
  domain?: string;
  tags?: string[];
  createdAfter?: Date;
  modifiedAfter?: Date;
  connectionStrength?: { min: number; max: number };
  engagementScore?: { min: number; max: number };
}

export interface DealFilters {
  pipeline?: string;
  stage?: string;
  status?: 'open' | 'closed' | 'lost';
  assignedTo?: string;
  createdAfter?: Date;
  modifiedAfter?: Date;
  amountRange?: { min: number; max: number };
  closeDateRange?: { start: Date; end: Date };
}

export interface ActivityFilters {
  type?: string;
  assignedTo?: string;
  relatedTo?: { type: 'contact' | 'deal'; id: string };
  dateRange?: { start: Date; end: Date };
  status?: 'scheduled' | 'completed' | 'cancelled';
}

export interface ICRMProvider {
  // Provider metadata
  readonly name: string;
  readonly type: 'internal' | 'external';
  readonly version: string;
  readonly capabilities: ProviderCapabilities;

  // Connection management
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;
  getConnectionStatus(): { connected: boolean; lastSync?: Date; errors?: string[] };

  // Contact operations
  contacts: {
    create(data: IContact): Promise<IContact>;
    update(id: string, data: Partial<IContact>): Promise<IContact>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<IContact>;
    list(filters?: ContactFilters, pagination?: { page: number; pageSize: number }): Promise<PaginatedResult<IContact>>;
    search(query: string, limit?: number): Promise<IContact[]>;
    bulkCreate(contacts: IContact[]): Promise<ImportResult>;
    bulkUpdate(updates: Array<{ id: string; data: Partial<IContact> }>): Promise<ImportResult>;
    bulkDelete(ids: string[]): Promise<{ success: number; failed: number }>;
    sync(since?: Date): Promise<SyncResult>;
    merge(primaryId: string, duplicateIds: string[]): Promise<IContact>;
  };

  // Deal operations
  deals: {
    create(data: IDeal): Promise<IDeal>;
    update(id: string, data: Partial<IDeal>): Promise<IDeal>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<IDeal>;
    list(filters?: DealFilters, pagination?: { page: number; pageSize: number }): Promise<PaginatedResult<IDeal>>;
    moveStage(id: string, stage: string, reason?: string): Promise<IDeal>;
    attachContact(dealId: string, contactId: string, role?: string): Promise<void>;
    detachContact(dealId: string, contactId: string): Promise<void>;
    getContacts(dealId: string): Promise<Array<{ contact: IContact; role: string }>>;
    close(id: string, status: 'won' | 'lost', reason?: string): Promise<IDeal>;
    reopen(id: string): Promise<IDeal>;
    sync(since?: Date): Promise<SyncResult>;
    getTimeline(id: string): Promise<Array<{ timestamp: Date; event: string; user?: string }>>;
  };

  // Activity operations
  activities: {
    create(data: IActivity): Promise<IActivity>;
    update(id: string, data: Partial<IActivity>): Promise<IActivity>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<IActivity>;
    list(filters?: ActivityFilters, pagination?: { page: number; pageSize: number }): Promise<PaginatedResult<IActivity>>;
    complete(id: string, outcome?: string, notes?: string): Promise<IActivity>;
    cancel(id: string, reason?: string): Promise<IActivity>;
    reschedule(id: string, newDate: Date): Promise<IActivity>;
    linkToContact(activityId: string, contactId: string): Promise<void>;
    linkToDeal(activityId: string, dealId: string): Promise<void>;
    sync(since?: Date): Promise<SyncResult>;
  };

  // Webhook support (optional for providers that support it)
  webhooks?: {
    register(events: string[], callbackUrl: string): Promise<string>; // Returns webhook ID
    unregister(webhookId: string): Promise<void>;
    verify(payload: any, headers: any): boolean;
    process(event: WebhookEvent): Promise<void>;
    listRegistered(): Promise<Array<{ id: string; events: string[]; url: string; active: boolean }>>;
  };

  // Field mapping
  fieldMapping: {
    getSchema(entity: EntityType): Promise<FieldSchema>;
    getCustomFields(entity: EntityType): Promise<Array<{ name: string; type: string; required: boolean }>>;
    mapToProvider(entity: EntityType, data: any): any;
    mapFromProvider(entity: EntityType, data: any): any;
    validateData(entity: EntityType, data: any): { valid: boolean; errors?: string[] };
  };

  // Sync management
  sync: {
    getLastSyncTime(): Promise<Date | null>;
    getSyncStatus(): Promise<{ running: boolean; progress?: number; currentEntity?: string }>;
    triggerFullSync(): Promise<void>;
    triggerIncrementalSync(): Promise<void>;
    pauseSync(): Promise<void>;
    resumeSync(): Promise<void>;
    getSyncHistory(limit?: number): Promise<Array<{ timestamp: Date; result: SyncResult }>>;
  };

  // Provider-specific operations
  custom?: {
    [key: string]: (...args: any[]) => Promise<any>;
  };
}

// Data interfaces
export interface IContact {
  id?: string;
  externalId?: string; // ID in external CRM
  firstName: string;
  lastName: string;
  email: string;
  emails?: Array<{ email: string; type: string; primary: boolean }>;
  phone?: string;
  phones?: Array<{ number: string; type: string; primary: boolean }>;
  company?: string;
  title?: string;
  department?: string;
  industry?: string;
  website?: string;
  socialProfiles?: {
    linkedIn?: string;
    twitter?: string;
    facebook?: string;
    instagram?: string;
  };
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  tags?: string[];
  notes?: string;
  customFields?: { [key: string]: any };
  connectionStrength?: number; // 0-10
  engagementScore?: number; // 0-100
  lastActivityDate?: Date;
  source?: string;
  status?: 'active' | 'inactive' | 'do_not_contact';
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
}

export interface IDeal {
  id?: string;
  externalId?: string;
  name: string;
  companyName: string;
  description?: string;
  stage: string;
  pipeline?: string;
  amount?: number;
  currency?: string;
  probability?: number; // 0-100
  expectedCloseDate?: Date;
  actualCloseDate?: Date;
  status?: 'open' | 'won' | 'lost';
  lostReason?: string;
  source?: string;
  assignedTo?: string;
  teamMembers?: string[];
  contacts?: Array<{ contactId: string; role: string }>;
  customFields?: { [key: string]: any };
  tags?: string[];
  notes?: string;
  nextSteps?: string;
  competitors?: string[];
  thesisFit?: number; // 0-100
  evaluationScore?: number; // 0-100
  documents?: Array<{ id: string; name: string; url: string; type: string }>;
  activities?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  stageHistory?: Array<{
    stage: string;
    enteredAt: Date;
    exitedAt?: Date;
    duration?: number;
    movedBy?: string;
  }>;
}

export interface IActivity {
  id?: string;
  externalId?: string;
  type: 'call' | 'email' | 'meeting' | 'task' | 'note' | 'other';
  subject: string;
  description?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high';
  date?: Date;
  startTime?: Date;
  endTime?: Date;
  duration?: number; // in minutes
  location?: string;
  outcome?: string;
  notes?: string;
  assignedTo?: string;
  participants?: Array<{ id: string; type: 'contact' | 'user'; name: string }>;
  relatedTo?: Array<{ id: string; type: 'contact' | 'deal' | 'company' }>;
  customFields?: { [key: string]: any };
  tags?: string[];
  attachments?: Array<{ id: string; name: string; url: string; type: string }>;
  createdAt?: Date;
  updatedAt?: Date;
  completedAt?: Date;
  createdBy?: string;
  updatedBy?: string;
  completedBy?: string;
}