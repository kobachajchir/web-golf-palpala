import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonProfileHeader } from '../components/PersonProfileHeader';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type { EntityWithId, MemberDocument } from '../modules/users/domain/models';
import { createMembersRepository } from '../modules/users/infrastructure/firestore/repositories';

export function Developer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [member, setMember] = useState<EntityWithId<MemberDocument> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadMember() {
      setLoading(true);
      setError('');
      try {
        const loadedMember = user?.profileType === 'member' && user.profileId
          ? await createMembersRepository().getById(user.profileId)
          : null;
        if (mounted) {
          setMember(loadedMember);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'No pudimos verificar la proteccion contable.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadMember();
    return () => {
      mounted = false;
    };
  }, [user?.profileId, user?.profileType]);

  const billingProtected = member?.membershipBillingExempt === true;
  const memberNumber = member?.memberNumber ?? user?.memberNumber ?? 'Sin numero';
  const canAccessAccounting = Boolean(user?.roleIds.some(
    (roleId) => roleId === ROLES.ADMINISTRATIVO || roleId === ROLES.DIRECTIVO,
  ));

  return (
    <div className="page-container developer-page">
      <section className="floating-card public-profile-card">
        <PersonProfileHeader
          title="Desarrollador"
          avatarLabel="Desarrollador"
          subtitle={<span>Area interna del software</span>}
          badges={<span className="status-pill status-pill-green">Acceso privado</span>}
        />

        <p>
          Este espacio solo se habilita cuando la sesion posee el rol interno y se selecciona el modo
          Desarrollador. El rol no se ofrece en las herramientas administrativas del club.
        </p>

        <div className="public-profile-list">
          <div className="public-profile-field">
            <span>Usuario tecnico</span>
            <strong>Socio #{memberNumber.replace(/^0+/, '') || memberNumber}</strong>
          </div>
          <div className="public-profile-field">
            <span>Generacion de deuda societaria</span>
            <strong>{loading ? 'Verificando...' : billingProtected ? 'Bloqueada' : 'Requiere revision'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Estado contable</span>
            <strong>{loading ? 'Verificando...' : billingProtected ? 'Exento de nuevos cobros' : 'Proteccion inactiva'}</strong>
          </div>
          <div className="public-profile-field">
            <span>Alcance</span>
            <strong>Solo diagnostico del usuario tecnico</strong>
          </div>
          <div className="public-profile-field">
            <span>Acceso a contabilidad</span>
            <strong>{canAccessAccounting ? 'Habilitado' : 'Sin rol contable asociado'}</strong>
          </div>
        </div>

        {canAccessAccounting && (
          <div className="form-actions form-actions--end">
            <button type="button" className="ui-action-button" onClick={() => navigate('/accounting')}>
              Abrir contabilidad
            </button>
          </div>
        )}

        {error && <div className="form-alert form-alert--error" role="alert">{error}</div>}
        {!loading && !error && !billingProtected && (
          <div className="form-alert form-alert--error" role="alert">
            La exencion contable del usuario tecnico no esta activa. No realices cobros hasta corregirla.
          </div>
        )}
      </section>
    </div>
  );
}