/**
 * Flora Internal CRM Provider
 * Implements the ICRMProvider interface using Flora's native data models
 */

import {
  ICRMProvider,
  IContact,
  IDeal,
  IActivity,
  ConnectionConfig,
  PaginatedResult,
  SyncResult,
  ImportResult,
  ContactFilters,
  DealFilters,
  ActivityFilters,
  ProviderCapabilities,
  EntityType,
  FieldSchema,
  WebhookEvent
} from '../interface/ICRMProvider';

import { EventEmitter } from 'events';
import mongoose from 'mongoose';

export class FloraCRMProvider extends EventEmitter implements ICRMProvider {
  readonly name = 'Flora CRM';
  readonly type: 'internal' = 'internal';
  readonly version = '1.0.0';
  readonly capabilities: ProviderCapabilities = {
    contacts: true,
    deals: true,
    activities: true,
    customFields: true,
    webhooks: true,
    bulkOperations: true,
    realTimeSync: true,
    bidirectionalSync: true,
    fieldMapping: true,
    conflictResolution: true
  };

  private connected: boolean = false;
  private db: mongoose.Connection | null = null;
  private lastSyncTime: Date | null = null;

  /**
   * Connection Management
   */
  async connect(config: ConnectionConfig): Promise<void> {
    try {
      const uri = config.settings?.baseUrl || process.env.MONGODB_URI || 'mongodb://localhost:27017/flora-crm';

      this.db = await mongoose.createConnection(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      });

      // Load models
      await this.loadModels();

      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to Flora CRM: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  async testConnection(): Promise<boolean> {
    if (!this.connected || !this.db) return false;

    try {
      await this.db.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  getConnectionStatus() {
    return {
      connected: this.connected,
      lastSync: this.lastSyncTime,
      errors: []
    };
  }

  /**
   * Contact Operations
   */
  contacts = {
    create: async (data: IContact): Promise<IContact> => {
      const Contact = this.getModel('Contact');
      const contact = new Contact(this.mapContactToInternal(data));
      await contact.save();
      return this.mapContactFromInternal(contact);
    },

    update: async (id: string, data: Partial<IContact>): Promise<IContact> => {
      const Contact = this.getModel('Contact');
      const contact = await Contact.findByIdAndUpdate(
        id,
        this.mapContactToInternal(data),
        { new: true }
      );
      if (!contact) throw new Error(`Contact not found: ${id}`);
      return this.mapContactFromInternal(contact);
    },

    delete: async (id: string): Promise<void> => {
      const Contact = this.getModel('Contact');
      const result = await Contact.findByIdAndDelete(id);
      if (!result) throw new Error(`Contact not found: ${id}`);
    },

    get: async (id: string): Promise<IContact> => {
      const Contact = this.getModel('Contact');
      const contact = await Contact.findById(id);
      if (!contact) throw new Error(`Contact not found: ${id}`);
      return this.mapContactFromInternal(contact);
    },

    list: async (
      filters?: ContactFilters,
      pagination?: { page: number; pageSize: number }
    ): Promise<PaginatedResult<IContact>> => {
      const Contact = this.getModel('Contact');
      const query = this.buildContactQuery(filters);

      const page = pagination?.page || 1;
      const pageSize = pagination?.pageSize || 50;
      const skip = (page - 1) * pageSize;

      const [contacts, total] = await Promise.all([
        Contact.find(query).skip(skip).limit(pageSize),
        Contact.countDocuments(query)
      ]);

      return {
        data: contacts.map(c => this.mapContactFromInternal(c)),
        total,
        page,
        pageSize,
        hasNext: skip + pageSize < total,
        hasPrevious: page > 1
      };
    },

    search: async (query: string, limit?: number): Promise<IContact[]> => {
      const Contact = this.getModel('Contact');
      const contacts = await Contact.find({
        $text: { $search: query }
      }).limit(limit || 20);

      return contacts.map(c => this.mapContactFromInternal(c));
    },

    bulkCreate: async (contacts: IContact[]): Promise<ImportResult> => {
      const Contact = this.getModel('Contact');
      const results = { success: 0, failed: 0, errors: [] };

      for (let i = 0; i < contacts.length; i++) {
        try {
          const contact = new Contact(this.mapContactToInternal(contacts[i]));
          await contact.save();
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            index: i,
            data: contacts[i],
            error: error.message
          });
        }
      }

      return results;
    },

    bulkUpdate: async (updates: Array<{ id: string; data: Partial<IContact> }>): Promise<ImportResult> => {
      const Contact = this.getModel('Contact');
      const results = { success: 0, failed: 0, errors: [] };

      for (let i = 0; i < updates.length; i++) {
        try {
          await Contact.findByIdAndUpdate(
            updates[i].id,
            this.mapContactToInternal(updates[i].data)
          );
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            index: i,
            data: updates[i],
            error: error.message
          });
        }
      }

      return results;
    },

    bulkDelete: async (ids: string[]): Promise<{ success: number; failed: number }> => {
      const Contact = this.getModel('Contact');
      const result = await Contact.deleteMany({ _id: { $in: ids } });

      return {
        success: result.deletedCount,
        failed: ids.length - result.deletedCount
      };
    },

    sync: async (since?: Date): Promise<SyncResult> => {
      // Internal provider doesn't need external sync
      return {
        success: true,
        entities: {
          contacts: { created: 0, updated: 0, failed: 0 },
          deals: { created: 0, updated: 0, failed: 0 },
          activities: { created: 0, updated: 0, failed: 0 }
        },
        errors: [],
        duration: 0
      };
    },

    merge: async (primaryId: string, duplicateIds: string[]): Promise<IContact> => {
      const Contact = this.getModel('Contact');
      const DealContact = this.getModel('DealContact');

      // Get primary contact
      const primary = await Contact.findById(primaryId);
      if (!primary) throw new Error(`Primary contact not found: ${primaryId}`);

      // Get duplicate contacts
      const duplicates = await Contact.find({ _id: { $in: duplicateIds } });

      // Merge data from duplicates into primary
      for (const duplicate of duplicates) {
        // Merge emails
        if (duplicate.emailAddresses) {
          primary.emailAddresses = this.mergeArrays(
            primary.emailAddresses,
            duplicate.emailAddresses,
            'email'
          );
        }

        // Merge tags
        if (duplicate.tags) {
          primary.tags = [...new Set([...primary.tags, ...duplicate.tags])];
        }

        // Update deal relationships
        await DealContact.updateMany(
          { contactId: duplicate._id },
          { contactId: primary._id }
        );

        // Delete duplicate
        await Contact.findByIdAndDelete(duplicate._id);
      }

      await primary.save();
      return this.mapContactFromInternal(primary);
    }
  };

  /**
   * Deal Operations
   */
  deals = {
    create: async (data: IDeal): Promise<IDeal> => {
      const Deal = this.getModel('Deal');
      const deal = new Deal(this.mapDealToInternal(data));
      await deal.save();
      return this.mapDealFromInternal(deal);
    },

    update: async (id: string, data: Partial<IDeal>): Promise<IDeal> => {
      const Deal = this.getModel('Deal');
      const deal = await Deal.findByIdAndUpdate(
        id,
        this.mapDealToInternal(data),
        { new: true }
      );
      if (!deal) throw new Error(`Deal not found: ${id}`);
      return this.mapDealFromInternal(deal);
    },

    delete: async (id: string): Promise<void> => {
      const Deal = this.getModel('Deal');
      const result = await Deal.findByIdAndDelete(id);
      if (!result) throw new Error(`Deal not found: ${id}`);
    },

    get: async (id: string): Promise<IDeal> => {
      const Deal = this.getModel('Deal');
      const deal = await Deal.findById(id)
        .populate('dealLead')
        .populate('dealContacts');
      if (!deal) throw new Error(`Deal not found: ${id}`);
      return this.mapDealFromInternal(deal);
    },

    list: async (
      filters?: DealFilters,
      pagination?: { page: number; pageSize: number }
    ): Promise<PaginatedResult<IDeal>> => {
      const Deal = this.getModel('Deal');
      const query = this.buildDealQuery(filters);

      const page = pagination?.page || 1;
      const pageSize = pagination?.pageSize || 50;
      const skip = (page - 1) * pageSize;

      const [deals, total] = await Promise.all([
        Deal.find(query).skip(skip).limit(pageSize),
        Deal.countDocuments(query)
      ]);

      return {
        data: deals.map(d => this.mapDealFromInternal(d)),
        total,
        page,
        pageSize,
        hasNext: skip + pageSize < total,
        hasPrevious: page > 1
      };
    },

    moveStage: async (id: string, stage: string, reason?: string): Promise<IDeal> => {
      const Deal = this.getModel('Deal');
      const deal = await Deal.findById(id);
      if (!deal) throw new Error(`Deal not found: ${id}`);

      // Track stage history
      if (!deal.stageHistory) deal.stageHistory = [];

      const lastStage = deal.stageHistory[deal.stageHistory.length - 1];
      if (lastStage && !lastStage.exitedAt) {
        lastStage.exitedAt = new Date();
        lastStage.duration = Date.now() - lastStage.enteredAt.getTime();
      }

      deal.stageHistory.push({
        stage,
        enteredAt: new Date(),
        note: reason
      });

      deal.stage = stage;
      await deal.save();

      return this.mapDealFromInternal(deal);
    },

    attachContact: async (dealId: string, contactId: string, role?: string): Promise<void> => {
      const DealContact = this.getModel('DealContact');

      const existing = await DealContact.findOne({ dealId, contactId });
      if (existing) {
        if (role) {
          existing.role = role;
          await existing.save();
        }
        return;
      }

      await DealContact.create({
        dealId,
        contactId,
        role: role || 'contact'
      });
    },

    detachContact: async (dealId: string, contactId: string): Promise<void> => {
      const DealContact = this.getModel('DealContact');
      await DealContact.findOneAndDelete({ dealId, contactId });
    },

    getContacts: async (dealId: string): Promise<Array<{ contact: IContact; role: string }>> => {
      const DealContact = this.getModel('DealContact');
      const relationships = await DealContact.find({ dealId }).populate('contactId');

      return relationships.map(rel => ({
        contact: this.mapContactFromInternal(rel.contactId),
        role: rel.role
      }));
    },

    close: async (id: string, status: 'won' | 'lost', reason?: string): Promise<IDeal> => {
      const Deal = this.getModel('Deal');
      const deal = await Deal.findById(id);
      if (!deal) throw new Error(`Deal not found: ${id}`);

      deal.stage = status === 'won' ? 'closing' : 'passed';
      deal.closedDate = new Date();
      deal.status = status;
      if (reason) deal.lostReason = reason;

      await deal.save();
      return this.mapDealFromInternal(deal);
    },

    reopen: async (id: string): Promise<IDeal> => {
      const Deal = this.getModel('Deal');
      const deal = await Deal.findById(id);
      if (!deal) throw new Error(`Deal not found: ${id}`);

      deal.status = 'open';
      deal.closedDate = null;
      deal.lostReason = null;

      await deal.save();
      return this.mapDealFromInternal(deal);
    },

    sync: async (since?: Date): Promise<SyncResult> => {
      // Internal provider doesn't need external sync
      return {
        success: true,
        entities: {
          contacts: { created: 0, updated: 0, failed: 0 },
          deals: { created: 0, updated: 0, failed: 0 },
          activities: { created: 0, updated: 0, failed: 0 }
        },
        errors: [],
        duration: 0
      };
    },

    getTimeline: async (id: string): Promise<Array<{ timestamp: Date; event: string; user?: string }>> => {
      const Deal = this.getModel('Deal');
      const deal = await Deal.findById(id);
      if (!deal) throw new Error(`Deal not found: ${id}`);

      const timeline = [];

      // Add creation event
      timeline.push({
        timestamp: deal.createdAt,
        event: 'Deal created',
        user: deal.createdBy
      });

      // Add stage history
      if (deal.stageHistory) {
        for (const stage of deal.stageHistory) {
          timeline.push({
            timestamp: stage.enteredAt,
            event: `Moved to stage: ${stage.stage}`,
            user: stage.movedBy
          });
        }
      }

      // Sort by timestamp
      timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      return timeline;
    }
  };

  /**
   * Activity Operations
   */
  activities = {
    create: async (data: IActivity): Promise<IActivity> => {
      const Interaction = this.getModel('Interaction');
      const activity = new Interaction(this.mapActivityToInternal(data));
      await activity.save();
      return this.mapActivityFromInternal(activity);
    },

    update: async (id: string, data: Partial<IActivity>): Promise<IActivity> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findByIdAndUpdate(
        id,
        this.mapActivityToInternal(data),
        { new: true }
      );
      if (!activity) throw new Error(`Activity not found: ${id}`);
      return this.mapActivityFromInternal(activity);
    },

    delete: async (id: string): Promise<void> => {
      const Interaction = this.getModel('Interaction');
      const result = await Interaction.findByIdAndDelete(id);
      if (!result) throw new Error(`Activity not found: ${id}`);
    },

    get: async (id: string): Promise<IActivity> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findById(id);
      if (!activity) throw new Error(`Activity not found: ${id}`);
      return this.mapActivityFromInternal(activity);
    },

    list: async (
      filters?: ActivityFilters,
      pagination?: { page: number; pageSize: number }
    ): Promise<PaginatedResult<IActivity>> => {
      const Interaction = this.getModel('Interaction');
      const query = this.buildActivityQuery(filters);

      const page = pagination?.page || 1;
      const pageSize = pagination?.pageSize || 50;
      const skip = (page - 1) * pageSize;

      const [activities, total] = await Promise.all([
        Interaction.find(query).skip(skip).limit(pageSize),
        Interaction.countDocuments(query)
      ]);

      return {
        data: activities.map(a => this.mapActivityFromInternal(a)),
        total,
        page,
        pageSize,
        hasNext: skip + pageSize < total,
        hasPrevious: page > 1
      };
    },

    complete: async (id: string, outcome?: string, notes?: string): Promise<IActivity> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findById(id);
      if (!activity) throw new Error(`Activity not found: ${id}`);

      activity.status = 'completed';
      activity.completedAt = new Date();
      if (outcome) activity.outcome = outcome;
      if (notes) activity.notes = (activity.notes || '') + '\n' + notes;

      await activity.save();
      return this.mapActivityFromInternal(activity);
    },

    cancel: async (id: string, reason?: string): Promise<IActivity> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findById(id);
      if (!activity) throw new Error(`Activity not found: ${id}`);

      activity.status = 'cancelled';
      if (reason) activity.notes = (activity.notes || '') + '\n' + `Cancelled: ${reason}`;

      await activity.save();
      return this.mapActivityFromInternal(activity);
    },

    reschedule: async (id: string, newDate: Date): Promise<IActivity> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findById(id);
      if (!activity) throw new Error(`Activity not found: ${id}`);

      activity.date = newDate;
      activity.status = 'scheduled';

      await activity.save();
      return this.mapActivityFromInternal(activity);
    },

    linkToContact: async (activityId: string, contactId: string): Promise<void> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findById(activityId);
      if (!activity) throw new Error(`Activity not found: ${activityId}`);

      if (!activity.participants) activity.participants = [];
      if (!activity.participants.some(p => p.participantId.toString() === contactId)) {
        activity.participants.push({
          participantId: contactId,
          participantType: 'Contact'
        });
        await activity.save();
      }
    },

    linkToDeal: async (activityId: string, dealId: string): Promise<void> => {
      const Interaction = this.getModel('Interaction');
      const activity = await Interaction.findById(activityId);
      if (!activity) throw new Error(`Activity not found: ${activityId}`);

      activity.relatedTo = {
        entityId: dealId,
        entityType: 'Deal'
      };
      await activity.save();
    },

    sync: async (since?: Date): Promise<SyncResult> => {
      // Internal provider doesn't need external sync
      return {
        success: true,
        entities: {
          contacts: { created: 0, updated: 0, failed: 0 },
          deals: { created: 0, updated: 0, failed: 0 },
          activities: { created: 0, updated: 0, failed: 0 }
        },
        errors: [],
        duration: 0
      };
    }
  };

  /**
   * Field Mapping
   */
  fieldMapping = {
    getSchema: async (entity: EntityType): Promise<FieldSchema> => {
      const schemas = {
        contact: {
          fields: [
            { name: 'firstName', type: 'string' as const, required: true },
            { name: 'lastName', type: 'string' as const, required: true },
            { name: 'email', type: 'string' as const, required: true },
            { name: 'phone', type: 'string' as const, required: false },
            { name: 'company', type: 'string' as const, required: false },
            { name: 'title', type: 'string' as const, required: false },
            { name: 'tags', type: 'array' as const, required: false },
            { name: 'connectionStrength', type: 'number' as const, required: false },
            { name: 'engagementScore', type: 'number' as const, required: false }
          ]
        },
        deal: {
          fields: [
            { name: 'name', type: 'string' as const, required: true },
            { name: 'stage', type: 'string' as const, required: true },
            { name: 'amount', type: 'number' as const, required: false },
            { name: 'expectedCloseDate', type: 'date' as const, required: false },
            { name: 'probability', type: 'number' as const, required: false }
          ]
        },
        activity: {
          fields: [
            { name: 'type', type: 'string' as const, required: true },
            { name: 'subject', type: 'string' as const, required: true },
            { name: 'date', type: 'date' as const, required: false },
            { name: 'status', type: 'string' as const, required: true }
          ]
        }
      };

      return schemas[entity];
    },

    getCustomFields: async (entity: EntityType): Promise<Array<{ name: string; type: string; required: boolean }>> => {
      // Flora supports dynamic custom fields
      return [];
    },

    mapToProvider: (entity: EntityType, data: any): any => {
      // No mapping needed for internal provider
      return data;
    },

    mapFromProvider: (entity: EntityType, data: any): any => {
      // No mapping needed for internal provider
      return data;
    },

    validateData: (entity: EntityType, data: any): { valid: boolean; errors?: string[] } => {
      const errors = [];

      switch (entity) {
        case 'contact':
          if (!data.firstName) errors.push('firstName is required');
          if (!data.lastName) errors.push('lastName is required');
          if (!data.email) errors.push('email is required');
          break;
        case 'deal':
          if (!data.name) errors.push('name is required');
          if (!data.stage) errors.push('stage is required');
          break;
        case 'activity':
          if (!data.type) errors.push('type is required');
          if (!data.subject) errors.push('subject is required');
          break;
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
      };
    }
  };

  /**
   * Sync Management
   */
  sync = {
    getLastSyncTime: async (): Promise<Date | null> => {
      return this.lastSyncTime;
    },

    getSyncStatus: async (): Promise<{ running: boolean; progress?: number; currentEntity?: string }> => {
      return { running: false };
    },

    triggerFullSync: async (): Promise<void> => {
      // No external sync needed for internal provider
      this.lastSyncTime = new Date();
    },

    triggerIncrementalSync: async (): Promise<void> => {
      // No external sync needed for internal provider
      this.lastSyncTime = new Date();
    },

    pauseSync: async (): Promise<void> => {
      // No-op for internal provider
    },

    resumeSync: async (): Promise<void> => {
      // No-op for internal provider
    },

    getSyncHistory: async (limit?: number): Promise<Array<{ timestamp: Date; result: SyncResult }>> => {
      return [];
    }
  };

  /**
   * Private Helper Methods
   */
  private models: Map<string, any> = new Map();

  private async loadModels(): Promise<void> {
    // These would be actual Mongoose model definitions
    // For now, we're using placeholders
    this.models.set('Contact', this.db.model('Contact', new mongoose.Schema({
      firstName: String,
      lastName: String,
      email: String,
      emailAddresses: Array,
      phone: String,
      company: String,
      title: String,
      tags: [String],
      connectionStrength: Number,
      engagementScore: Number,
      lastActivityDate: Date,
      createdAt: Date,
      updatedAt: Date
    })));

    this.models.set('Deal', this.db.model('Deal', new mongoose.Schema({
      companyName: String,
      stage: String,
      amount: Number,
      expectedCloseDate: Date,
      dealLead: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      stageHistory: Array,
      createdAt: Date,
      updatedAt: Date
    })));

    this.models.set('DealContact', this.db.model('DealContact', new mongoose.Schema({
      dealId: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal' },
      contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
      role: String
    })));

    this.models.set('Interaction', this.db.model('Interaction', new mongoose.Schema({
      interactionType: String,
      subject: String,
      description: String,
      status: String,
      date: Date,
      participants: Array,
      relatedTo: Object,
      createdAt: Date,
      updatedAt: Date
    })));
  }

  private getModel(name: string): any {
    const model = this.models.get(name);
    if (!model) throw new Error(`Model not found: ${name}`);
    return model;
  }

  private buildContactQuery(filters?: ContactFilters): any {
    const query: any = {};

    if (filters?.search) {
      query.$text = { $search: filters.search };
    }
    if (filters?.email) {
      query.email = filters.email;
    }
    if (filters?.domain) {
      query.primaryDomain = filters.domain;
    }
    if (filters?.tags && filters.tags.length > 0) {
      query.tags = { $in: filters.tags };
    }
    if (filters?.createdAfter) {
      query.createdAt = { $gte: filters.createdAfter };
    }
    if (filters?.modifiedAfter) {
      query.updatedAt = { $gte: filters.modifiedAfter };
    }
    if (filters?.connectionStrength) {
      query.connectionStrength = {
        $gte: filters.connectionStrength.min,
        $lte: filters.connectionStrength.max
      };
    }
    if (filters?.engagementScore) {
      query.engagementScore = {
        $gte: filters.engagementScore.min,
        $lte: filters.engagementScore.max
      };
    }

    return query;
  }

  private buildDealQuery(filters?: DealFilters): any {
    const query: any = {};

    if (filters?.pipeline) {
      query.pipeline = filters.pipeline;
    }
    if (filters?.stage) {
      query.stage = filters.stage;
    }
    if (filters?.status) {
      query.status = filters.status;
    }
    if (filters?.assignedTo) {
      query.dealLead = filters.assignedTo;
    }
    if (filters?.createdAfter) {
      query.createdAt = { $gte: filters.createdAfter };
    }
    if (filters?.modifiedAfter) {
      query.updatedAt = { $gte: filters.modifiedAfter };
    }
    if (filters?.amountRange) {
      query.amount = {
        $gte: filters.amountRange.min,
        $lte: filters.amountRange.max
      };
    }
    if (filters?.closeDateRange) {
      query.expectedCloseDate = {
        $gte: filters.closeDateRange.start,
        $lte: filters.closeDateRange.end
      };
    }

    return query;
  }

  private buildActivityQuery(filters?: ActivityFilters): any {
    const query: any = {};

    if (filters?.type) {
      query.interactionType = filters.type;
    }
    if (filters?.assignedTo) {
      query.assignedTo = filters.assignedTo;
    }
    if (filters?.status) {
      query.status = filters.status;
    }
    if (filters?.dateRange) {
      query.date = {
        $gte: filters.dateRange.start,
        $lte: filters.dateRange.end
      };
    }
    if (filters?.relatedTo) {
      query['relatedTo.entityType'] = filters.relatedTo.type;
      query['relatedTo.entityId'] = filters.relatedTo.id;
    }

    return query;
  }

  private mapContactToInternal(contact: Partial<IContact>): any {
    return {
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      title: contact.title,
      tags: contact.tags,
      connectionStrength: contact.connectionStrength,
      engagementScore: contact.engagementScore,
      lastActivityDate: contact.lastActivityDate,
      emailAddresses: contact.emails?.map(e => ({
        email: e.email,
        type: e.type,
        isPrimary: e.primary
      }))
    };
  }

  private mapContactFromInternal(contact: any): IContact {
    return {
      id: contact._id.toString(),
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      emails: contact.emailAddresses?.map(e => ({
        email: e.email,
        type: e.type || 'other',
        primary: e.isPrimary
      })),
      phone: contact.phone,
      company: contact.company,
      title: contact.title,
      tags: contact.tags,
      connectionStrength: contact.connectionStrength,
      engagementScore: contact.engagementScore,
      lastActivityDate: contact.lastActivityDate,
      createdAt: contact.createdAt,
      updatedAt: contact.updatedAt
    };
  }

  private mapDealToInternal(deal: Partial<IDeal>): any {
    return {
      companyName: deal.companyName || deal.name,
      stage: deal.stage,
      amount: deal.amount,
      expectedCloseDate: deal.expectedCloseDate,
      dealLead: deal.assignedTo,
      status: deal.status,
      lostReason: deal.lostReason,
      thesisFit: deal.thesisFit,
      evaluationScore: deal.evaluationScore
    };
  }

  private mapDealFromInternal(deal: any): IDeal {
    return {
      id: deal._id.toString(),
      name: deal.companyName,
      companyName: deal.companyName,
      stage: deal.stage,
      amount: deal.amount,
      expectedCloseDate: deal.expectedCloseDate,
      status: deal.status,
      lostReason: deal.lostReason,
      assignedTo: deal.dealLead?.toString(),
      thesisFit: deal.thesisFit,
      evaluationScore: deal.evaluationScore,
      stageHistory: deal.stageHistory,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt
    };
  }

  private mapActivityToInternal(activity: Partial<IActivity>): any {
    return {
      interactionType: activity.type,
      subject: activity.subject,
      description: activity.description,
      status: activity.status,
      date: activity.date || activity.startTime,
      notes: activity.notes,
      outcome: activity.outcome
    };
  }

  private mapActivityFromInternal(activity: any): IActivity {
    return {
      id: activity._id.toString(),
      type: activity.interactionType as any,
      subject: activity.subject,
      description: activity.description,
      status: activity.status as any,
      date: activity.date,
      notes: activity.notes,
      outcome: activity.outcome,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt
    };
  }

  private mergeArrays(arr1: any[], arr2: any[], uniqueKey: string): any[] {
    const map = new Map();

    for (const item of arr1) {
      map.set(item[uniqueKey], item);
    }

    for (const item of arr2) {
      if (!map.has(item[uniqueKey])) {
        map.set(item[uniqueKey], item);
      }
    }

    return Array.from(map.values());
  }
}

export default FloraCRMProvider;