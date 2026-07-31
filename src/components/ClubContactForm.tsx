import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import clubLogo from '../assets/ClubLogo.png';
import { createNotificationsCallables } from '../modules/notifications/functions/notifications.callables';

const CLUB_ADDRESS = 'Avda. El Inti 589, Loma Golf, Palpala';
const CLUB_PHONE = '388-466-2008 (WhatsApp)';
const MAP_SRC = 'https://www.google.com/maps?q=Avda.%20El%20Inti%20589%2C%20Loma%20Golf%2C%20Palpala&z=16&output=embed';

type ClubContactFormProps = {
  compact?: boolean;
  showPersonalFields?: boolean;
};

export function ClubContactForm({ compact = false, showPersonalFields = true }: ClubContactFormProps) {
  const notificationsCallables = useMemo(() => createNotificationsCallables(), []);
  const [formState, setFormState] = useState({
    senderName: '',
    senderEmail: '',
    senderPhone: '',
    subject: '',
    message: '',
  });
  const [messageError, setMessageError] = useState('');
  const [messageSent, setMessageSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormState((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessageError('');
    setMessageSent(false);

    if (!formState.subject.trim() || !formState.message.trim()) {
      setMessageError('Asunto y mensaje son obligatorios.');
      return;
    }

    if (showPersonalFields && !formState.senderEmail.trim() && !formState.senderPhone.trim()) {
      setMessageError('Dejanos un email o telefono de contacto.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (showPersonalFields) {
        await notificationsCallables.submitPublicInquiry({
          senderName: formState.senderName.trim(),
          senderEmail: formState.senderEmail.trim() || null,
          senderPhone: formState.senderPhone.trim() || null,
          subject: formState.subject.trim(),
          message: formState.message.trim(),
        });
      } else {
        await notificationsCallables.submitMemberInquiry({
          subject: formState.subject.trim(),
          message: formState.message.trim(),
        });
      }
      setFormState({
        senderName: '',
        senderEmail: '',
        senderPhone: '',
        subject: '',
        message: '',
      });
      setMessageSent(true);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : 'No pudimos enviar la consulta.');
    } finally {
      setIsSubmitting(false);
    }
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
                <input name="senderName" type="text" placeholder="Tu nombre" value={formState.senderName} onChange={handleChange} required />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input name="senderEmail" type="email" placeholder="tu@email.com" value={formState.senderEmail} onChange={handleChange} />
              </label>
              <label className="form-field">
                <span>Telefono</span>
                <input name="senderPhone" type="tel" placeholder={CLUB_PHONE} value={formState.senderPhone} onChange={handleChange} />
              </label>
            </>
          )}
          <label className="form-field">
            <span>Asunto</span>
            <input name="subject" type="text" placeholder="Motivo de la consulta" value={formState.subject} onChange={handleChange} required />
          </label>
          <label className="form-field club-contact-form__message">
            <span>Mensaje</span>
            <textarea name="message" rows={4} placeholder="Escribi tu consulta" value={formState.message} onChange={handleChange} required />
          </label>
          {messageError && <div className="error-message">{messageError}</div>}
          {messageSent && (
            <div className="accounting-success">
              Consulta enviada. Administracion y directiva la veran en notificaciones.
            </div>
          )}
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando...' : 'Enviar consulta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
