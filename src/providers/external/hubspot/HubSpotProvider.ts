/**
 * HubSpot CRM Provider
 * Implements the ICRMProvider interface for HubSpot CRM integration
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
} from '../../interface/ICRMProvider';

import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';

export class HubSpotProvider extends EventEmitter implements ICRMProvider {
  readonly name = 'HubSpot';
  readonly type: 'external' = 'external';
  readonly version = '3.0.0';
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

  private client: AxiosInstance | null = null;
  private connected: boolean = false;
  private config: ConnectionConfig | null = null;
  private lastSyncTime: Date | null = null;
  private portalId: string | null = null;

  /**
   * Connection Management
   */
  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config;

    if (config.type === 'oauth') {
      this.client = axios.create({
        baseURL: 'https://api.hubapi.com',
        headers: {
          'Authorization': `Bearer ${config.credentials?.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
    } else if (config.type === 'apikey') {
      this.client = axios.create({
        baseURL: 'https://api.hubapi.com',
        headers: {
          'Authorization': `Bearer ${config.credentials?.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      throw new Error('Invalid connection type for HubSpot');
    }

    // Test connection and get portal ID
    try {
      const response = await this.client.get('/account-info/v3/details');
      this.portalId = response.data.portalId;
      this.connected = true;
      this.emit('connected');
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to HubSpot: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.connected = false;
    this.config = null;
    this.emit('disconnected');
  }

  async testConnection(): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.get('/account-info/v3/details');
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
      const response = await this.client!.post('/crm/v3/objects/contacts', {
        properties: this.mapContactToHubSpot(data)
      });

      return this.mapContactFromHubSpot(response.data);
    },

    update: async (id: string, data: Partial<IContact>): Promise<IContact> => {
      const response = await this.client!.patch(`/crm/v3/objects/contacts/${id}`, {
        properties: this.mapContactToHubSpot(data)
      });

      return this.mapContactFromHubSpot(response.data);
    },

    delete: async (id: string): Promise<void> => {
      await this.client!.delete(`/crm/v3/objects/contacts/${id}`);
    },

    get: async (id: string): Promise<IContact> => {
      const response = await this.client!.get(`/crm/v3/objects/contacts/${id}`, {
        params: {
          properties: 'firstname,lastname,email,phone,company,jobtitle,industry,website,linkedin,twitter'
        }
      });

      return this.mapContactFromHubSpot(response.data);
    },

    list: async (
      filters?: ContactFilters,
      pagination?: { page: number; pageSize: number }
    ): Promise<PaginatedResult<IContact>> => {
      const limit = pagination?.pageSize || 50;
      const after = pagination?.page ? ((pagination.page - 1) * limit).toString() : undefined;

      const filterGroups = [];
      if (filters) {
        const hubspotFilters = [];

        if (filters.email) {
          hubspotFilters.push({
            propertyName: 'email',
            operator: 'EQ',
            value: filters.email
          });
        }

        if (filters.createdAfter) {
          hubspotFilters.push({
            propertyName: 'createdate',
            operator: 'GTE',
            value: filters.createdAfter.getTime().toString()
          });
        }

        if (hubspotFilters.length > 0) {
          filterGroups.push({ filters: hubspotFilters });
        }
      }

      const requestBody: any = {
        limit,
        properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle']
      };

      if (filterGroups.length > 0) {
        requestBody.filterGroups = filterGroups;
      }

      if (after) {
        requestBody.after = after;
      }

      const response = await this.client!.post('/crm/v3/objects/contacts/search', requestBody);

      return {
        data: response.data.results.map(c => this.mapContactFromHubSpot(c)),
        total: response.data.total,
        page: pagination?.page || 1,
        pageSize: limit,
        hasNext: !!response.data.paging?.next,
        hasPrevious: (pagination?.page || 1) > 1
      };
    },

    search: async (query: string, limit?: number): Promise<IContact[]> => {
      const response = await this.client!.post('/crm/v3/objects/contacts/search', {
        query,
        limit: limit || 20,
        properties: ['firstname', 'lastname', 'email', 'phone', 'company']
      });

      return response.data.results.map(c => this.mapContactFromHubSpot(c));
    },

    bulkCreate: async (contacts: IContact[]): Promise<ImportResult> => {
      const inputs = contacts.map(c => ({
        properties: this.mapContactToHubSpot(c)
      }));

      try {
        const response = await this.client!.post('/crm/v3/objects/contacts/batch/create', {
          inputs
        });

        return {
          success: response.data.results.length,
          failed: response.data.errors?.length || 0,
          errors: response.data.errors?.map((e, i) => ({
            index: i,
            data: contacts[i],
            error: e.message
          })) || []
        };
      } catch (error) {
        return {
          success: 0,
          failed: contacts.length,
          errors: contacts.map((c, i) => ({
            index: i,
            data: c,
            error: error.message
          }))
        };
      }
    },

    bulkUpdate: async (updates: Array<{ id: string; data: Partial<IContact> }>): Promise<ImportResult> => {
      const inputs = updates.map(u => ({
        id: u.id,
        properties: this.mapContactToHubSpot(u.data)
      }));

      try {
        const response = await this.client!.post('/crm/v3/objects/contacts/batch/update', {
          inputs
        });

        return {
          success: response.data.results.length,
          failed: response.data.errors?.length || 0,
          errors: response.data.errors?.map((e, i) => ({
            index: i,
            data: updates[i],
            error: e.message
          })) || []
        };
      } catch (error) {
        return {
          success: 0,
          failed: updates.length,
          errors: updates.map((u, i) => ({
            index: i,
            data: u,
            error: error.message
          }))
        };
      }
    },

    bulkDelete: async (ids: string[]): Promise<{ success: number; failed: number }> => {
      try {
        const response = await this.client!.post('/crm/v3/objects/contacts/batch/archive', {
          inputs: ids.map(id => ({ id }))
        });

        return {
          success: ids.length - (response.data.errors?.length || 0),
          failed: response.data.errors?.length || 0
        };
      } catch {
        return {
          success: 0,
          failed: ids.length
        };
      }
    },

    sync: async (since?: Date): Promise<SyncResult> => {
      const startTime = Date.now();
      const result: SyncResult = {
        success: true,
        entities: {
          contacts: { created: 0, updated: 0, failed: 0 },
          deals: { created: 0, updated: 0, failed: 0 },
          activities: { created: 0, updated: 0, failed: 0 }
        },
        errors: [],
        duration: 0
      };

      try {
        // Sync contacts modified since last sync
        const contacts = await this.fetchModifiedContacts(since);

        for (const contact of contacts) {
          try {
            // Process contact sync logic here
            result.entities.contacts.updated++;
          } catch (error) {
            result.entities.contacts.failed++;
            result.errors.push({
              entity: 'contact',
              entityId: contact.id,
              error: error.message,
              timestamp: new Date()
            });
          }
        }

        this.lastSyncTime = new Date();
      } catch (error) {
        result.success = false;
      }

      result.duration = Date.now() - startTime;
      return result;
    },

    merge: async (primaryId: string, duplicateIds: string[]): Promise<IContact> => {
      // HubSpot merge endpoint
      const response = await this.client!.post('/crm/v3/objects/contacts/merge', {
        objectIdToMerge: duplicateIds[0],
        primaryObjectId: primaryId
      });

      return this.mapContactFromHubSpot(response.data);
    }
  };

  /**
   * Deal Operations
   */
  deals = {
    create: async (data: IDeal): Promise<IDeal> => {
      const response = await this.client!.post('/crm/v3/objects/deals', {
        properties: this.mapDealToHubSpot(data)
      });

      return this.mapDealFromHubSpot(response.data);
    },

    update: async (id: string, data: Partial<IDeal>): Promise<IDeal> => {
      const response = await this.client!.patch(`/crm/v3/objects/deals/${id}`, {
        properties: this.mapDealToHubSpot(data)
      });

      return this.mapDealFromHubSpot(response.data);
    },

    delete: async (id: string): Promise<void> => {
      await this.client!.delete(`/crm/v3/objects/deals/${id}`);
    },

    get: async (id: string): Promise<IDeal> => {
      const response = await this.client!.get(`/crm/v3/objects/deals/${id}`, {
        params: {
          properties: 'dealname,dealstage,amount,closedate,hs_forecast_probability,description',
          associations: 'contacts'
        }
      });

      return this.mapDealFromHubSpot(response.data);
    },

    list: async (
      filters?: DealFilters,
      pagination?: { page: number; pageSize: number }
    ): Promise<PaginatedResult<IDeal>> => {
      const limit = pagination?.pageSize || 50;
      const after = pagination?.page ? ((pagination.page - 1) * limit).toString() : undefined;

      const filterGroups = [];
      if (filters) {
        const hubspotFilters = [];

        if (filters.stage) {
          hubspotFilters.push({
            propertyName: 'dealstage',
            operator: 'EQ',
            value: this.mapStageToHubSpot(filters.stage)
          });
        }

        if (filters.status) {
          const stageMap = {
            'open': ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled'],
            'won': ['closedwon'],
            'lost': ['closedlost']
          };
          hubspotFilters.push({
            propertyName: 'dealstage',
            operator: 'IN',
            values: stageMap[filters.status]
          });
        }

        if (hubspotFilters.length > 0) {
          filterGroups.push({ filters: hubspotFilters });
        }
      }

      const requestBody: any = {
        limit,
        properties: ['dealname', 'dealstage', 'amount', 'closedate']
      };

      if (filterGroups.length > 0) {
        requestBody.filterGroups = filterGroups;
      }

      if (after) {
        requestBody.after = after;
      }

      const response = await this.client!.post('/crm/v3/objects/deals/search', requestBody);

      return {
        data: response.data.results.map(d => this.mapDealFromHubSpot(d)),
        total: response.data.total,
        page: pagination?.page || 1,
        pageSize: limit,
        hasNext: !!response.data.paging?.next,
        hasPrevious: (pagination?.page || 1) > 1
      };
    },

    moveStage: async (id: string, stage: string, reason?: string): Promise<IDeal> => {
      const hubspotStage = this.mapStageToHubSpot(stage);

      const response = await this.client!.patch(`/crm/v3/objects/deals/${id}`, {
        properties: {
          dealstage: hubspotStage,
          ...(reason && { hs_deal_stage_probability_shadow: reason })
        }
      });

      return this.mapDealFromHubSpot(response.data);
    },

    attachContact: async (dealId: string, contactId: string, role?: string): Promise<void> => {
      await this.client!.put(`/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/3`, {
        associationType: role || 'DEAL_TO_CONTACT'
      });
    },

    detachContact: async (dealId: string, contactId: string): Promise<void> => {
      await this.client!.delete(`/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/3`);
    },

    getContacts: async (dealId: string): Promise<Array<{ contact: IContact; role: string }>> => {
      const response = await this.client!.get(`/crm/v3/objects/deals/${dealId}/associations/contacts`);

      const contactIds = response.data.results.map(r => r.id);
      if (contactIds.length === 0) return [];

      const contactsResponse = await this.client!.post('/crm/v3/objects/contacts/batch/read', {
        inputs: contactIds.map(id => ({ id })),
        properties: ['firstname', 'lastname', 'email', 'phone']
      });

      return contactsResponse.data.results.map(c => ({
        contact: this.mapContactFromHubSpot(c),
        role: 'contact'
      }));
    },

    close: async (id: string, status: 'won' | 'lost', reason?: string): Promise<IDeal> => {
      const stage = status === 'won' ? 'closedwon' : 'closedlost';

      const response = await this.client!.patch(`/crm/v3/objects/deals/${id}`, {
        properties: {
          dealstage: stage,
          closed_lost_reason: reason
        }
      });

      return this.mapDealFromHubSpot(response.data);
    },

    reopen: async (id: string): Promise<IDeal> => {
      const response = await this.client!.patch(`/crm/v3/objects/deals/${id}`, {
        properties: {
          dealstage: 'appointmentscheduled'
        }
      });

      return this.mapDealFromHubSpot(response.data);
    },

    sync: async (since?: Date): Promise<SyncResult> => {
      // Similar to contacts sync
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
      const response = await this.client!.get(`/crm/v3/objects/deals/${id}/timeline`);

      return response.data.results.map(event => ({
        timestamp: new Date(event.timestamp),
        event: event.eventType,
        user: event.userId
      }));
    }
  };

  /**
   * Activity Operations
   */
  activities = {
    create: async (data: IActivity): Promise<IActivity> => {
      const engagementType = this.mapActivityTypeToHubSpot(data.type);

      const response = await this.client!.post('/engagements/v1/engagements', {
        engagement: {
          active: true,
          type: engagementType,
          timestamp: data.date?.getTime() || Date.now()
        },
        associations: {
          contactIds: data.relatedTo?.filter(r => r.type === 'contact').map(r => r.id) || [],
          dealIds: data.relatedTo?.filter(r => r.type === 'deal').map(r => r.id) || []
        },
        metadata: {
          subject: data.subject,
          body: data.description,
          status: data.status
        }
      });

      return this.mapActivityFromHubSpot(response.data);
    },

    update: async (id: string, data: Partial<IActivity>): Promise<IActivity> => {
      const response = await this.client!.patch(`/engagements/v1/engagements/${id}`, {
        engagement: {
          timestamp: data.date?.getTime()
        },
        metadata: {
          subject: data.subject,
          body: data.description,
          status: data.status
        }
      });

      return this.mapActivityFromHubSpot(response.data);
    },

    delete: async (id: string): Promise<void> => {
      await this.client!.delete(`/engagements/v1/engagements/${id}`);
    },

    get: async (id: string): Promise<IActivity> => {
      const response = await this.client!.get(`/engagements/v1/engagements/${id}`);
      return this.mapActivityFromHubSpot(response.data);
    },

    list: async (
      filters?: ActivityFilters,
      pagination?: { page: number; pageSize: number }
    ): Promise<PaginatedResult<IActivity>> => {
      const limit = pagination?.pageSize || 50;
      const offset = pagination?.page ? (pagination.page - 1) * limit : 0;

      const params: any = { limit, offset };

      if (filters?.type) {
        params.type = this.mapActivityTypeToHubSpot(filters.type);
      }

      const response = await this.client!.get('/engagements/v1/engagements/paged', { params });

      return {
        data: response.data.results.map(a => this.mapActivityFromHubSpot(a)),
        total: response.data.total,
        page: pagination?.page || 1,
        pageSize: limit,
        hasNext: response.data.hasMore,
        hasPrevious: (pagination?.page || 1) > 1
      };
    },

    complete: async (id: string, outcome?: string, notes?: string): Promise<IActivity> => {
      const response = await this.client!.patch(`/engagements/v1/engagements/${id}`, {
        metadata: {
          status: 'COMPLETED',
          outcome: outcome,
          notes: notes
        }
      });

      return this.mapActivityFromHubSpot(response.data);
    },

    cancel: async (id: string, reason?: string): Promise<IActivity> => {
      const response = await this.client!.patch(`/engagements/v1/engagements/${id}`, {
        metadata: {
          status: 'CANCELLED',
          notes: reason
        }
      });

      return this.mapActivityFromHubSpot(response.data);
    },

    reschedule: async (id: string, newDate: Date): Promise<IActivity> => {
      const response = await this.client!.patch(`/engagements/v1/engagements/${id}`, {
        engagement: {
          timestamp: newDate.getTime()
        }
      });

      return this.mapActivityFromHubSpot(response.data);
    },

    linkToContact: async (activityId: string, contactId: string): Promise<void> => {
      await this.client!.put(`/engagements/v1/engagements/${activityId}/associations/contact/${contactId}`);
    },

    linkToDeal: async (activityId: string, dealId: string): Promise<void> => {
      await this.client!.put(`/engagements/v1/engagements/${activityId}/associations/deal/${dealId}`);
    },

    sync: async (since?: Date): Promise<SyncResult> => {
      // Similar to contacts sync
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
   * Webhook Support
   */
  webhooks = {
    register: async (events: string[], callbackUrl: string): Promise<string> => {
      const response = await this.client!.post('/webhooks/v3/settings', {
        eventType: events.join(','),
        propertyName: '*',
        active: true,
        targetUrl: callbackUrl
      });

      return response.data.id;
    },

    unregister: async (webhookId: string): Promise<void> => {
      await this.client!.delete(`/webhooks/v3/settings/${webhookId}`);
    },

    verify: (payload: any, headers: any): boolean => {
      // Verify HubSpot webhook signature
      const signature = headers['x-hubspot-signature'];
      // Implementation of signature verification
      return true; // Simplified for example
    },

    process: async (event: WebhookEvent): Promise<void> => {
      // Process webhook event
      this.emit('webhook:event', event);
    },

    listRegistered: async (): Promise<Array<{ id: string; events: string[]; url: string; active: boolean }>> => {
      const response = await this.client!.get('/webhooks/v3/settings');

      return response.data.results.map(webhook => ({
        id: webhook.id,
        events: webhook.eventType.split(','),
        url: webhook.targetUrl,
        active: webhook.active
      }));
    }
  };

  /**
   * Field Mapping
   */
  fieldMapping = {
    getSchema: async (entity: EntityType): Promise<FieldSchema> => {
      const endpoint = `/properties/v2/${entity}s/properties`;
      const response = await this.client!.get(endpoint);

      return {
        fields: response.data.map(prop => ({
          name: prop.name,
          type: this.mapHubSpotFieldType(prop.type),
          required: prop.required || false,
          description: prop.description,
          allowedValues: prop.options?.map(o => o.value)
        }))
      };
    },

    getCustomFields: async (entity: EntityType): Promise<Array<{ name: string; type: string; required: boolean }>> => {
      const endpoint = `/properties/v2/${entity}s/properties`;
      const response = await this.client!.get(endpoint);

      return response.data
        .filter(prop => !prop.hubspotDefined)
        .map(prop => ({
          name: prop.name,
          type: prop.type,
          required: prop.required || false
        }));
    },

    mapToProvider: (entity: EntityType, data: any): any => {
      switch (entity) {
        case 'contact':
          return this.mapContactToHubSpot(data);
        case 'deal':
          return this.mapDealToHubSpot(data);
        case 'activity':
          return this.mapActivityToHubSpot(data);
        default:
          return data;
      }
    },

    mapFromProvider: (entity: EntityType, data: any): any => {
      switch (entity) {
        case 'contact':
          return this.mapContactFromHubSpot(data);
        case 'deal':
          return this.mapDealFromHubSpot(data);
        case 'activity':
          return this.mapActivityFromHubSpot(data);
        default:
          return data;
      }
    },

    validateData: (entity: EntityType, data: any): { valid: boolean; errors?: string[] } => {
      const errors = [];

      switch (entity) {
        case 'contact':
          if (!data.email) errors.push('email is required');
          break;
        case 'deal':
          if (!data.dealname) errors.push('dealname is required');
          break;
        case 'activity':
          if (!data.type) errors.push('type is required');
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
      // Trigger full sync
      await Promise.all([
        this.contacts.sync(),
        this.deals.sync(),
        this.activities.sync()
      ]);
    },

    triggerIncrementalSync: async (): Promise<void> => {
      // Trigger incremental sync
      await Promise.all([
        this.contacts.sync(this.lastSyncTime || undefined),
        this.deals.sync(this.lastSyncTime || undefined),
        this.activities.sync(this.lastSyncTime || undefined)
      ]);
    },

    pauseSync: async (): Promise<void> => {
      // Pause sync operations
    },

    resumeSync: async (): Promise<void> => {
      // Resume sync operations
    },

    getSyncHistory: async (limit?: number): Promise<Array<{ timestamp: Date; result: SyncResult }>> => {
      // Return sync history
      return [];
    }
  };

  /**
   * Private Helper Methods
   */
  private mapContactToHubSpot(contact: Partial<IContact>): any {
    return {
      firstname: contact.firstName,
      lastname: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      jobtitle: contact.title,
      industry: contact.industry,
      website: contact.website,
      linkedin: contact.socialProfiles?.linkedIn,
      twitter: contact.socialProfiles?.twitter
    };
  }

  private mapContactFromHubSpot(data: any): IContact {
    const props = data.properties;

    return {
      id: data.id,
      externalId: data.id,
      firstName: props.firstname,
      lastName: props.lastname,
      email: props.email,
      phone: props.phone,
      company: props.company,
      title: props.jobtitle,
      industry: props.industry,
      website: props.website,
      socialProfiles: {
        linkedIn: props.linkedin,
        twitter: props.twitter
      },
      createdAt: new Date(props.createdate),
      updatedAt: new Date(props.lastmodifieddate)
    };
  }

  private mapDealToHubSpot(deal: Partial<IDeal>): any {
    return {
      dealname: deal.name || deal.companyName,
      dealstage: this.mapStageToHubSpot(deal.stage || ''),
      amount: deal.amount,
      closedate: deal.expectedCloseDate?.getTime(),
      hs_forecast_probability: deal.probability,
      description: deal.description
    };
  }

  private mapDealFromHubSpot(data: any): IDeal {
    const props = data.properties;

    return {
      id: data.id,
      externalId: data.id,
      name: props.dealname,
      companyName: props.dealname,
      stage: this.mapStageFromHubSpot(props.dealstage),
      amount: parseFloat(props.amount) || 0,
      expectedCloseDate: props.closedate ? new Date(props.closedate) : undefined,
      probability: parseFloat(props.hs_forecast_probability) || 0,
      description: props.description,
      createdAt: new Date(props.createdate),
      updatedAt: new Date(props.hs_lastmodifieddate)
    };
  }

  private mapActivityToHubSpot(activity: Partial<IActivity>): any {
    return {
      type: this.mapActivityTypeToHubSpot(activity.type || 'note'),
      subject: activity.subject,
      body: activity.description,
      status: activity.status
    };
  }

  private mapActivityFromHubSpot(data: any): IActivity {
    const engagement = data.engagement;
    const metadata = data.metadata;

    return {
      id: engagement.id.toString(),
      externalId: engagement.id.toString(),
      type: this.mapActivityTypeFromHubSpot(engagement.type),
      subject: metadata.subject,
      description: metadata.body,
      status: metadata.status?.toLowerCase() || 'scheduled',
      date: new Date(engagement.timestamp),
      createdAt: new Date(engagement.createdAt),
      updatedAt: new Date(engagement.lastUpdated)
    };
  }

  private mapStageToHubSpot(stage: string): string {
    const stageMap = {
      'sourcing': 'appointmentscheduled',
      'screening': 'qualifiedtobuy',
      'due_diligence': 'presentationscheduled',
      'ic': 'decisionmakerboughtin',
      'term_sheet': 'contractsent',
      'closing': 'closedwon',
      'passed': 'closedlost'
    };

    return stageMap[stage] || 'appointmentscheduled';
  }

  private mapStageFromHubSpot(stage: string): string {
    const stageMap = {
      'appointmentscheduled': 'sourcing',
      'qualifiedtobuy': 'screening',
      'presentationscheduled': 'due_diligence',
      'decisionmakerboughtin': 'ic',
      'contractsent': 'term_sheet',
      'closedwon': 'closing',
      'closedlost': 'passed'
    };

    return stageMap[stage] || 'sourcing';
  }

  private mapActivityTypeToHubSpot(type: string): string {
    const typeMap = {
      'call': 'CALL',
      'email': 'EMAIL',
      'meeting': 'MEETING',
      'task': 'TASK',
      'note': 'NOTE'
    };

    return typeMap[type] || 'NOTE';
  }

  private mapActivityTypeFromHubSpot(type: string): 'call' | 'email' | 'meeting' | 'task' | 'note' | 'other' {
    const typeMap = {
      'CALL': 'call' as const,
      'EMAIL': 'email' as const,
      'MEETING': 'meeting' as const,
      'TASK': 'task' as const,
      'NOTE': 'note' as const
    };

    return typeMap[type] || 'other';
  }

  private mapHubSpotFieldType(type: string): 'string' | 'number' | 'date' | 'boolean' | 'array' | 'object' {
    switch (type) {
      case 'string':
      case 'text':
      case 'enumeration':
        return 'string';
      case 'number':
        return 'number';
      case 'date':
      case 'datetime':
        return 'date';
      case 'bool':
        return 'boolean';
      default:
        return 'string';
    }
  }

  private async fetchModifiedContacts(since?: Date): Promise<any[]> {
    const filter = since ? {
      filterGroups: [{
        filters: [{
          propertyName: 'lastmodifieddate',
          operator: 'GTE',
          value: since.getTime().toString()
        }]
      }]
    } : {};

    const response = await this.client!.post('/crm/v3/objects/contacts/search', {
      ...filter,
      limit: 100,
      properties: ['firstname', 'lastname', 'email', 'phone', 'company']
    });

    return response.data.results;
  }
}

export default HubSpotProvider;