import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Link, useParams } from 'react-router-dom';
import { TemporaryCredentialsDialog } from '../components/TemporaryCredentialsDialog';
import { normalizeRoleIds, ROLE_LABELS, ROLES, type RoleType } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
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

function ProfileDataField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="public-profile-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M12 5c4.97 0 9.16 3.07 10.75 7.41a1.1 1.1 0 0 1 0 .76C21.16 17.5 16.97 20.57 12 20.57S2.84 17.5 1.25 13.17a1.1 1.1 0 0 1 0-.76C2.84 8.07 7.03 5 12 5Zm0 2c-3.95 0-7.32 2.37-8.72 5.79 1.4 3.42 4.77 5.78 8.72 5.78s7.32-2.36 8.72-5.78C19.32 9.37 15.95 7 12 7Zm0 1.75A4.05 4.05 0 1 1 7.95 12.8 4.05 4.05 0 0 1 12 8.75Zm0 2A2.05 2.05 0 1 0 14.05 12.8 2.05 2.05 0 0 0 12 10.75Z" />
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

export function MemberMembershipProfile() {
  const { memberId } = useParams();
  const { user, hasRole, interfaceMode } = useAuth();
  const [member, setMember] = useState<ClubMemberRecord | null>(null);
  const [memberDocument, setMemberDocument] = useState<EntityWithId<MemberDocument> | null>(null);
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
  const usersCallables = useMemo(() => createUsersCallables(), []);
  const resolvedMemberId = memberId ?? (user?.profileType === 'member' ? user.profileId ?? undefined : undefined);
  const canManageMembership = (STAFF_MODE_OPTIONS as readonly string[]).includes(interfaceMode);
  const isDirectivo = hasRole(ROLES.DIRECTIVO) && interfaceMode === ROLES.DIRECTIVO;

  const loadMembershipData = useCallback(async () => {
    if (!resolvedMemberId) {
      setLoading(false);
      return;
    }

    const [loadedMember, loadedMemberDocument, loadedHousehold, loadedAuthStatus] = await Promise.all([
      getClubMemberById(resolvedMemberId),
      createMembersRepository().getById(resolvedMemberId).catch(() => null),
      getClubMemberHousehold(resolvedMemberId).catch(() => []),
      canManageMembership ? usersCallables.getMemberAuthStatus({ memberId: resolvedMemberId }).catch(() => null) : Promise.resolve(null),
    ]);

    setMember(loadedMember);
    setMemberDocument(loadedMemberDocument);
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
        setHousehold([]);
        setAuthStatus(null);
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [loadMembershipData, resolvedMemberId]);

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

  const assignedRoleOptions = useMemo(() => normalizeRoleIds(authStatus?.roleIds ?? []), [authStatus?.roleIds]);
  const assignedRoleLabel = assignedRoleOptions.length > 0
    ? assignedRoleOptions.map((roleId) => ROLE_LABELS[roleId]).join(', ')
    : 'Sin roles asignados';
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
  const actorMemberId = user?.profileType === 'member' ? user.profileId ?? null : null;
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

  return (
    <div className="page-container profile-page">
      <section className="floating-card membership-profile-card">
        <div className="public-profile-card__header membership-profile-card__header">
          <div className="public-profile-avatar">{member.displayName.charAt(0).toUpperCase()}</div>

          <div className="public-profile-card__copy">
            <p className="eyebrow">Perfil de membresia</p>
            <h1>{member.displayName}</h1>
            <p className="profile-note">
              Socio #{member.memberNumber} | {member.memberTypeLabel} | {member.active ? 'Activo' : 'Inactivo'}
            </p>
          </div>

          <div className="membership-profile-card__actions">
            {canManageMembership && (
              <Link className="btn-secondary" to="/admin/members">
                Volver al padron
              </Link>
            )}
          </div>
        </div>

        <div className="public-profile-grid membership-profile-grid">
          <ProfileDataField label="Estado de membresia" value={membershipSummary.statusLabel} />
          <ProfileDataField label="Tipo" value={member.memberTypeLabel} />
          <ProfileDataField label="Ultimo pago" value={membershipSummary.lastPaymentLabel} />
          <ProfileDataField label="Vigente hasta" value={membershipSummary.validUntilLabel} />
          <ProfileDataField label="Matricula AAG" value={member.aagMembershipNumber ?? 'Sin matricula'} />
          {member.memberTypeId !== 'pleno' && (
            <ProfileDataField label="Cuota deducida" value={member.feeDeductionLabel ?? 'Sin deduccion informada'} />
          )}
          <ProfileDataField
            label="Grupo familiar"
            value={hasFamilyGroup ? `${member.familyGroupCode ?? 'Grupo familiar'} (${Math.max(household.length, member.householdSize)} integrantes)` : 'Sin grupo'}
          />
          {hasFamilyGroup && (
            <ProfileDataField
              label="Titular familiar"
              value={holderMember ? `#${holderMember.memberNumber} ${holderMember.displayName}` : 'No informado'}
            />
          )}
        </div>

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
            <article className="membership-panel">
              <p className="eyebrow">Ficha operativa</p>
              <h2>Resumen administrativo</h2>
              <div className="membership-panel__list">
                <div>
                  <span>Nombre legado</span>
                  <strong>{member.fullName}</strong>
                </div>
                <div>
                  <span>ID interno</span>
                  <strong>{member.id}</strong>
                </div>
                <div>
                  <span>Origen</span>
                  <strong>{member.source === 'legacy-padron' ? 'Padron legado cargado' : 'Registro manual'}</strong>
                </div>
                <div>
                  <span>Ultima actualizacion</span>
                  <strong>
                    {new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(
                      new Date(member.updatedAt),
                    )}
                  </strong>
                </div>
              </div>

              {member.notes && (
                <div className="membership-note">
                  <span>Observaciones</span>
                  <p>{member.notes}</p>
                </div>
              )}
            </article>
          )}

          {canManageMembership && (
            <article className="membership-panel">
              <p className="eyebrow">Acceso a la app</p>
              <h2>Acciones de acceso</h2>

              <div className="membership-panel__list">
                <div>
                  <span>Estado de acceso</span>
                  <strong>
                    {authStatus?.hasAuthUser ? (authStatus.authDisabled ? 'Deshabilitado' : 'Activo') : 'Sin acceso creado'}
                  </strong>
                </div>
                <div>
                  <span>Ultimo ingreso</span>
                  <strong>{formatDate(authStatus?.lastLoginAt as TimestampLike | string | Date | number | null | undefined)}</strong>
                </div>
                {authStatus?.linkedUserId && (
                  <div className="access-role-row">
                    <div>
                      <span>Roles del usuario</span>
                      <strong>{assignedRoleLabel}</strong>
                    </div>
                    {isDirectivo && (
                      <div className="access-role-actions">
                        <div className="role-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={isAddRoleDisabled}
                            aria-haspopup="menu"
                            aria-expanded={!isAddRoleDisabled && isRoleDropdownOpen}
                            onClick={() => {
                              if (isAddRoleDisabled) {
                                return;
                              }

                              setIsRemoveRoleDropdownOpen(false);
                              setIsRoleDropdownOpen((current) => !current);
                            }}
                          >
                            Agregar rol
                          </button>

                          {!isAddRoleDisabled && isRoleDropdownOpen && (
                            <div className="member-actions-menu role-actions-menu" role="menu">
                              {missingRoleOptions.map((roleId) => (
                                <button
                                  key={roleId}
                                  type="button"
                                  className="member-actions-menu__item"
                                  role="menuitem"
                                  disabled={accessLoading}
                                  onClick={() => void handleAddRole(roleId)}
                                >
                                  {ROLE_LABELS[roleId]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="role-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={isRemoveRoleDisabled}
                            aria-haspopup="menu"
                            aria-expanded={!isRemoveRoleDisabled && isRemoveRoleDropdownOpen}
                            onClick={() => {
                              if (isRemoveRoleDisabled) {
                                return;
                              }

                              setIsRoleDropdownOpen(false);
                              setIsRemoveRoleDropdownOpen((current) => !current);
                            }}
                          >
                            Eliminar rol
                          </button>

                          {!isRemoveRoleDisabled && isRemoveRoleDropdownOpen && (
                            <div className="member-actions-menu role-actions-menu" role="menu">
                              {assignedRoleOptions.map((roleId) => (
                                <button
                                  key={roleId}
                                  type="button"
                                  className="member-actions-menu__item member-actions-menu__item--danger"
                                  role="menuitem"
                                  disabled={accessLoading}
                                  onClick={() => void handleRemoveRole(roleId)}
                                >
                                  {ROLE_LABELS[roleId]}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {accessMessage && (
                <div className="membership-note">
                  <span>Resultado</span>
                  <p>{accessMessage}</p>
                </div>
              )}

              <div className="form-actions">
                {!authStatus?.linkedUserId && (
                  <button type="button" className="btn-primary" disabled={accessLoading} onClick={handleCreateAccess}>
                    Crear acceso
                  </button>
                )}
                {authStatus?.linkedUserId && (
                  <>
                    <button type="button" className="btn-secondary" disabled={accessLoading} onClick={handleResetPassword}>
                      Resetear clave
                    </button>
                    <button type="button" className="btn-secondary" disabled={accessLoading} onClick={handleToggleAccess}>
                      {authStatus.authDisabled || authStatus.userActive === false ? 'Reactivar acceso' : 'Deshabilitar acceso'}
                    </button>
                    <button type="button" className="btn-secondary" disabled={accessLoading} onClick={handleSyncClaims}>
                      Sincronizar claims
                    </button>
                  </>
                )}
              </div>
            </article>
          )}

          {hasFamilyGroup && (
            <article className="membership-panel">
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
