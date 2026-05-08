import { useState, type FormEvent } from 'react';

export function CourtRequests() {
  const [notice, setNotice] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice('Solicitud preparada para revision.');
  };

  return (
    <div className="page-container profile-page">
      <section className="floating-card membership-profile-card">
        <div className="public-profile-card__header">
          <div className="public-profile-avatar">C</div>
          <div className="public-profile-card__copy">
            <p className="eyebrow">Canchas</p>
            <h1>Solicitar cancha</h1>
          </div>
        </div>

        {notice && <div className="accounting-success">{notice}</div>}

        <form className="member-editor-form" onSubmit={handleSubmit}>
          <label className="form-field" htmlFor="courtDate">
            <span>Fecha</span>
            <input id="courtDate" name="courtDate" type="date" required />
          </label>

          <label className="form-field" htmlFor="courtTime">
            <span>Horario</span>
            <input id="courtTime" name="courtTime" type="time" required />
          </label>

          <label className="form-field member-editor-form__wide" htmlFor="courtNotes">
            <span>Detalle</span>
            <textarea id="courtNotes" name="courtNotes" rows={3} />
          </label>

          <div className="form-actions">
            <button type="submit" className="btn-primary">
              Solicitar
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
