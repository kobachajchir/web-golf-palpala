import { useState, type FormEvent } from 'react';
import clubLogo from '../assets/ClubLogo.png';

const CLUB_ADDRESS = 'Avda. El Inti 598, Loma Golf, Palpala';
const CLUB_PHONE = '388 - 4111111';
const MAP_SRC = 'https://www.google.com/maps?q=Avda.%20El%20Inti%20598%2C%20Loma%20Golf%2C%20Palpala&z=16&output=embed';

type ClubContactFormProps = {
  compact?: boolean;
  showPersonalFields?: boolean;
};

export function ClubContactForm({ compact = false, showPersonalFields = true }: ClubContactFormProps) {
  const [messageSent, setMessageSent] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessageSent(true);
  };

  const panelClassName = [
    'club-contact-panel',
    compact ? 'club-contact-panel--compact' : '',
    !showPersonalFields ? 'club-contact-panel--session-user' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={panelClassName}>
      <div className="club-contact-panel__header">
        <img src={clubLogo} alt="Palpala Golf Tenis Club" className="club-contact-panel__logo" />
        <span className="club-contact-panel__info-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="button-icon">
            <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 8.6a1 1 0 0 0-1 1V16a1 1 0 1 0 2 0v-4.4a1 1 0 0 0-1-1Zm0-3.8a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z" fill="currentColor" />
          </svg>
        </span>
        <p className="eyebrow">Contacto</p>
        <h2>Informacion de contacto</h2>
        <p>Consultas institucionales, ubicacion y datos utiles del club.</p>
      </div>

      <div className="club-contact-layout">
        <div className="club-contact-info" aria-label="Datos de contacto del club">
          <div className="club-contact-info__item">
            <span>Direccion</span>
            <p>{CLUB_ADDRESS}</p>
          </div>
          <div className="club-contact-info__item">
            <span>Telefono</span>
            <p>{CLUB_PHONE}</p>
          </div>
          <iframe
            title="Ubicacion Palpala Golf Tenis Club"
            src={MAP_SRC}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>

        <form className="club-contact-form" onSubmit={handleSubmit}>
          {showPersonalFields && (
            <div className="club-contact-form__section-label">
              <span>Tus datos</span>
              <p>Dejanos tus datos de contacto para responder la consulta.</p>
            </div>
          )}
          {showPersonalFields && (
            <>
              <label className="form-field">
                <span>Nombre</span>
                <input type="text" placeholder="Tu nombre" required />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input type="email" placeholder="tu@email.com" required />
              </label>
              <label className="form-field">
                <span>Telefono</span>
                <input type="tel" placeholder={CLUB_PHONE} />
              </label>
            </>
          )}
          <label className="form-field club-contact-form__message">
            <span>Mensaje</span>
            <textarea rows={4} placeholder="Escribi tu consulta" required />
          </label>
          {messageSent && (
            <div className="accounting-success">
              Consulta preparada. Cuando conectemos el canal de contacto, se enviara desde aca.
            </div>
          )}
          <div className="form-actions">
            <button type="submit" className="btn-primary">
              Enviar consulta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
