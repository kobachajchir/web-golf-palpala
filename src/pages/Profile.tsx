import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PasswordChangePanel } from '../components/PasswordChangePanel';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type { EntityWithId, MemberDocument, UserDocument } from '../modules/users/domain/models';
import {
  createMembersRepository,
  createUsersRepository,
} from '../modules/users/infrastructure/firestore/repositories';
import { formatTimestamp, getRoleLabel, getUserDisplayName } from '../utils/user';

type LoadedProfile = {
  user: EntityWithId<UserDocument>;
  member: EntityWithId<MemberDocument> | null;
};

const STAFF_MODE_OPTIONS = [ROLES.ADMINISTRATIVO, ROLES.DIRECTIVO] as const;

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
  const memberNumber = profile.member?.memberNumber ?? profile.user.memberNumber ?? 'Sin numero vinculado';
  const roleIds = profile.user.roleIds?.length ? profile.user.roleIds : [profile.user.primaryRoleId];

  return (
    <div className="page-container profile-page">
      <section className="floating-card public-profile-card">
        <div className="public-profile-card__header">
          <div className="public-profile-avatar">{displayName.charAt(0).toUpperCase()}</div>

          <div className="public-profile-card__copy">
            <p className="eyebrow">Perfil publico</p>
            <h1>{displayName}</h1>
            <p className="profile-note">Informacion visible para usuarios habilitados del club.</p>
          </div>
        </div>

        <div className="public-profile-grid">
          <div className="public-profile-field">
            <span>Nombre</span>
            <strong>{displayName}</strong>
          </div>

          <div className="public-profile-field">
            <span>Numero de socio</span>
            <strong>{memberNumber}</strong>
          </div>

          <div className="public-profile-field public-profile-field--roles">
            <span>Roles</span>
            <strong className="profile-role-list">
              {roleIds.map((roleId) => (
                <span key={roleId}>{getRoleLabel(roleId)}</span>
              ))}
            </strong>
          </div>
        </div>

        {(profile.member || canSeeAdminProfile) && (
          <div className="profile-actions">
            {profile.member && (
              <Link
                className="ui-action-button ui-action-button--secondary"
                to={canSeeAdminProfile ? `/admin/members/${profile.member.id}` : '/mi-membresia'}
              >
                Ver membresia
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
