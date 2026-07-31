import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PasswordChangePanel } from '../components/PasswordChangePanel';
import { PersonProfileHeader } from '../components/PersonProfileHeader';
import { RoleChipList } from '../components/RoleChipList';
import { ROLES, normalizeRoleIds } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type { EntityWithId, MemberDocument, UserDocument } from '../modules/users/domain/models';
import { createUsersCallables } from '../modules/users/functions/users.callables';
import {
  createMembersRepository,
  createUsersRepository,
} from '../modules/users/infrastructure/firestore/repositories';
import { formatTimestamp, getUserDisplayName } from '../utils/user';

type LoadedProfile = {
  user: EntityWithId<UserDocument>;
  member: EntityWithId<MemberDocument> | null;
};

const STAFF_MODE_OPTIONS = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO] as const;
const usersCallables = createUsersCallables();

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M7.3 9.3a1 1 0 0 1 1.4 0L12 12.58l3.3-3.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.42Z" />
    </svg>
  );
}

export function Profile() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { firebaseUser, refreshUser, user: currentUser, interfaceMode } = useAuth();
  const [profile, setProfile] = useState<LoadedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPasswordChangeOpen, setIsPasswordChangeOpen] = useState(false);
  const [isMoreDataOpen, setIsMoreDataOpen] = useState(false);
  const [isEditingDni, setIsEditingDni] = useState(false);
  const [dniDraft, setDniDraft] = useState('');
  const [dniSaving, setDniSaving] = useState(false);
  const [dniNotice, setDniNotice] = useState('');
  const canSeeAdminProfile = (STAFF_MODE_OPTIONS as readonly string[]).includes(interfaceMode);
  const requestedPanel = searchParams.get('panel');

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      setLoading(true);
      setError('');

      try {
        const profileId = id ?? currentUser?.id;
        if (!profileId) {
          setProfile(null);
          return;
        }

        if (currentUser?.id !== profileId && !canSeeAdminProfile) {
          setError('No tenes permiso para ver ese perfil.');
          setProfile(null);
          return;
        }

        const loadedUser =
          currentUser?.id === profileId
            ? currentUser
            : await createUsersRepository().getById(profileId);

        if (!loadedUser) {
          setProfile(null);
          return;
        }

        const loadedMember =
          loadedUser.profileType === 'member' && loadedUser.profileId
            ? await createMembersRepository().getById(loadedUser.profileId)
            : null;

        if (mounted) {
          setProfile({ user: loadedUser, member: loadedMember });
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar ese perfil.');
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      mounted = false;
    };
  }, [canSeeAdminProfile, currentUser, id]);

  useEffect(() => {
    setDniDraft(profile?.member?.dni ?? '');
  }, [profile?.member?.dni]);

  useEffect(() => {
    if (requestedPanel === 'password' && profile?.user.id === currentUser?.id) {
      setIsPasswordChangeOpen(true);
    }

    if (requestedPanel === 'more' && canSeeAdminProfile) {
      setIsMoreDataOpen(true);
    }
  }, [canSeeAdminProfile, currentUser?.id, profile?.user.id, requestedPanel]);

  if (loading) {
    return (
      <div className="loading-state">
        <span className="loading-spinner" />
        <strong>Obteniendo datos</strong>
      </div>
    );
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  if (!profile) {
    return <div className="empty-state">No encontramos ese perfil.</div>;
  }

  const displayName =
    profile.member ? `${profile.member.firstName} ${profile.member.lastName}` : getUserDisplayName(profile.user);
  const firstName = profile.member?.firstName ?? profile.user.displayName.split(' ')[0] ?? displayName;
  const lastName = profile.member?.lastName ?? profile.user.displayName.split(' ').slice(1).join(' ') ?? '';
  const rawMemberNumber = profile.member?.memberNumber ?? profile.user.memberNumber ?? null;
  const memberNumber = rawMemberNumber && !rawMemberNumber.startsWith('legacy-') ? rawMemberNumber : null;
  const documentNumber = profile.member?.dni ?? 'Documento pendiente';
  const roleIds = normalizeRoleIds(profile.user.roleIds?.length ? profile.user.roleIds : [profile.user.primaryRoleId]);
  const canSeeAccessStatus = canSeeAdminProfile || interfaceMode === ROLES.COMISION_DIRECTIVA;
  const isOwnMemberProfile = profile.user.id === currentUser?.id && Boolean(profile.member);
  const isOwnDeveloperProfile = profile.user.id === currentUser?.id
    && roleIds.includes(ROLES.DESARROLLADOR);
  const canOpenDeveloperPage = isOwnDeveloperProfile && interfaceMode === ROLES.DESARROLLADOR;

  const handleOwnDniSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDniSaving(true);
    setDniNotice('');
    try {
      const result = await usersCallables.updateOwnMemberDni({ dni: dniDraft });
      setProfile((current) => current?.member
        ? { ...current, member: { ...current.member, dni: result.dni } }
        : current);
      setIsEditingDni(false);
      setDniNotice('DNI actualizado.');
    } catch (saveError) {
      setDniNotice(saveError instanceof Error ? saveError.message : 'No pudimos actualizar el DNI.');
    } finally {
      setDniSaving(false);
    }
  };

  return (
    <div className="page-container profile-page">
      <section className="floating-card public-profile-card">
        <PersonProfileHeader
          title={displayName}
          avatarLabel={displayName}
          subtitle={memberNumber ? <span>Socio #{memberNumber}</span> : <span>Usuario del club</span>}
          badges={
            canSeeAccessStatus ? (
              <span className={`status-pill ${profile.user.active ? 'status-pill-green' : 'status-pill--bloqueado'}`}>
                {profile.user.active ? 'Activo' : 'Sin acceso app'}
              </span>
            ) : null
          }
        />

        <div className="public-profile-list">
          <div className="public-profile-name-row">
            <div className="public-profile-field">
              <span>Nombre</span>
              <strong>{firstName || 'Sin nombre'}</strong>
            </div>
            <div className="public-profile-field">
              <span>Apellido</span>
              <strong>{lastName || 'Sin apellido'}</strong>
            </div>
          </div>

          <div className="public-profile-field">
            <span>Documento</span>
            {isOwnMemberProfile && isEditingDni ? (
              <form className="accounting-entry-form" onSubmit={handleOwnDniSubmit}>
                <label className="form-field">
                  <span>DNI</span>
                  <input value={dniDraft} inputMode="numeric" autoComplete="off" onChange={(event) => setDniDraft(event.target.value)} />
                </label>
                <div className="form-actions form-actions--right">
                  <button type="button" className="ui-action-button ui-action-button--secondary" onClick={() => setIsEditingDni(false)}>Cancelar</button>
                  <button type="submit" className="ui-action-button" disabled={dniSaving}>{dniSaving ? 'Guardando...' : 'Guardar DNI'}</button>
                </div>
              </form>
            ) : (
              <span className="profile-inline-value-action">
                <strong>{documentNumber}</strong>
                {isOwnMemberProfile && (
                  <button type="button" className="ui-action-button ui-action-button--secondary ui-action-button--compact" onClick={() => setIsEditingDni(true)}>
                    Editar DNI
                  </button>
                )}
              </span>
            )}
            {dniNotice && <small role="status">{dniNotice}</small>}
          </div>

          {memberNumber && (
            <div className="public-profile-field">
              <span>Numero de socio</span>
              <strong>{memberNumber}</strong>
            </div>
          )}

          <div className="public-profile-field public-profile-field--roles">
            <span>Roles</span>
            <RoleChipList roleIds={roleIds} showInternalRoles={isOwnDeveloperProfile} />
          </div>
        </div>

        {(profile.member || canSeeAdminProfile || canOpenDeveloperPage) && (
          <div className="profile-actions">
            {profile.member && (
              <Link
                className="ui-action-button ui-action-button--secondary"
                to={canSeeAdminProfile ? `/admin/members/${profile.member.id}` : '/mi-membresia'}
              >
                Ver membresia
              </Link>
            )}
            {canOpenDeveloperPage && (
              <Link className="ui-action-button" to="/desarrollador">
                Abrir panel desarrollador
              </Link>
            )}
            {canSeeAdminProfile && (
              <button
                type="button"
                className={`ui-action-button ui-action-button--compact profile-more-button ${isMoreDataOpen ? 'profile-more-button--open' : ''}`}
                aria-expanded={isMoreDataOpen}
                onClick={() => setIsMoreDataOpen((current) => !current)}
              >
                Mas datos
                <span className="profile-more-chevron" aria-hidden="true">
                  <ChevronIcon />
                </span>
              </button>
            )}
          </div>
        )}

        {canSeeAdminProfile && isMoreDataOpen && (
          <div className="profile-more-data">
            <div className="public-profile-field">
              <span>Tipo de socio</span>
              <strong>{(profile.member?.typeCodeSnapshot ?? profile.member?.typeId ?? 'Sin tipo vinculado')
                .toString()
                .replace(/\b\w/g, (char) => char.toUpperCase())}</strong>
            </div>
            <div className="public-profile-field">
              <span>Ultimo acceso</span>
              <strong>{formatTimestamp(profile.user.lastLoginAt)}</strong>
            </div>
            <div className="public-profile-field">
              <span>Actualizado</span>
              <strong>{formatTimestamp(profile.member?.updatedAt ?? profile.user.updatedAt)}</strong>
            </div>
          </div>
        )}

        {profile.user.id === currentUser?.id && (
          <div className="public-profile-password">
            <p className="eyebrow">Seguridad</p>
            <h2>Cambiar contraseña</h2>
            {!isPasswordChangeOpen ? (
              <button type="button" className="ui-action-button ui-action-button--secondary" onClick={() => setIsPasswordChangeOpen(true)}>
                Cambiar contraseña
              </button>
            ) : (
              <PasswordChangePanel
                firebaseUser={firebaseUser}
                requireCurrentPassword
                onChanged={async () => {
                  await refreshUser();
                  setIsPasswordChangeOpen(false);
                }}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
