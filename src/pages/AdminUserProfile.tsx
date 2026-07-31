import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getVisibleRoleIds, normalizeRoleIds } from '../constants/roles';
import type { EntityWithId, MemberDocument, UserDocument } from '../modules/users/domain/models';
import {
  createMembersRepository,
  createUsersRepository,
} from '../modules/users/infrastructure/firestore/repositories';
import { formatTimestamp, getRoleLabel, getUserDisplayName } from '../utils/user';

const PROFILE_TYPE_LABELS = {
  member: 'Socio',
  employee: 'Empleado',
  none: 'Sin perfil vinculado',
} as const;

type LoadedAdminProfile = {
  user: EntityWithId<UserDocument>;
  member: EntityWithId<MemberDocument> | null;
};

export function AdminUserProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState<LoadedAdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      setLoading(true);
      setError('');

      try {
        if (!id) {
          setProfile(null);
          return;
        }

        const usersRepository = createUsersRepository();
        const membersRepository = createMembersRepository();
        let loadedUser = await usersRepository.getById(id);
        let loadedMember =
          loadedUser?.profileType === 'member' && loadedUser.profileId
            ? await membersRepository.getById(loadedUser.profileId)
            : null;

        if (loadedUser && !loadedMember) {
          const linkedMembers = await membersRepository.listByLinkedUserId(loadedUser.id);
          loadedMember = linkedMembers[0] ?? null;
        }

        if (!loadedUser) {
          const memberByRoute = await membersRepository.getById(id);
          if (memberByRoute?.linkedUserId) {
            loadedUser = await usersRepository.getById(memberByRoute.linkedUserId);
            loadedMember = memberByRoute;
          }
        }

        if (mounted) {
          setProfile(loadedUser ? { user: loadedUser, member: loadedMember } : null);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar la ficha administrativa.');
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
  }, [id]);

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
    return <div className="empty-state">No encontramos ese perfil administrativo.</div>;
  }

  const displayName = profile.member
    ? `${profile.member.firstName} ${profile.member.lastName}`
    : getUserDisplayName(profile.user);
  const rawMemberNumber = profile.member?.memberNumber ?? profile.user.memberNumber ?? null;
  const memberNumber = rawMemberNumber && !rawMemberNumber.startsWith('legacy-') ? rawMemberNumber : null;
  const visibleRoleIds = getVisibleRoleIds(normalizeRoleIds(profile.user.roleIds));

  return (
    <div className="page-container profile-page">
      <section className="floating-card profile-card">
        <div className="profile-header">
          <div>
            <h1>{displayName}</h1>
          </div>
          <span className={`status-pill ${profile.user.active ? '' : 'status-pill--bloqueado'}`}>
            {profile.user.active ? 'Activo' : 'Inactivo'}
          </span>
        </div>

        <div className="profile-actions">
          <Link className="btn-secondary" to={`/users/${profile.user.id}`}>
            Ver perfil publico
          </Link>
        </div>

        <div className="public-profile-grid membership-profile-grid">
          <div className="public-profile-field">
            <span>UID</span>
            <strong>{profile.user.id}</strong>
          </div>
          <div className="public-profile-field">
            <span>Email interno</span>
            <strong>{profile.user.email}</strong>
          </div>
          <div className="public-profile-field">
            <span>Numero de socio</span>
            <strong>{memberNumber ?? 'Sin vincular'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Rol principal</span>
            <strong>{getRoleLabel(profile.user.primaryRoleId)}</strong>
          </div>
          <div className="public-profile-field">
            <span>Roles</span>
            <strong>{visibleRoleIds.map(getRoleLabel).join(', ') || 'Sin roles visibles'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Tipo de perfil</span>
            <strong>{PROFILE_TYPE_LABELS[profile.user.profileType]}</strong>
          </div>
          <div className="public-profile-field">
            <span>ID perfil vinculado</span>
            <strong>{profile.user.profileId ?? profile.member?.id ?? 'Sin vinculo'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Estado socio</span>
            <strong>{profile.member?.status ?? 'Sin socio vinculado'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Tipo socio</span>
            <strong>{profile.member?.typeCodeSnapshot ?? 'Sin socio vinculado'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Vinculo Auth</span>
            <strong>{profile.member?.linkedUserId === profile.user.id ? 'Vinculado' : 'Revisar vinculo'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Claims version</span>
            <strong>{profile.user.claimsVersion}</strong>
          </div>
          <div className="public-profile-field">
            <span>Ultimo acceso</span>
            <strong>{formatTimestamp(profile.user.lastLoginAt)}</strong>
          </div>
          <div className="public-profile-field">
            <span>Creado</span>
            <strong>{formatTimestamp(profile.user.createdAt)}</strong>
          </div>
          <div className="public-profile-field">
            <span>Actualizado</span>
            <strong>{formatTimestamp(profile.user.updatedAt)}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
