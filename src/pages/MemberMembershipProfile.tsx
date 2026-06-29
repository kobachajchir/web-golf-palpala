import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { CompactDetailsToggle } from '../components/CompactDetailsToggle';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DescriptionList } from '../components/DescriptionList';
import { IconActionMenu } from '../components/IconActionMenu';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PersonProfileHeader } from '../components/PersonProfileHeader';
import { RoleChipList } from '../components/RoleChipList';
import { TemporaryCredentialsDialog } from '../components/TemporaryCredentialsDialog';
import { UiActionButton } from '../components/UiActionButton';
import { normalizeRoleIds, ROLE_LABELS, ROLES, type RoleType } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type { EntityWithId as AccountingEntityWithId, MemberFeeChargeDocument } from '../modules/accounting/domain/models';
import { createAccountingCallables } from '../modules/accounting/functions/accounting.callables';
import { createMemberFeeChargesRepository } from '../modules/accounting/infrastructure/firestore/repositories';
import { createNotificationsCallables } from '../modules/notifications/functions/notifications.callables';
import { createUsersCallables } from '../modules/users/functions/users.callables';
import type { EntityWithId, MemberDocument } from '../modules/users/domain/models';
import { createMembersRepository } from '../modules/users/infrastructure/firestore/repositories';
import {
  getClubMemberById,
  getClubMemberHousehold,
  type ClubMemberRecord,
} from '../modules/users/services/memberDirectory';
import type { MemberAuthStatus } from '../modules/users/types/user.types';
import type { TemporaryMemberCredentials } from '../modules/users/types/user.types';

const STAFF_MODE_OPTIONS = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO] as const;
const LICENSE_MAX_MONTHS = 6;
const ASSIGNABLE_ROLE_OPTIONS: RoleType[] = [
  ROLES.DIRECTIVO,
  ROLES.ADMINISTRATIVO,
  ROLES.EMPLEADO,
  ROLES.COMISION_DIRECTIVA,
  ROLES.SOCIO,
];

type TimestampLike = {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

function timestampToDate(value: TimestampLike | string | Date | number | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  const seconds = typeof value.seconds === 'number' ? value.seconds : value._seconds;
  if (typeof seconds === 'number') {
    const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : value._nanoseconds ?? 0;
    return new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
  }

  return null;
}

function formatDate(value: TimestampLike | string | Date | number | null | undefined): string {
  const date = timestampToDate(value);
  return date ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(date) : 'Sin registrar';
}

function formatCurrency(amountMinor: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function addMonths(date: Date, months: number): Date {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function formatElapsedTime(startDate: Date, endDate = new Date()): string {
  const elapsedDays = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000));
  const months = Math.floor(elapsedDays / 30);
  const days = elapsedDays % 30;

  if (months <= 0) {
    return `${days} días`;
  }

  return `${months} meses${days ? ` y ${days} días` : ''}`;
}

function buildMembershipSummary(member: ClubMemberRecord, memberDocument: EntityWithId<MemberDocument> | null) {
  const today = new Date();
  const isLifetime = member.memberTypeId === 'vitalicio' || memberDocument?.typeCodeSnapshot === 'vitalicio';
  const isLicense = member.status === 'license';
  const lastPaymentDate = timestampToDate(memberDocument?.lastFeePaymentAt);
  const validUntilDate = timestampToDate(memberDocument?.membershipRenewalDueAt);
  const licenseStartDate = timestampToDate(memberDocument?.licenseStartAt);
  const licenseLimitDate = licenseStartDate ? addMonths(licenseStartDate, LICENSE_MAX_MONTHS) : timestampToDate(memberDocument?.licenseEndAt);
  const isExpired = Boolean(validUntilDate && validUntilDate < today);
  const daysUntilDue = validUntilDate
    ? Math.ceil((validUntilDate.getTime() - today.getTime()) / 86_400_000)
    : null;

  if (isLifetime) {
    return {
      statusLabel: 'Vitalicio: la membresía no vence',
      lastPaymentLabel: lastPaymentDate ? formatDate(lastPaymentDate) : 'No requiere renovación mensual',
      validUntilLabel: 'Sin vencimiento',
      licenseElapsedLabel: null,
      licenseLimitLabel: null,
      licenseLimitReached: false,
    };
  }

  if (isLicense) {
    return {
      statusLabel: 'En licencia',
      lastPaymentLabel: lastPaymentDate ? formatDate(lastPaymentDate) : 'Sin pagos registrados',
      validUntilLabel: validUntilDate ? formatDate(validUntilDate) : 'Pausada por licencia',
      licenseElapsedLabel: licenseStartDate ? formatElapsedTime(licenseStartDate, today) : 'Fecha de inicio no informada',
      licenseLimitLabel: licenseLimitDate ? formatDate(licenseLimitDate) : 'No informado',
      licenseLimitReached: Boolean(licenseLimitDate && licenseLimitDate <= today),
    };
  }

  return {
    statusLabel: isExpired
      ? 'Membresía vencida'
      : daysUntilDue !== null && daysUntilDue <= 15
        ? `Próxima a vencer el ${formatDate(validUntilDate)}`
        : member.active
          ? 'Activa'
          : 'No activa',
    lastPaymentLabel: lastPaymentDate ? formatDate(lastPaymentDate) : 'Sin pagos registrados',
    validUntilLabel: validUntilDate ? formatDate(validUntilDate) : 'Sin vencimiento informado',
    licenseElapsedLabel: null,
    licenseLimitLabel: null,
    licenseLimitReached: false,
  };
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M12 5c4.97 0 9.16 3.07 10.75 7.41a1.1 1.1 0 0 1 0 .76C21.16 17.5 16.97 20.57 12 20.57S2.84 17.5 1.25 13.17a1.1 1.1 0 0 1 0-.76C2.84 8.07 7.03 5 12 5Zm0 2c-3.95 0-7.32 2.37-8.72 5.79 1.4 3.42 4.77 5.78 8.72 5.78s7.32-2.36 8.72-5.78C19.32 9.37 15.95 7 12 7Zm0 1.75A4.05 4.05 0 1 1 7.95 12.8 4.05 4.05 0 0 1 12 8.75Zm0 2A2.05 2.05 0 1 0 14.05 12.8 2.05 2.05 0 0 0 12 10.75Z" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M10.7 5.3a1 1 0 0 1 0 1.4L6.42 11H20a1 1 0 1 1 0 2H6.42l4.28 4.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M5 10.75A1.25 1.25 0 1 1 5 13.25a1.25 1.25 0 0 1 0-2.5Zm7 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm7 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6z" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M5 11h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2Z" />
    </svg>
  );
}

export function MemberMembershipProfile() {
  const { memberId } = useParams();
  const [searchParams] = useSearchParams();
  const { user, hasRole, interfaceMode } = useAuth();
  const [member, setMember] = useState<ClubMemberRecord | null>(null);
  const [memberDocument, setMemberDocument] = useState<EntityWithId<MemberDocument> | null>(null);
  const [feeCharges, setFeeCharges] = useState<Array<AccountingEntityWithId<MemberFeeChargeDocument>>>([]);
  const [household, setHousehold] = useState<ClubMemberRecord[]>([]);
  const [authStatus, setAuthStatus] = useState<MemberAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessMessage, setAccessMessage] = useState('');
  const [openHouseholdActionsId, setOpenHouseholdActionsId] = useState<string | null>(null);
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
  const [isRemoveRoleDropdownOpen, setIsRemoveRoleDropdownOpen] = useState(false);
  const [memberPendingFamilyRemoval, setMemberPendingFamilyRemoval] = useState<ClubMemberRecord | null>(null);
  const [credentialsDialog, setCredentialsDialog] = useState<{
    title: string;
    credentials: TemporaryMemberCredentials;
  } | null>(null);
  const [memberInquiryForm, setMemberInquiryForm] = useState({
    subject: '',
    message: '',
  });
  const [memberInquiryError, setMemberInquiryError] = useState('');
  const [memberInquirySuccess, setMemberInquirySuccess] = useState('');
  const [isMemberInquirySubmitting, setIsMemberInquirySubmitting] = useState(false);
  const accountingCallables = useMemo(() => createAccountingCallables(), []);
  const notificationsCallables = useMemo(() => createNotificationsCallables(), []);
  const usersCallables = useMemo(() => createUsersCallables(), []);
  const resolvedMemberId = memberId ?? (user?.profileType === 'member' ? user.profileId ?? undefined : undefined);
  const actorMemberId = user?.profileType === 'member' ? user.profileId ?? null : null;
  const canManageMembership = (STAFF_MODE_OPTIONS as readonly string[]).includes(interfaceMode);
  const isDirectivo = hasRole(ROLES.DIRECTIVO) && interfaceMode === ROLES.DIRECTIVO;
  const canSubmitMemberInquiry = Boolean(actorMemberId && resolvedMemberId && actorMemberId === resolvedMemberId);
  const requestedFocus = searchParams.get('focus');

  const loadMembershipData = useCallback(async () => {
    if (!resolvedMemberId) {
      setLoading(false);
      return;
    }

    const [loadedMember, loadedMemberDocument, loadedFeeCharges, loadedHousehold, loadedAuthStatus] = await Promise.all([
      getClubMemberById(resolvedMemberId),
      createMembersRepository().getById(resolvedMemberId).catch(() => null),
      createMemberFeeChargesRepository().listByMember(resolvedMemberId).catch(() => []),
      getClubMemberHousehold(resolvedMemberId).catch(() => []),
      canManageMembership ? usersCallables.getMemberAuthStatus({ memberId: resolvedMemberId }).catch(() => null) : Promise.resolve(null),
    ]);

    setMember(loadedMember);
    setMemberDocument(loadedMemberDocument);
    setFeeCharges(loadedFeeCharges);
    setHousehold(loadedHousehold);
    setAuthStatus(loadedAuthStatus);
    setLoading(false);
  }, [canManageMembership, resolvedMemberId, usersCallables]);

  useEffect(() => {
    let mounted = true;

    if (!resolvedMemberId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    void loadMembershipData()
      .then(() => {
        if (!mounted) {
          return;
        }
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        setMember(null);
        setMemberDocument(null);
        setFeeCharges([]);
        setHousehold([]);
        setAuthStatus(null);
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loadMembershipData, resolvedMemberId]);

  useEffect(() => {
    if (loading || !requestedFocus) {
      return;
    }

    const focusIdByKey: Record<string, string> = {
      payments: 'membership-payments',
      family: 'membership-family',
      actions: 'membership-actions',
    };
    const focusId = focusIdByKey[requestedFocus];

    if (!focusId) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(focusId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [loading, requestedFocus]);

  const refreshAuthStatus = async () => {
    if (!resolvedMemberId || !canManageMembership) {
      return;
    }

    setAuthStatus(await usersCallables.getMemberAuthStatus({ memberId: resolvedMemberId }));
  };

  const handleCreateAccess = async () => {
    if (!resolvedMemberId || !canManageMembership) {
      return;
    }

    setAccessLoading(true);
    setAccessMessage('');

    try {
      const result = await usersCallables.createMemberAuthUser({
        memberId: resolvedMemberId,
        roleIds: [ROLES.SOCIO],
        active: true,
      });
      if (result.temporaryPassword) {
        setCredentialsDialog({
          title: 'Usuario creado',
          credentials: {
            memberNumber: result.memberNumber,
            temporaryPassword: result.temporaryPassword,
            passwordGeneratedAt: result.passwordGeneratedAt,
          },
        });
      }
      setAccessMessage('Acceso creado. En el siguiente ingreso debera cambiar la clave temporal.');
      await refreshAuthStatus();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos crear el acceso.');
    } finally {
      setAccessLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resolvedMemberId || !canManageMembership) {
      return;
    }

    setAccessLoading(true);
    setAccessMessage('');

    try {
      const result = await usersCallables.resetMemberAuthPassword({ memberId: resolvedMemberId });
      if (result.temporaryPassword) {
        setCredentialsDialog({
          title: 'Contraseña restablecida',
          credentials: {
            memberNumber: result.memberNumber ?? member?.memberNumber ?? resolvedMemberId,
            temporaryPassword: result.temporaryPassword,
            passwordGeneratedAt: result.passwordGeneratedAt,
          },
        });
      }
      setAccessMessage('Clave temporal restablecida. En el siguiente ingreso debera cambiarla.');
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos resetear la clave.');
    } finally {
      setAccessLoading(false);
    }
  };

  const handleToggleAccess = async () => {
    if (!resolvedMemberId || !authStatus || !canManageMembership) {
      return;
    }

    const nextActive = authStatus.authDisabled === true || authStatus.userActive === false;
    setAccessLoading(true);
    setAccessMessage('');

    try {
      await usersCallables.setMemberAuthAccessActive({ memberId: resolvedMemberId, active: nextActive });
      setAccessMessage(nextActive ? 'Acceso reactivado.' : 'Acceso deshabilitado.');
      await refreshAuthStatus();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos actualizar el acceso.');
    } finally {
      setAccessLoading(false);
    }
  };

  const handleSyncClaims = async () => {
    if (!authStatus?.linkedUserId || !canManageMembership) {
      return;
    }

    setAccessLoading(true);
    setAccessMessage('');

    try {
      await usersCallables.syncCustomClaims({ uid: authStatus.linkedUserId });
      setAccessMessage('Claims sincronizados.');
      await refreshAuthStatus();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos sincronizar claims.');
    } finally {
      setAccessLoading(false);
    }
  };

  const handleMemberInquiryChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setMemberInquiryForm((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleMemberInquirySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMemberInquiryError('');
    setMemberInquirySuccess('');

    if (!memberInquiryForm.subject.trim() || !memberInquiryForm.message.trim()) {
      setMemberInquiryError('Asunto y mensaje son obligatorios.');
      return;
    }

    setIsMemberInquirySubmitting(true);
    try {
      await notificationsCallables.submitMemberInquiry({
        subject: memberInquiryForm.subject.trim(),
        message: memberInquiryForm.message.trim(),
      });
      setMemberInquiryForm({ subject: '', message: '' });
      setMemberInquirySuccess('Consulta enviada. El equipo administrativo y directivo la vera en notificaciones.');
    } catch (error) {
      setMemberInquiryError(error instanceof Error ? error.message : 'No pudimos enviar la consulta.');
    } finally {
      setIsMemberInquirySubmitting(false);
    }
  };

  const assignedRoleOptions = useMemo(() => normalizeRoleIds(authStatus?.roleIds ?? []), [authStatus?.roleIds]);
  const missingRoleOptions = useMemo(() => {
    const assignedRoleIds = new Set(assignedRoleOptions);
    return ASSIGNABLE_ROLE_OPTIONS.filter((roleId) => !assignedRoleIds.has(roleId));
  }, [assignedRoleOptions]);
  const isAddRoleDisabled = accessLoading || missingRoleOptions.length === 0;
  const isRemoveRoleDisabled = accessLoading || assignedRoleOptions.length <= 1;

  useEffect(() => {
    if (missingRoleOptions.length === 0) {
      setIsRoleDropdownOpen(false);
    }
    if (assignedRoleOptions.length <= 1) {
      setIsRemoveRoleDropdownOpen(false);
    }
  }, [assignedRoleOptions.length, missingRoleOptions.length]);

  const handleAddRole = async (roleId: RoleType) => {
    if (!authStatus?.linkedUserId || !isDirectivo) {
      return;
    }

    const currentRoles = assignedRoleOptions.length > 0 ? assignedRoleOptions : [ROLES.SOCIO];
    if (currentRoles.includes(roleId)) {
      setIsRoleDropdownOpen(false);
      return;
    }

    const nextRoles = Array.from(new Set([...currentRoles, roleId]));

    setAccessLoading(true);
    setAccessMessage('');

    try {
      await usersCallables.assignRole({ uid: authStatus.linkedUserId, roleIds: nextRoles });
      setIsRoleDropdownOpen(false);
      setAccessMessage(`Rol ${ROLE_LABELS[roleId]} asignado y claims sincronizados.`);
      await refreshAuthStatus();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos actualizar roles.');
    } finally {
      setAccessLoading(false);
    }
  };

  const handleRemoveRole = async (roleId: RoleType) => {
    if (!authStatus?.linkedUserId || !isDirectivo || assignedRoleOptions.length <= 1) {
      return;
    }

    const nextRoles = assignedRoleOptions.filter((currentRoleId) => currentRoleId !== roleId);
    if (nextRoles.length === assignedRoleOptions.length || nextRoles.length === 0) {
      setIsRemoveRoleDropdownOpen(false);
      return;
    }

    setAccessLoading(true);
    setAccessMessage('');

    try {
      await usersCallables.assignRole({ uid: authStatus.linkedUserId, roleIds: nextRoles });
      setIsRemoveRoleDropdownOpen(false);
      setAccessMessage(`Rol ${ROLE_LABELS[roleId]} eliminado y claims sincronizados.`);
      await refreshAuthStatus();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos actualizar roles.');
    } finally {
      setAccessLoading(false);
    }
  };

  const handleConfirmFamilyRemoval = async () => {
    if (!memberPendingFamilyRemoval?.familyGroupId) {
      return;
    }

    setAccessLoading(true);
    setAccessMessage('');

    try {
      const remainingMembers = household.filter((relative) => relative.id !== memberPendingFamilyRemoval.id);
      const replacementHolderMemberId =
        holderMember?.id === memberPendingFamilyRemoval.id && remainingMembers.length >= 2
          ? remainingMembers[0]?.id
          : undefined;

      await usersCallables.removeMemberFromFamilyGroup({
        groupId: memberPendingFamilyRemoval.familyGroupId,
        memberId: memberPendingFamilyRemoval.id,
        ...(replacementHolderMemberId ? { replacementHolderMemberId } : {}),
      });
      setMemberPendingFamilyRemoval(null);
      setOpenHouseholdActionsId(null);
      setAccessMessage('Integrante eliminado del grupo familiar y convertido a socio pleno.');
      await loadMembershipData();
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos eliminar el integrante del grupo familiar.');
    } finally {
      setAccessLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-state">
        <span className="loading-spinner" />
        <strong>Obteniendo datos</strong>
      </div>
    );
  }

  if (!member) {
    return <div className="empty-state">No encontramos esa membresia.</div>;
  }

  const holderMember =
    household.find((relative) => relative.id === member.familyHolderMemberId) ??
    household.find((relative) => relative.isFamilyHolder) ??
    null;
  const hasFamilyGroup = Boolean(member.familyGroupId || household.length > 1);
  const membershipSummary = buildMembershipSummary(member, memberDocument);
  const membershipPaymentStatus =
    member.status === 'suspended'
      ? 'Pago no disponible'
      : member.status === 'inactive'
        ? 'Cancelado'
        : membershipSummary.statusLabel.includes('vencida')
          ? 'Pendiente de pago'
          : 'Al dia';
  const membershipPaymentAvailability =
    member.status === 'suspended'
      ? 'Suspendido: no cuenta tiempos de pago'
      : member.status === 'inactive'
        ? 'Baja administrativa sin conteo de pagos'
        : member.status === 'license'
          ? 'Licencia: pago pausado'
          : 'Disponible';
  const payableFeeCharges = feeCharges.filter((charge) => charge.status === 'pending' || charge.status === 'overdue');
  const payableFeeTotalMinor = payableFeeCharges.reduce((total, charge) => total + charge.finalAmountMinor, 0);
  const isActorFamilyHolder = Boolean(actorMemberId && holderMember?.id === actorMemberId);
  const canOpenFamilyActions = (relative: ClubMemberRecord) => {
    if (!relative.familyGroupId) {
      return false;
    }

    if (canManageMembership) {
      return true;
    }

    if (isActorFamilyHolder && relative.id !== actorMemberId) {
      return true;
    }

    return relative.id === actorMemberId && !relative.isFamilyHolder;
  };
  const familyRemovalLabel =
    memberPendingFamilyRemoval?.id === actorMemberId && !canManageMembership
      ? 'Salir del grupo familiar'
      : 'Eliminar del grupo familiar';
  const accessStatusLabel = authStatus?.hasAuthUser
    ? (authStatus.authDisabled || authStatus.userActive === false ? 'Acceso deshabilitado' : 'Acceso activo')
    : 'Sin acceso creado';
  const statusBadgeClass = member.active ? 'status-pill status-pill-green' : 'status-pill status-pill--bloqueado';

  const handlePayMembershipChargesWithMercadoPago = async () => {
    if (payableFeeCharges.length === 0) {
      return;
    }

    setAccessLoading(true);
    setAccessMessage('');

    try {
      const checkout = await accountingCallables.createMercadoPagoCheckout({
        items: payableFeeCharges.map((charge) => ({
          sourceType: 'member_fee_charge',
          sourceId: charge.id,
        })),
        notes: `Checkout Mercado Pago generado desde membresia para socio ${member.memberNumber}.`,
      });

      if (checkout.checkoutUrl) {
        window.location.assign(checkout.checkoutUrl);
        return;
      }

      setAccessMessage('Mercado Pago preparo la sesion, pero no devolvio una URL de pago.');
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : 'No pudimos preparar el pago con Mercado Pago.');
    } finally {
      setAccessLoading(false);
    }
  };

  return (
    <div className="page-container profile-page">
      <section className="floating-card membership-profile-card">
        <PersonProfileHeader
          eyebrow="Perfil de membresia"
          title={member.displayName}
          avatarLabel={member.displayName}
          subtitle={
            <span>
              Socio #{member.memberNumber} | {member.memberTypeLabel}
            </span>
          }
          badges={
            <>
              <span className={statusBadgeClass}>{member.active ? 'Activo' : 'No activo'}</span>
              <span className="status-pill">{membershipPaymentStatus}</span>
              {hasFamilyGroup && <span className="status-pill">Grupo familiar</span>}
            </>
          }
          actions={
            canManageMembership ? (
              <UiActionButton to="/admin/members" variant="secondary" icon={<ArrowLeftIcon />}>
                Volver al padron
              </UiActionButton>
            ) : null
          }
        />

        <div className="membership-profile-summary-grid" id="membership-payments">
          <article className="membership-summary-card">
            <span>Estado</span>
            <strong>{membershipPaymentStatus}</strong>
            <small>{membershipPaymentAvailability}</small>
          </article>
          <article className="membership-summary-card">
            <span>Vigencia</span>
            <strong>{membershipSummary.validUntilLabel}</strong>
            <small>Ultimo pago: {membershipSummary.lastPaymentLabel}</small>
          </article>
          <article className="membership-summary-card">
            <span>Deuda</span>
            <strong>{formatCurrency(payableFeeTotalMinor)}</strong>
            <small>{payableFeeCharges.length} cuota{payableFeeCharges.length === 1 ? '' : 's'} pendiente{payableFeeCharges.length === 1 ? '' : 's'}</small>
          </article>
          <article className="membership-summary-card">
            <span>Grupo familiar</span>
            <strong>{hasFamilyGroup ? `${Math.max(household.length, member.householdSize)} integrante${Math.max(household.length, member.householdSize) === 1 ? '' : 's'}` : 'Sin grupo'}</strong>
            <small>{holderMember ? `Titular: ${holderMember.displayName}` : member.familyGroupCode ?? 'Sin titular informado'}</small>
          </article>
          {canManageMembership && (
            <article className="membership-summary-card">
              <span>Acceso</span>
              <strong>{accessStatusLabel}</strong>
              <small>{authStatus?.lastLoginAt ? `Ultimo ingreso: ${formatDate(authStatus.lastLoginAt as TimestampLike)}` : 'Sin ingreso registrado'}</small>
            </article>
          )}
        </div>

        {payableFeeCharges.length > 0 && (
          <article className="membership-panel">
            <div className="accounting-section-header">
              <div>
                <p className="eyebrow">Cuotas pendientes</p>
                <h2>Pagar membresia online</h2>
                <p>
                  Podés pagar {payableFeeCharges.length} cuota{payableFeeCharges.length === 1 ? '' : 's'} junta
                  {payableFeeCharges.length === 1 ? '' : 's'} con Mercado Pago. El cobro definitivo se registra
                  cuando Mercado Pago confirma la acreditacion.
                </p>
              </div>
              <div className="accounting-inline-actions">
                <strong>{formatCurrency(payableFeeTotalMinor)}</strong>
                <UiActionButton
                  variant="positive"
                  disabled={accessLoading || membershipPaymentAvailability !== 'Disponible'}
                  onClick={() => void handlePayMembershipChargesWithMercadoPago()}
                >
                  {accessLoading ? 'Preparando...' : 'Pagar con Mercado Pago'}
                </UiActionButton>
              </div>
            </div>

            <div className="accounting-list">
              {payableFeeCharges.map((charge) => (
                <article key={charge.id} className="accounting-row">
                  <div className="accounting-row__main">
                    <strong>Cuota societaria {charge.period}</strong>
                    <small>Estado {charge.status === 'overdue' ? 'vencida' : 'pendiente'}</small>
                  </div>
                  <div className="accounting-row__meta">
                    <strong>{formatCurrency(charge.finalAmountMinor)}</strong>
                  </div>
                </article>
              ))}
            </div>
          </article>
        )}

        <div className="membership-grid">
          {member.status === 'license' && (
            <article className="membership-panel">
              <p className="eyebrow">Licencia</p>
              <h2>Seguimiento de licencia</h2>
              <div className="membership-panel__list">
                <div>
                  <span>Inicio de licencia</span>
                  <strong>{formatDate(memberDocument?.licenseStartAt)}</strong>
                </div>
                <div>
                  <span>Tiempo transcurrido</span>
                  <strong>{membershipSummary.licenseElapsedLabel ?? 'No informado'}</strong>
                </div>
                <div>
                  <span>Limite de 6 meses</span>
                  <strong>{membershipSummary.licenseLimitLabel ?? 'No informado'}</strong>
                </div>
              </div>

              {membershipSummary.licenseLimitReached && (
                <div className="membership-note">
                  <span>Revision requerida</span>
                  <p>La licencia cumplio el maximo de 6 meses. Corresponde revisar el pase a no activo.</p>
                </div>
              )}
            </article>
          )}

          {canManageMembership && (
            <article className="membership-panel membership-details-panel">
              <p className="eyebrow">Datos internos</p>
              <h2>Resumen administrativo</h2>
              <CompactDetailsToggle>
                <DescriptionList
                  items={[
                    { label: 'Nombre legado', value: member.fullName },
                    { label: 'ID interno', value: member.id },
                    { label: 'Origen', value: member.source === 'legacy-padron' ? 'Padron legado cargado' : 'Registro manual' },
                    {
                      label: 'Ultima actualizacion',
                      value: new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(member.updatedAt)),
                    },
                    { label: 'Matricula AAG', value: member.aagMembershipNumber ?? 'Sin matricula' },
                    { label: 'Cuota deducida', value: member.feeDeductionLabel ?? 'Sin deduccion informada', hidden: member.memberTypeId === 'pleno' },
                  ]}
                />
              </CompactDetailsToggle>

              {member.notes && (
                <div className="membership-note">
                  <span>Observaciones</span>
                  <p>{member.notes}</p>
                </div>
              )}
            </article>
          )}

          {canManageMembership && (
            <article className="membership-panel" id="membership-actions">
              <p className="eyebrow">Acciones</p>
              <h2>Opciones de membresia</h2>

              <DescriptionList
                items={[
                  { label: 'Estado de acceso', value: accessStatusLabel },
                  { label: 'Ultimo ingreso', value: formatDate(authStatus?.lastLoginAt as TimestampLike | string | Date | number | null | undefined) },
                ]}
              />

              {authStatus?.linkedUserId && (
                <div className="membership-role-panel">
                  <div>
                    <span>Roles</span>
                    <RoleChipList roleIds={assignedRoleOptions} />
                    {!isDirectivo && <small>Solo Comite Ejecutivo puede modificar roles.</small>}
                  </div>
                  {isDirectivo && (
                    <div className="access-role-actions">
                      <IconActionMenu
                        label="Agregar rol"
                        icon={<PlusIcon />}
                        open={!isAddRoleDisabled && isRoleDropdownOpen}
                        items={missingRoleOptions.map((roleId) => ({
                          id: roleId,
                          label: ROLE_LABELS[roleId],
                          disabled: accessLoading,
                          onSelect: () => void handleAddRole(roleId),
                        }))}
                        onToggle={() => {
                          if (isAddRoleDisabled) {
                            return;
                          }
                          setIsRemoveRoleDropdownOpen(false);
                          setIsRoleDropdownOpen((current) => !current);
                        }}
                      />
                      <IconActionMenu
                        label="Quitar rol"
                        icon={<MinusIcon />}
                        open={!isRemoveRoleDisabled && isRemoveRoleDropdownOpen}
                        items={assignedRoleOptions.map((roleId) => ({
                          id: roleId,
                          label: ROLE_LABELS[roleId],
                          danger: true,
                          disabled: accessLoading,
                          onSelect: () => void handleRemoveRole(roleId),
                        }))}
                        onToggle={() => {
                          if (isRemoveRoleDisabled) {
                            return;
                          }
                          setIsRoleDropdownOpen(false);
                          setIsRemoveRoleDropdownOpen((current) => !current);
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {accessMessage && (
                <div className="membership-note">
                  <span>Resultado</span>
                  <p>{accessMessage}</p>
                </div>
              )}

              <div className="form-actions membership-action-buttons">
                {!authStatus?.linkedUserId && (
                  <UiActionButton
                    variant="positive"
                    disabled={accessLoading}
                    icon={<span className="membership-action-icon">+</span>}
                    onClick={handleCreateAccess}
                  >
                    Crear acceso
                  </UiActionButton>
                )}
                {authStatus?.linkedUserId && (
                  <>
                    <UiActionButton
                      variant="secondary"
                      disabled={accessLoading}
                      icon={<span className="membership-action-icon">R</span>}
                      onClick={handleResetPassword}
                    >
                      Resetear clave
                    </UiActionButton>
                    <UiActionButton
                      variant={authStatus.authDisabled || authStatus.userActive === false ? 'positive' : 'danger'}
                      disabled={accessLoading}
                      icon={<span className="membership-action-icon">!</span>}
                      onClick={handleToggleAccess}
                    >
                      {authStatus.authDisabled || authStatus.userActive === false ? 'Reactivar acceso' : 'Deshabilitar acceso'}
                    </UiActionButton>
                    <UiActionButton
                      variant="secondary"
                      disabled={accessLoading}
                      icon={<span className="membership-action-icon">OK</span>}
                      onClick={handleSyncClaims}
                    >
                      Sincronizar claims
                    </UiActionButton>
                  </>
                )}
              </div>
            </article>
          )}

          {canSubmitMemberInquiry && (
            <article className="membership-panel member-contact-panel" id="membership-contact">
              <p className="eyebrow">Consulta interna</p>
              <h2>Contactar al club</h2>
              <p className="profile-note">
                Se envia con tus datos de socio para que administracion y directiva puedan responder desde el circuito interno.
              </p>

              {memberInquiryError && <div className="error-message">{memberInquiryError}</div>}
              {memberInquirySuccess && <div className="success-message">{memberInquirySuccess}</div>}

              <form className="member-contact-form" onSubmit={handleMemberInquirySubmit}>
                <label className="form-field" htmlFor="memberInquirySubject">
                  <span>Asunto</span>
                  <input
                    id="memberInquirySubject"
                    name="subject"
                    type="text"
                    value={memberInquiryForm.subject}
                    onChange={handleMemberInquiryChange}
                  />
                </label>

                <label className="form-field" htmlFor="memberInquiryMessage">
                  <span>Mensaje</span>
                  <textarea
                    id="memberInquiryMessage"
                    name="message"
                    value={memberInquiryForm.message}
                    onChange={handleMemberInquiryChange}
                    rows={4}
                  />
                </label>

                <div className="form-actions membership-action-buttons">
                  <UiActionButton type="submit" variant="secondary" disabled={isMemberInquirySubmitting}>
                    {isMemberInquirySubmitting ? 'Enviando...' : 'Enviar consulta'}
                  </UiActionButton>
                </div>
              </form>
            </article>
          )}

          {hasFamilyGroup && (
            <article className="membership-panel" id="membership-family">
              <p className="eyebrow">Membresia vinculada</p>
              <h2>Grupo familiar</h2>

              <div className="household-list">
                {(household.length > 0 ? household : [member]).map((relative) => (
                  <div key={relative.id} className="household-list__item">
                    <div>
                      <strong>{relative.displayName}</strong>
                      <small>
                        ID #{relative.memberNumber} | {relative.memberTypeLabel}
                        {relative.id === member.id ? ' | Perfil actual' : ''}
                      </small>
                    </div>
                    {relative.isFamilyHolder && <span className="status-pill">Titular</span>}
                    <div className="household-list__actions">
                      <Link
                        className="icon-button member-icon-button"
                        aria-label={`Ver perfil de ${relative.displayName}`}
                        to={`/admin/members/${relative.id}`}
                      >
                        <EyeIcon />
                      </Link>
                      {canOpenFamilyActions(relative) && (
                        <div className="member-actions">
                          <button
                            type="button"
                            className={`icon-button member-icon-button ${openHouseholdActionsId === relative.id ? 'icon-button--active' : ''}`}
                            aria-label={`Mas acciones para ${relative.displayName}`}
                            aria-expanded={openHouseholdActionsId === relative.id}
                            onClick={() =>
                              setOpenHouseholdActionsId((current) => (current === relative.id ? null : relative.id))
                            }
                          >
                            <MoreIcon />
                          </button>

                          {openHouseholdActionsId === relative.id && (
                            <div className="member-actions-menu household-actions-menu">
                              <button
                                type="button"
                                className="member-actions-menu__item member-actions-menu__item--danger"
                                onClick={() => {
                                  setOpenHouseholdActionsId(null);
                                  setMemberPendingFamilyRemoval(relative);
                                }}
                              >
                                {relative.id === actorMemberId && !canManageMembership ? 'Salir del grupo familiar' : 'Eliminar del grupo familiar'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <CompactDetailsToggle label="Mas detalles del grupo">
                <DescriptionList
                  items={[
                    { label: 'Codigo de grupo', value: member.familyGroupCode ?? 'Sin codigo' },
                    { label: 'Titular', value: holderMember ? `#${holderMember.memberNumber} ${holderMember.displayName}` : 'No informado' },
                    { label: 'Integrantes', value: String(Math.max(household.length, member.householdSize)) },
                    { label: 'Cuota deducida', value: member.feeDeductionLabel ?? 'Sin deduccion informada' },
                  ]}
                />
              </CompactDetailsToggle>
            </article>
          )}
        </div>
      </section>

      <TemporaryCredentialsDialog
        open={Boolean(credentialsDialog)}
        title={credentialsDialog?.title ?? ''}
        memberNumber={credentialsDialog?.credentials.memberNumber ?? ''}
        temporaryPassword={credentialsDialog?.credentials.temporaryPassword ?? ''}
        onClose={() => setCredentialsDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(memberPendingFamilyRemoval)}
        title={familyRemovalLabel}
        description={
          memberPendingFamilyRemoval ? (
            <>
              Vas a sacar a {memberPendingFamilyRemoval.displayName} del grupo familiar. Al confirmar, esa persona pasa
              automaticamente a socio pleno. Los asociados restantes mantienen la cuota deducida mientras el grupo siga
              activo. Si el grupo queda con menos de dos personas, se cierra y todos pasan a socio pleno.
            </>
          ) : null
        }
        confirmLabel="Continuar"
        tone="danger"
        loading={accessLoading}
        onCancel={() => setMemberPendingFamilyRemoval(null)}
        onConfirm={() => void handleConfirmFamilyRemoval()}
      />
    </div>
  );
}
