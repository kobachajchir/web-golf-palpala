import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClubContactForm } from '../components/ClubContactForm';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UiActionButton } from '../components/UiActionButton';
import { useAuth } from '../hooks/useAuth';
import { createTournamentCallables } from '../modules/tournaments/functions/tournaments.callables';
import { subscribeOpenTournaments } from '../modules/tournaments/repositories';
import type { EntityWithId, TournamentDocument } from '../modules/tournaments/domain/models';
import clubLogo from '../assets/ClubLogo.png';
import '../styles/pages.css';

type LoginFormState = {
  memberNumber: string;
  password: string;
};

type PublicTournament = EntityWithId<TournamentDocument>;

type PublicTournamentRegistrationState = {
  fullName: string;
  email: string;
  phone: string;
  handicap: string;
  aagLicense: string;
  notes: string;
};

function formatPublicTournamentDate(date: string) {
  const parsedDate = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(parsedDate);
}

function formatAmountMinor(amountMinor: number) {
  return `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(amountMinor / 100)}`;
}

function getPublicTournamentFormatLabel(format: string) {
  const labels: Record<string, string> = {
    medal: 'Medal',
    stableford: 'Stableford',
    scramble: 'Scramble',
    laguneada: 'Laguneada',
  };
  return labels[format] ?? format;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path
        d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Zm9 3.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"
        fill="currentColor"
      />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path
        d="m4.3 3 16.7 16.7-1.3 1.3-3-3A10 10 0 0 1 12 19c-5.8 0-9-7-9-7a17.2 17.2 0 0 1 4.1-4.8L3 4.3 4.3 3Zm5 7.1A3.5 3.5 0 0 0 14 14.8L9.3 10.1ZM12 5c5.8 0 9 7 9 7a16.5 16.5 0 0 1-2.7 3.6l-2.1-2.1A3.5 3.5 0 0 0 11 8.2L8.9 6.1A9.9 9.9 0 0 1 12 5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function BackChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M14.8 5.4 8.2 12l6.6 6.6-1.6 1.6L5 12l8.2-8.2 1.6 1.6Z" fill="currentColor" />
    </svg>
  );
}

function ForwardChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="m9.2 18.6 6.6-6.6-6.6-6.6 1.6-1.6L19 12l-8.2 8.2-1.6-1.6Z" fill="currentColor" />
    </svg>
  );
}

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const tournamentCallables = useMemo(() => createTournamentCallables(), []);
  const [formData, setFormData] = useState<LoginFormState>({
    memberNumber: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showOpenTournaments, setShowOpenTournaments] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [publicOpenTournaments, setPublicOpenTournaments] = useState<PublicTournament[]>([]);
  const [publicTournamentsLoading, setPublicTournamentsLoading] = useState(false);
  const [publicTournamentsError, setPublicTournamentsError] = useState('');
  const [selectedPublicTournamentId, setSelectedPublicTournamentId] = useState<string | null>(null);
  const [publicRegistration, setPublicRegistration] = useState<PublicTournamentRegistrationState>({
    fullName: '',
    email: '',
    phone: '',
    handicap: '',
    aagLicense: '',
    notes: '',
  });
  const [publicRegistrationConfirmationOpen, setPublicRegistrationConfirmationOpen] = useState(false);
  const [publicRegistrationError, setPublicRegistrationError] = useState('');
  const [isPublicRegistrationSubmitting, setIsPublicRegistrationSubmitting] = useState(false);

  useEffect(() => {
    if (!showOpenTournaments) {
      return undefined;
    }

    setPublicTournamentsLoading(true);
    setPublicTournamentsError('');
    return subscribeOpenTournaments({
      onNext: (items) => {
        setPublicOpenTournaments(items);
        setPublicTournamentsLoading(false);
        setSelectedPublicTournamentId((current) =>
          current && items.some((tournament) => tournament.id === current) ? current : null,
        );
      },
      onError: (snapshotError) => {
        setPublicOpenTournaments([]);
        setPublicTournamentsError(`No pudimos cargar torneos abiertos: ${snapshotError.message}`);
        setPublicTournamentsLoading(false);
      },
    });
  }, [showOpenTournaments]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handlePublicRegistrationChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setPublicRegistration((current) => ({ ...current, [name]: value }));
  };

  const handlePublicTournamentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPublicRegistrationConfirmationOpen(false);
    setPublicRegistrationError('');

    if (!selectedPublicTournament) {
      setPublicRegistrationError('Selecciona un torneo abierto.');
      return;
    }

    const handicap = Number(publicRegistration.handicap);
    if (!Number.isFinite(handicap)) {
      setPublicRegistrationError('Ingresa un handicap valido.');
      return;
    }

    setIsPublicRegistrationSubmitting(true);
    try {
      await tournamentCallables.registerExternalParticipant({
        tournamentId: selectedPublicTournament.id,
        fullName: publicRegistration.fullName.trim(),
        email: publicRegistration.email.trim(),
        phone: publicRegistration.phone.trim() || null,
        handicap,
        aagLicense: publicRegistration.aagLicense.trim() || null,
        notes: publicRegistration.notes.trim() || null,
      });
      setSelectedPublicTournamentId(null);
      setPublicRegistrationConfirmationOpen(true);
      setPublicRegistration({
        fullName: '',
        email: '',
        phone: '',
        handicap: '',
        aagLicense: '',
        notes: '',
      });
    } catch (submitError) {
      setPublicRegistrationError(submitError instanceof Error ? submitError.message : 'No pudimos enviar la solicitud.');
    } finally {
      setIsPublicRegistrationSubmitting(false);
    }
  };

  const selectedPublicTournament = publicOpenTournaments.find(
    (tournament) => tournament.id === selectedPublicTournamentId,
  ) ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    if (!formData.memberNumber || !formData.password) {
      setError('Por favor completa numero de socio y contrasena.');
      setIsSubmitting(false);
      return;
    }

    try {
      await login(formData.memberNumber, formData.password);
      navigate('/home', { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No pudimos iniciar sesion.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-container login-page">
      <div className="auth-stack">
        {showContactForm ? (
          <section className="auth-floating-panel auth-floating-panel--contact">
            <button type="button" className="btn-secondary auth-back-button" onClick={() => setShowContactForm(false)}>
              <span className="auth-back-button__icon" aria-hidden="true">
                <BackChevronIcon />
              </span>
              Volver al Login
            </button>
            <ClubContactForm compact />
          </section>
        ) : showOpenTournaments ? (
          <section className="auth-card auth-card--login auth-card--public-tournaments">
            <button
              type="button"
              className="btn-secondary auth-back-button"
              onClick={() => {
                setShowOpenTournaments(false);
                setSelectedPublicTournamentId(null);
                setPublicRegistrationConfirmationOpen(false);
              }}
            >
              <span className="auth-back-button__icon" aria-hidden="true">
                <BackChevronIcon />
              </span>
              Volver al Login
            </button>
            <div className="auth-card__intro">
              <img src={clubLogo} alt="Palpala Golf Tenis Club" className="auth-card__logo" />
              <p className="eyebrow">Torneos abiertos</p>
              <h1>Inscripcion externa</h1>
              <p>Estos son los torneos con inscripcion abierta en el club. La solicitud queda pendiente de aprobacion administrativa.</p>
            </div>

            <div className="public-tournaments-panel">
              <div className="public-tournaments-list">
                {publicTournamentsLoading ? (
                  <div className="empty-state empty-state--inline">Cargando torneos abiertos...</div>
                ) : publicTournamentsError ? (
                  <div className="error-message">{publicTournamentsError}</div>
                ) : publicOpenTournaments.length === 0 ? (
                  <div className="empty-state empty-state--inline">No hay torneos con inscripcion abierta.</div>
                ) : (
                  publicOpenTournaments.map((tournament) => (
                    <button
                      key={tournament.id}
                      type="button"
                      className={`public-tournament-card ${selectedPublicTournamentId === tournament.id ? 'public-tournament-card--selected' : ''}`}
                      onClick={() => {
                        if (selectedPublicTournamentId === tournament.id) {
                          setSelectedPublicTournamentId(null);
                          setPublicRegistrationConfirmationOpen(false);
                          return;
                        }
                        setSelectedPublicTournamentId(tournament.id);
                        setPublicRegistrationConfirmationOpen(false);
                      }}
                    >
                      <span>
                        <strong>{tournament.name}</strong>
                        <small>{formatPublicTournamentDate(tournament.date)} - {getPublicTournamentFormatLabel(tournament.format)}</small>
                      </span>
                      <span className="member-type-badge">
                        {formatAmountMinor(tournament.registrationFeeMinor)}
                      </span>
                    </button>
                  ))
                )}
              </div>

              {selectedPublicTournament && (
                <form className="public-tournament-form" onSubmit={handlePublicTournamentSubmit}>
                  <div className="club-contact-form__section-label public-tournament-rules">
                    <span>Politicas del torneo</span>
                    <p>
                      {getPublicTournamentFormatLabel(selectedPublicTournament.format)} con inscripcion abierta para participantes externos.
                      La confirmacion queda pendiente hasta validar la matricula AAG y los datos declarados.
                    </p>
                  </div>
                  <div className="tournament-receipt-summary public-tournament-amount">
                    <div>
                      <span>Monto</span>
                      <strong>{formatAmountMinor(selectedPublicTournament.registrationFeeMinor)}</strong>
                    </div>
                  </div>
                  <div className="tournament-cost-form__row">
                    <label className="form-field">
                      <span>Nombre y apellido</span>
                      <input
                        name="fullName"
                        type="text"
                        value={publicRegistration.fullName}
                        onChange={handlePublicRegistrationChange}
                        required
                      />
                    </label>
                    <label className="form-field">
                      <span>Email</span>
                      <input
                        name="email"
                        type="email"
                        value={publicRegistration.email}
                        onChange={handlePublicRegistrationChange}
                        required
                      />
                    </label>
                  </div>
                  <div className="tournament-cost-form__row">
                    <label className="form-field">
                      <span>Telefono</span>
                      <input
                        name="phone"
                        type="tel"
                        value={publicRegistration.phone}
                        onChange={handlePublicRegistrationChange}
                      />
                    </label>
                    <label className="form-field">
                      <span>Handicap</span>
                      <input
                        name="handicap"
                        type="number"
                        step="0.1"
                        value={publicRegistration.handicap}
                        onChange={handlePublicRegistrationChange}
                        required
                      />
                    </label>
                    <label className="form-field">
                      <span>Matricula AAG</span>
                      <input
                        name="aagLicense"
                        type="text"
                        value={publicRegistration.aagLicense}
                        onChange={handlePublicRegistrationChange}
                        required
                      />
                    </label>
                  </div>
                  <label className="form-field">
                    <span>Comentario</span>
                    <textarea
                      name="notes"
                      rows={3}
                      value={publicRegistration.notes}
                      onChange={handlePublicRegistrationChange}
                      placeholder="Categoria, club de origen u observaciones"
                    />
                  </label>
                  {publicRegistrationError && <div className="error-message">{publicRegistrationError}</div>}
                  <div className="form-actions">
                    <UiActionButton type="submit" variant="positive" disabled={isPublicRegistrationSubmitting}>
                      {isPublicRegistrationSubmitting ? 'Enviando...' : 'Enviar solicitud de inscripcion'}
                    </UiActionButton>
                  </div>
                </form>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="auth-card auth-card--login">
              <div className="auth-card__top-action">
                <UiActionButton
                  type="button"
                  variant="secondary"
                  compact
                  onClick={() => setShowOpenTournaments(true)}
                >
                  <span>Torneos abiertos</span>
                  <ForwardChevronIcon />
                </UiActionButton>
              </div>
              <div className="auth-card__intro">
                <img src={clubLogo} alt="Palpala Golf Tenis Club" className="auth-card__logo" />
                <p className="eyebrow">Palpala Golf Tenis Club</p>
                <h1>Ingreso</h1>
              </div>

              {error && <div className="error-message">{error}</div>}

              <form className="auth-form" onSubmit={handleSubmit}>
                <div className="form-field auth-form-field">
                  <label htmlFor="memberNumber">Numero de socio o legajo</label>
                  <input
                    id="memberNumber"
                    name="memberNumber"
                    type="text"
                    autoComplete="username"
                    value={formData.memberNumber}
                    onChange={handleChange}
                    placeholder="Ej. 123 o E001"
                  />
                </div>

                <div className="form-field auth-form-field">
                  <label htmlFor="password">Contrasena</label>
                  <span className="password-input-wrap auth-password-wrap">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Tu contrasena"
                    />
                    <button
                      type="button"
                      className="password-visibility-button password-visibility-button--icon"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                    >
                      <EyeIcon visible={showPassword} />
                    </button>
                  </span>
                </div>

                <div className="auth-submit-row">
                  <button type="submit" className="btn-primary form-submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Ingresando...' : 'Entrar'}
                  </button>
                </div>
              </form>

              <div className="auth-card__footer auth-card__footer--links">
                <Link to="/olvide-contrasena" className="auth-link">
                  Olvidaste tu contrasena?
                </Link>
                <p className="auth-signup-line">
                  Necesitas una cuenta?
                  <Link to="/signup" className="auth-link">
                    Solicitar alta
                  </Link>
                </p>
              </div>
            </section>

            <section className="auth-floating-panel auth-contact-trigger">
              <button
                type="button"
                className="auth-link auth-link-button auth-contact-button"
                onClick={() => setShowContactForm(true)}
              >
                Informacion de contacto
              </button>
            </section>
          </>
        )}
        <ConfirmDialog
          open={publicRegistrationConfirmationOpen}
          title="Inscripcion recibida"
          description="Aprobacion pendiente, nos comunicaremos contigo."
          confirmLabel="Entendido"
          cancelLabel={null}
          onCancel={() => setPublicRegistrationConfirmationOpen(false)}
          onConfirm={() => setPublicRegistrationConfirmationOpen(false)}
        />
      </div>
    </div>
  );
}
