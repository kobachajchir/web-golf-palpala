import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { User } from '../context/AuthContext';
import { useAuth } from '../hooks/useAuth';
import { getDirectoryUserById } from '../mocks/userDirectory';
import { formatTimestamp, getRoleLabel, getUserDisplayName } from '../utils/user';

const PROFILE_TYPE_LABELS = {
  socio: 'Socio',
  empleado: 'Empleado',
  administrativo: 'Administrativo',
} as const;

const STATUS_LABELS = {
  activo: 'Activo',
  inactivo: 'Inactivo',
  bloqueado: 'Bloqueado',
} as const;

type ProfileFormState = User & {
  display_name: string;
};

function toDatetimeLocal(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function createProfileFormState(profile: User): ProfileFormState {
  return {
    ...profile,
    display_name: profile.display_name?.trim() || getUserDisplayName(profile),
  };
}

export function AdminUserProfile() {
  const { id } = useParams();
  const { user, updateUser } = useAuth();
  const profile = getDirectoryUserById(id, user);
  const [formData, setFormData] = useState<ProfileFormState | null>(
    profile ? createProfileFormState(profile) : null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState('');
  const isOwnProfile = Boolean(user && profile && user.id === profile.id);

  useEffect(() => {
    setFormData(profile ? createProfileFormState(profile) : null);
    setIsEditing(false);
    setError('');
  }, [profile]);

  if (!profile || !formData) {
    return <div className="empty-state">No encontramos ese perfil administrativo.</div>;
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;

    setFormData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [name]: value,
      };
    });
  };

  const handleEdit = () => {
    console.log('Mock edicion administrativa de perfil habilitada', { user_id: profile.id });
    setError('');
    setIsEditing(true);
  };

  const handleCancel = () => {
    setFormData(createProfileFormState(profile));
    setError('');
    setIsEditing(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedDisplayName = formData.display_name.trim();
    if (!normalizedDisplayName) {
      setError('El nombre visible no puede quedar vacio.');
      return;
    }

    const updatedProfile: User = {
      ...formData,
      display_name: normalizedDisplayName,
      updated_at: toDatetimeLocal(),
    };

    console.log('Mock Firestore admin update users/{id}', {
      user_id: updatedProfile.id,
      display_name: updatedProfile.display_name,
    });

    if (isOwnProfile) {
      updateUser(updatedProfile);
    }

    setFormData(createProfileFormState(updatedProfile));
    setError('');
    setIsEditing(false);
  };

  return (
    <div className="page-container profile-page">
      <section className="floating-card profile-card">
        <div className="profile-header">
          <div>
            <p className="eyebrow">Ficha administrativa</p>
            <h1>{getUserDisplayName(formData)}</h1>
          </div>
          <span className={`status-pill status-pill--${formData.status}`}>{STATUS_LABELS[formData.status]}</span>
        </div>

        <p className="profile-note">
          Esta vista incluye datos internos del sistema y trazabilidad. La informacion publica del usuario esta en
          su perfil normal.
        </p>

        <div className="profile-actions">
          <Link className="btn-secondary" to={`/users/${profile.id}`}>
            Ver perfil publico
          </Link>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form className="profile-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="profile-display_name">
            <span>Nombre visible</span>
            <input
              id="profile-display_name"
              name="display_name"
              type="text"
              value={formData.display_name}
              onChange={handleChange}
              disabled={!isEditing}
            />
          </label>

          <label className="form-field" htmlFor="profile-email">
            <span>Email principal</span>
            <input id="profile-email" name="email" type="email" value={formData.email} readOnly />
          </label>

          <label className="form-field" htmlFor="profile-id">
            <span>ID del documento</span>
            <input id="profile-id" name="id" type="text" value={formData.id} readOnly />
          </label>

          <label className="form-field" htmlFor="profile-auth_uid">
            <span>UID de Firebase Auth</span>
            <input id="profile-auth_uid" name="auth_uid" type="text" value={formData.auth_uid} readOnly />
          </label>

          <label className="form-field" htmlFor="profile-role_id">
            <span>Rol asignado</span>
            <input id="profile-role_id" name="role_id" type="text" value={getRoleLabel(formData.role_id)} readOnly />
          </label>

          <label className="form-field" htmlFor="profile-profile_type">
            <span>Tipo de perfil</span>
            <input
              id="profile-profile_type"
              name="profile_type"
              type="text"
              value={PROFILE_TYPE_LABELS[formData.profile_type]}
              readOnly
            />
          </label>

          <label className="form-field" htmlFor="profile-profile_id">
            <span>ID del perfil vinculado</span>
            <input id="profile-profile_id" name="profile_id" type="text" value={formData.profile_id} readOnly />
          </label>

          <label className="form-field" htmlFor="profile-status">
            <span>Estado del usuario</span>
            <input id="profile-status" name="status" type="text" value={STATUS_LABELS[formData.status]} readOnly />
          </label>

          <label className="form-field" htmlFor="profile-must_change_password">
            <span>Debe cambiar contrasena</span>
            <input
              id="profile-must_change_password"
              name="must_change_password"
              type="text"
              value={formData.must_change_password ? 'Si' : 'No'}
              readOnly
            />
          </label>

          <label className="form-field" htmlFor="profile-last_login_at">
            <span>Ultimo acceso conocido</span>
            <input
              id="profile-last_login_at"
              name="last_login_at"
              type="text"
              value={formatTimestamp(formData.last_login_at)}
              readOnly
            />
          </label>

          <label className="form-field" htmlFor="profile-created_at">
            <span>Fecha de creacion</span>
            <input
              id="profile-created_at"
              name="created_at"
              type="text"
              value={formatTimestamp(formData.created_at)}
              readOnly
            />
          </label>

          <label className="form-field" htmlFor="profile-updated_at">
            <span>Fecha de ultima modificacion</span>
            <input
              id="profile-updated_at"
              name="updated_at"
              type="text"
              value={formatTimestamp(formData.updated_at)}
              readOnly
            />
          </label>

          {isOwnProfile && (
            <div className="form-actions">
              {isEditing ? (
                <>
                  <button type="button" className="btn-secondary" onClick={handleCancel}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary">
                    Guardar cambios
                  </button>
                </>
              ) : (
                <button type="button" className="btn-primary" onClick={handleEdit}>
                  Modificar nombre
                </button>
              )}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
