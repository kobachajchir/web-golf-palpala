import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { firestore } from '../../../lib/firebase';
import type { NotificationDelivery, NotificationDeliveryDocument } from '../domain/models';

const NOTIFICATION_DELIVERIES_COLLECTION = 'notification_deliveries';

function normalizeDelivery(id: string, data: NotificationDeliveryDocument): NotificationDelivery {
  return {
    ...data,
    id,
    attachments: data.attachments ?? [],
    recipientRoleIds: data.recipientRoleIds ?? [],
    action: data.action ?? null,
  };
}

export function useNotifications(userId: string | null | undefined) {
  const [items, setItems] = useState<NotificationDelivery[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firestore || !userId) {
      setItems([]);
      setUnreadCount(0);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError('');
    const deliveriesRef = collection(firestore, NOTIFICATION_DELIVERIES_COLLECTION);
    const recentQuery = query(
      deliveriesRef,
      where('recipientUserId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(8),
    );
    const unreadQuery = query(
      deliveriesRef,
      where('recipientUserId', '==', userId),
      where('status', '==', 'unread'),
      orderBy('createdAt', 'desc'),
      limit(99),
    );

    const unsubscribeRecent = onSnapshot(
      recentQuery,
      (snapshot) => {
        setItems(snapshot.docs.map((entry) => normalizeDelivery(entry.id, entry.data() as NotificationDeliveryDocument)));
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setItems([]);
        setLoading(false);
      },
    );

    const unsubscribeUnread = onSnapshot(
      unreadQuery,
      (snapshot) => {
        setUnreadCount(snapshot.size);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setUnreadCount(0);
      },
    );

    return () => {
      unsubscribeRecent();
      unsubscribeUnread();
    };
  }, [userId]);

  return useMemo(
    () => ({
      items,
      unreadCount,
      loading,
      error,
    }),
    [error, items, loading, unreadCount],
  );
}
