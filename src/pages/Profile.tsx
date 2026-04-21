import { Link, useParams } from 'react-router-dom';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { getDirectoryUserById } from '../mocks/userDirectory';
import { formatTimestamp, getUserDisplayName } from '../utils/user';

export function Profile() {
  const { id } = useParams();
  const { user } = useAuth();
  const profile = getDirectoryUserById(id, user);
  const canSeeAdminProfile = user?.role_id === ROLES.ADMIN;

  if (!profile) {
    return <div className="empty-state">No encontramos ese perfil.</div>;
  }

  return (
    <div className="page-container profile-page">
      <section className="floating-card public-profile-card">
        <div className="public-profile-card__header">
          <div className="public-profile-avatar">{getUserDisplayName(profile).charAt(0).toUpperCase()}</div>

          <div className="public-profile-card__copy">
            <p className="eyebrow">Perfil publico</p>
            <h1>{getUserDisplayName(profile)}</h1>
            <p className="profile-note">Informacion visible para otros usuarios del club.</p>
          </div>
        </div>

        <div className="public-profile-grid">
          <div className="public-profile-field">
            <span>Nombre</span>
            <strong>{getUserDisplayName(profile)}</strong>
          </div>

          <div className="public-profile-field">
            <span>Email</span>
            <strong>{profile.email}</strong>
          </div>

          <div className="public-profile-field">
            <span>Se unio</span>
            <strong>{formatTimestamp(profile.created_at)}</strong>
          </div>
        </div>

        {canSeeAdminProfile && (
          <div className="profile-actions">
            <Link className="btn-secondary" to={`/admin/users/${profile.id}`}>
              Ver ficha administrativa
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
