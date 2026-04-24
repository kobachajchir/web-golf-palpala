import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getClubMemberById,
  getClubMemberHousehold,
  type ClubMemberRecord,
} from '../modules/users/local/memberDirectory';

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

export function MemberMembershipProfile() {
  const { memberId } = useParams();
  const [member, setMember] = useState<ClubMemberRecord | null>(null);
  const [household, setHousehold] = useState<ClubMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    if (!memberId) {
      setLoading(false);
      return;
    }

    void Promise.all([getClubMemberById(memberId), getClubMemberHousehold(memberId)])
      .then(([loadedMember, loadedHousehold]) => {
        if (!mounted) {
          return;
        }

        setMember(loadedMember);
        setHousehold(loadedHousehold);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        setMember(null);
        setHousehold([]);
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [memberId]);

  if (loading) {
    return <div className="empty-state">Cargando ficha de membresia...</div>;
  }

  if (!member) {
    return <div className="empty-state">No encontramos esa membresia.</div>;
  }

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
            <Link className="btn-secondary" to="/admin/members">
              Volver al padron
            </Link>
          </div>
        </div>

        <div className="public-profile-grid membership-profile-grid">
          <ProfileDataField label="Estado de membresia" value={member.membershipStatusLabel} />
          <ProfileDataField label="Tipo interno" value={member.memberTypeLabel} />
          <ProfileDataField label="Matricula AAG" value={member.aagMembershipNumber ?? 'Sin matricula'} />
          <ProfileDataField label="DNI" value={member.dni ?? 'Pendiente'} />
          <ProfileDataField label="Cuota deducida" value={member.feeDeductionLabel ?? 'Sin deduccion informada'} />
          <ProfileDataField
            label="Grupo familiar"
            value={member.familyGroupCode ? `${member.familyGroupCode} (${member.householdSize} integrantes)` : 'Sin grupo'}
          />
        </div>

        <div className="membership-grid">
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

          <article className="membership-panel">
            <p className="eyebrow">Membresia vinculada</p>
            <h2>Grupo o convivencia</h2>

            {household.length > 1 ? (
              <div className="household-list">
                {household.map((relative) => (
                  <div key={relative.id} className="household-list__item">
                    <div>
                      <strong>{relative.displayName}</strong>
                      <small>
                        {relative.memberTypeLabel}
                        {relative.isFamilyHolder ? ' | Titular' : ''}
                      </small>
                    </div>
                    <span>{relative.feeDeductionLabel ?? relative.membershipStatusLabel}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="membership-note">
                <span>Sin grupo familiar detectado</span>
                <p>Este socio hoy figura como membresia individual en el padron operativo.</p>
              </div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
