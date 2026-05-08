import { useState } from 'react';

const PAST_TOURNAMENTS = [
  { id: 'torneo-apertura-2025', name: 'Torneo Apertura 2025', date: '15/03/2025' },
  { id: 'copa-palpala-2025', name: 'Copa Palpala 2025', date: '22/08/2025' },
  { id: 'cierre-temporada-2025', name: 'Cierre de Temporada 2025', date: '12/12/2025' },
];

export function TournamentRegistration() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasOpenTournaments = false;

  const closeUnavailableModal = () => {
    setIsModalOpen(false);
  };

  return (
    <div className="page-container profile-page">
      <section className="floating-card membership-profile-card">
        <div className="public-profile-card__header">
          <div className="public-profile-avatar">T</div>
          <div className="public-profile-card__copy">
            <p className="eyebrow">Torneos</p>
            <h1>Torneos del club</h1>
          </div>
        </div>

        <div className="profile-actions">
          <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
            Inscribirme
          </button>
        </div>

        {!hasOpenTournaments && (
          <div className="empty-state empty-state--inline">No hay torneos habilitados para inscripcion.</div>
        )}

        <article className="membership-panel">
          <p className="eyebrow">Historial</p>
          <h2>Torneos pasados</h2>
          <div className="accounting-list">
            {PAST_TOURNAMENTS.map((tournament) => (
              <div key={tournament.id} className="accounting-row">
                <div className="accounting-row__main">
                  <strong>{tournament.name}</strong>
                  <small>{tournament.date}</small>
                </div>
                <span className="status-pill status-pill--bloqueado">Finalizado</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      {isModalOpen && (
        <div className="modal-overlay" onClick={closeUnavailableModal}>
          <section
            className="floating-card info-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournaments-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="info-dialog-card__header">
              <div>
                <p className="eyebrow">Torneos</p>
                <h2 id="tournaments-dialog-title">No hay torneos disponibles para inscribirse.</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Cerrar aviso"
                onClick={closeUnavailableModal}
              >
                X
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
