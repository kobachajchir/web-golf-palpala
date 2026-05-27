import type { Timestamp } from 'firebase/firestore';
import type { RoleType } from '../../../constants/roles';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger';
export type NotificationDeliveryScope = 'per_user' | 'role_info' | 'shared_role_action';
export type NotificationDeliveryStatus = 'unread' | 'read' | 'dismissed' | 'actioned';

export type NotificationAttachment = {
  id: string;
  label: string;
  url?: string | null;
  contentType?: string | null;
};

export type NotificationAction = {
  key: string;
  label: string;
  requiresConfirmation: boolean;
  route?: string | null;
  payload?: Record<string, unknown>;
};

export type NotificationActorSnapshot = {
  uid: string;
  displayName: string;
  primaryRoleId?: string | null;
  roleIds: string[];
  profileType?: string | null;
  profileId?: string | null;
  memberNumber?: string | null;
};

export type NotificationDeliveryDocument = {
  notificationId: string;
  type: string;
  sourceModule: string;
  sourceCollection?: string | null;
  sourceId?: string | null;
  recipientUserId: string;
  recipientDisplayName?: string | null;
  recipientMemberNumber?: string | null;
  recipientProfileType?: string | null;
  recipientProfileId?: string | null;
  recipientRoleIds: RoleType[];
  titleSnapshot: string;
  bodySnapshot: string;
  severity: NotificationSeverity;
  deliveryScope: NotificationDeliveryScope;
  route?: string | null;
  action?: NotificationAction | null;
  attachments: NotificationAttachment[];
  metadata?: Record<string, unknown>;
  status: NotificationDeliveryStatus;
  readAt?: Timestamp | null;
  readByUid?: string | null;
  readBySnapshot?: NotificationActorSnapshot | null;
  actionedAt?: Timestamp | null;
  actionedByUid?: string | null;
  actionedBySnapshot?: NotificationActorSnapshot | null;
  dismissedAt?: Timestamp | null;
  dismissedByUid?: string | null;
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;
  updatedBy: string;
};

export type NotificationDelivery = NotificationDeliveryDocument & { id: string };

export type ContactPublicInquiryPayload = {
  senderName: string;
  senderEmail?: string | null;
  senderPhone?: string | null;
  subject: string;
  message: string;
};

export type ContactMemberInquiryPayload = {
  subject: string;
  message: string;
};

export type NotificationsAdminFilters = {
  status?: NotificationDeliveryStatus | 'all';
  type?: string;
  roleId?: RoleType | 'all';
  userQuery?: string;
  actionKey?: string;
  limit?: number;
};

export type NotificationActionResult = {
  deliveryId: string;
  notificationId: string;
  status: 'actioned';
  actionKey: string;
  result?: Record<string, unknown>;
};
