import { httpsCallable, type Functions } from 'firebase/functions';
import { getFirebaseFunctions } from '../../../lib/firebaseFunctions';
import type {
  ContactMemberInquiryPayload,
  ContactPublicInquiryPayload,
  NotificationActionResult,
  NotificationDelivery,
  NotificationsAdminFilters,
} from '../domain/models';

const CALLABLE_NAMES = {
  markRead: 'notificationsMarkRead',
  dismiss: 'notificationsDismiss',
  executeAction: 'notificationsExecuteAction',
  listAdmin: 'notificationsListAdmin',
  submitPublicInquiry: 'contactSubmitPublicInquiry',
  submitMemberInquiry: 'contactSubmitMemberInquiry',
} as const;

function getNotificationsFunctions(functionsInstance?: Functions): Functions {
  return getFirebaseFunctions(functionsInstance);
}

function normalizeAdminFilters(filters: NotificationsAdminFilters) {
  return {
    ...filters,
    status: filters.status === 'all' ? undefined : filters.status,
    roleId: filters.roleId === 'all' ? undefined : filters.roleId,
  };
}

export function createNotificationsCallables(functionsInstance?: Functions) {
  const functionsRef = getNotificationsFunctions(functionsInstance);

  return {
    async markRead(deliveryId: string) {
      return (await httpsCallable<{ deliveryId: string }, { deliveryId: string; status: string }>(
        functionsRef,
        CALLABLE_NAMES.markRead,
      )({ deliveryId })).data;
    },
    async dismiss(deliveryId: string) {
      return (await httpsCallable<{ deliveryId: string }, { deliveryId: string; status: string }>(
        functionsRef,
        CALLABLE_NAMES.dismiss,
      )({ deliveryId })).data;
    },
    async executeAction(deliveryId: string) {
      return (await httpsCallable<{ deliveryId: string }, NotificationActionResult>(
        functionsRef,
        CALLABLE_NAMES.executeAction,
      )({ deliveryId })).data;
    },
    async listAdmin(filters: NotificationsAdminFilters = {}) {
      return (await httpsCallable<Record<string, unknown>, { items: NotificationDelivery[] }>(
        functionsRef,
        CALLABLE_NAMES.listAdmin,
      )(normalizeAdminFilters(filters) as Record<string, unknown>)).data;
    },
    async submitPublicInquiry(payload: ContactPublicInquiryPayload) {
      return (await httpsCallable<ContactPublicInquiryPayload, { inquiryId: string }>(
        functionsRef,
        CALLABLE_NAMES.submitPublicInquiry,
      )(payload)).data;
    },
    async submitMemberInquiry(payload: ContactMemberInquiryPayload) {
      return (await httpsCallable<ContactMemberInquiryPayload, { inquiryId: string }>(
        functionsRef,
        CALLABLE_NAMES.submitMemberInquiry,
      )(payload)).data;
    },
  };
}

export type NotificationsCallableApi = ReturnType<typeof createNotificationsCallables>;
