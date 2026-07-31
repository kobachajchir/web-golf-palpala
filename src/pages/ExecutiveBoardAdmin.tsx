import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SquaredCircleButton } from '../components/SquaredCircleButton';
import { UiActionButton } from '../components/UiActionButton';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import clubImage from '../assets/ClubImagen.webp';
import clubLogo from '../assets/ClubLogo.png';
import { createExecutiveBoardCallables, type UpsertBoardMemberPayload } from '../modules/executiveBoard/callables';
import type {
  EntityWithId,
  ExecutiveBoardMemberDocument,
  ExecutiveBoardTermDocument,
} from '../modules/executiveBoard/models';
import { getActiveExecutiveBoard } from '../modules/executiveBoard/repositories';
import type { MemberDocument } from '../modules/users/domain/models';
import { createMembersRepository } from '../modules/users/infrastructure/firestore/repositories';

type BoardFormState = {
  memberId: string;
  positionCode: string;
};

const executiveBoardCallables = createExecutiveBoardCallables();
const BOARD_POSITION_OPTIONS = [
  { value: 'presidente', label: 'Presidente', order: 1 },
  { value: 'vicepresidente', label: 'Vicepresidente', order: 2 },
  { value: 'secretario', label: 'Secretario', order: 3 },
  { value: 'prosecretario', label: 'Prosecretario', order: 4 },
  { value: 'tesorero', label: 'Tesorero', order: 5 },
  { value: 'protesorero', label: 'Protesorero', order: 6 },
  { value: 'vocal_titular_1', label: 'Vocal titular 1', order: 7 },
  { value: 'vocal_titular_2', label: 'Vocal titular 2', order: 8 },
  { value: 'vocal_titular_3', label: 'Vocal titular 3', order: 9 },
  { value: 'vocal_suplente_1', label: 'Vocal suplente 1', order: 10 },
  { value: 'vocal_suplente_2', label: 'Vocal suplente 2', order: 11 },
] as const;

function memberDisplayName(member: EntityWithId<MemberDocument>) {
  return `${member.lastName}, ${member.firstName}`;
}

function BoardCommitteeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M12 3 5 6v5.6c0 4.36 2.9 7.96 7 9.4 4.1-1.44 7-5.04 7-9.4V6l-7-3Zm0 2.2 5 2.14v4.26c0 3.22-1.96 6.06-5 7.25-3.04-1.19-5-4.03-5-7.25V7.34l5-2.14Zm0 3.3a2.35 2.35 0 1 1 0 4.7 2.35 2.35 0 0 1 0-4.7Zm0 6.05c1.72 0 3.23.78 4.04 1.94A6.65 6.65 0 0 1 12 18.1a6.65 6.65 0 0 1-4.04-1.61c.81-1.16 2.32-1.94 4.04-1.94Z" />
    </svg>
  );
}

function BoardMemberRow({ member }: { member: EntityWithId<ExecutiveBoardMemberDocument> }) {
  return (
    <tr className={member.active ? '' : 'club-board-table__row--inactive'}>
      <td>{member.positionLabel}</td>
      <td>{member.fullNameSnapshot}</td>
      <td>#{member.memberNumber}</td>
    </tr>
  );
}

export function ExecutiveBoardAdmin() {
  const { hasRole, interfaceMode } = useAuth();
  const canEdit = hasRole(ROLES.DIRECTIVO) && interfaceMode === ROLES.DIRECTIVO;
  const [term, setTerm] = useState<EntityWithId<ExecutiveBoardTermDocument> | null>(null);
  const [boardMembers, setBoardMembers] = useState<Array<EntityWithId<ExecutiveBoardMemberDocument>>>([]);
  const [members, setMembers] = useState<Array<EntityWithId<MemberDocument>>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditorVisible, setIsEditorVisible] = useState(false);
  const [isBoardOpen, setIsBoardOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<UpsertBoardMemberPayload | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<EntityWithId<ExecutiveBoardMemberDocument> | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<BoardFormState>({
    memberId: '',
    positionCode: BOARD_POSITION_OPTIONS[0].value,
  });

  const selectedMember = useMemo(
    () => members.find((member) => member.id === formData.memberId) ?? null,
    [formData.memberId, members],
  );
  const selectedPosition = useMemo(
    () => BOARD_POSITION_OPTIONS.find((position) => position.value === formData.positionCode) ?? BOARD_POSITION_OPTIONS[0],
    [formData.positionCode],
  );
  const currentPositionMember = useMemo(
    () =>
      boardMembers.find(
        (member) => member.active && member.positionCode === selectedPosition.value,
      ) ?? null,
    [boardMembers, selectedPosition.value],
  );
  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLocaleLowerCase('es-AR');

    if (!query) {
      return members.slice(0, 40);
    }

    return members
      .filter((member) => {
        const haystack = `${member.lastName} ${member.firstName} ${member.memberNumber} ${member.linkedUserId ?? ''}`.toLocaleLowerCase('es-AR');
        return haystack.includes(query);
      })
      .slice(0, 40);
  }, [memberSearch, members]);

  async function loadBoard() {
    setLoading(true);
    setError('');

    try {
      const board = await getActiveExecutiveBoard();
      const membersPreview = canEdit ? await createMembersRepository().listAlphabetical(100) : [];
      setTerm(board.term);
      setBoardMembers(board.members);
      setMembers(membersPreview);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar la Comisión Directiva.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBoard();
  }, [canEdit]);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setFormData((current) => ({
      ...current,
      [name]: value,
      ...(name === 'positionCode' ? { memberId: '' } : {}),
    }));

    if (name === 'positionCode') {
      setMemberSearch('');
    }
  };

  const handleToggleBoard = () => {
    if (isBoardOpen) {
      setIsEditorVisible(false);
    }
    setIsBoardOpen((current) => !current);
  };

  const handleToggleEditor = () => {
    setIsBoardOpen(true);
    setIsEditorVisible((current) => !current);
  };

  async function executeUpsert(payload: UpsertBoardMemberPayload) {
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await executiveBoardCallables.upsertBoardMember(payload);

      setNotice('Cargo de Comisión Directiva actualizado.');
      setFormData({
        memberId: '',
        positionCode: payload.positionCode,
      });
      setMemberSearch('');
      setPendingPayload(null);
      setPendingReplacement(null);
      setIsEditorVisible(false);
      await loadBoard();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No pudimos actualizar la Comisión Directiva.');
    } finally {
      setSaving(false);
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!canEdit) {
      setError('Solo el Comité Ejecutivo puede modificar la Comisión Directiva.');
      return;
    }

    if (!term) {
      setError('No hay periodo activo de Comisión Directiva.');
      return;
    }

    if (!selectedMember) {
      setError('Selecciona un socio existente.');
      return;
    }

    if (!selectedMember.linkedUserId) {
      setError('Ese socio todavia no tiene usuario Auth vinculado.');
      return;
    }

    if (!selectedPosition) {
      setError('Selecciona un cargo fijo de la Comisión Directiva.');
      return;
    }

    if (currentPositionMember?.memberId === selectedMember.id) {
      setError('Ese socio ya ocupa este cargo. Buscá y seleccioná un nuevo usuario para reemplazarlo.');
      return;
    }

    const payload: UpsertBoardMemberPayload = {
      termId: term.id,
      uid: selectedMember.linkedUserId,
      memberId: selectedMember.id,
      memberNumber: selectedMember.memberNumber,
      positionCode: selectedPosition.value,
      positionLabel: selectedPosition.label,
      fullNameSnapshot: memberDisplayName(selectedMember).toUpperCase(),
      order: selectedPosition.order,
      active: true,
    };
    const replacement = boardMembers.find(
      (member) =>
        member.active &&
        member.positionCode === payload.positionCode &&
        member.memberId !== payload.memberId,
    ) ?? null;

    setPendingPayload(payload);
    setPendingReplacement(replacement);
  };

  const activeBoardCount = boardMembers.filter((member) => member.active).length;
  const linkedBoardCount = boardMembers.filter((member) => member.uid).length;
  const boardPeriodLabel = term?.label ?? 'Sin periodo activo';
  const boardYearLabel = term?.label?.match(/\b20\d{2}\b/)?.[0] ?? '2026';
  const unresolvedBoardCount = term?.unresolvedBoardMembers?.length ?? 0;

  if (loading) {
    return (
      <div className="loading-state">
        <span className="loading-spinner" />
        <strong>Obteniendo datos</strong>
      </div>
    );
  }

  return (
    <div className="page-container member-directory-page club-page">
      <div className="accounting-shell club-accounting-shell">
        <section className="club-page-stack">
          <section className="floating-card accounting-hero club-hero">
            <div className="accounting-hero__copy">
              <p className="eyebrow">Nuestro club</p>
              <h1>Palpala Golf Tenis Club</h1>
              <p className="profile-note club-hero__description">
                Desde Palpala, el club sostiene una vida deportiva y social que
                combina golf, tenis, encuentros familiares y administracion
                institucional. Este espacio resume la identidad del Palpala Golf
                Tenis Club: una comunidad que cuida sus instalaciones, acompaña
                a sus socios y organiza cada actividad con criterio, cercania y
                sentido de pertenencia.
              </p>
            </div>
            <div className="accounting-hero__actions club-hero__brand">
              <img src={clubLogo} alt="" className="club-hero__logo" />
            </div>
          </section>

          {error && <div className="error-message">{error}</div>}
          {notice && <div className="accounting-success">{notice}</div>}

          <section
            className="floating-card accounting-primary-panel club-gallery-panel"
            aria-label="Imagenes institucionales del club"
          >
            <div className="accounting-section-header accounting-section-header--plain">
              <h2>Identidad del club</h2>
            </div>
            <div className="club-gallery">
              <figure className="club-photo-card">
                <figcaption>Golf, tenis y vida social</figcaption>
                <img src={clubImage} alt="Vista institucional del club" />
              </figure>

              <figure className="club-photo-card club-photo-card--placeholder">
                <figcaption>Canchas y espacios deportivos</figcaption>
                <div className="club-photo-placeholder">
                  <strong>Foto de cancha / tenis</strong>
                  <small>
                    Espacio reservado para una imagen institucional.
                  </small>
                </div>
              </figure>

              <figure className="club-photo-card club-photo-card--placeholder">
                <figcaption>Encuentros y salon social</figcaption>
                <div className="club-photo-placeholder">
                  <strong>Foto de eventos / salon</strong>
                  <small>
                    Espacio reservado para una segunda imagen del club.
                  </small>
                </div>
              </figure>
            </div>

            <div className="club-board-embedded">
              <div className="club-board-embedded__header">
                <div className="club-board-embedded__title">
                  <SquaredCircleButton
                    className="club-board-toggle-button-row-variant items-center gap-2"
                    aria-expanded={isBoardOpen}
                    label={
                      isBoardOpen
                        ? "Ocultar Comision Directiva"
                        : "Ver Comision Directiva"
                    }
                    title={
                      isBoardOpen
                        ? "Ocultar Comision Directiva"
                        : "Ver Comision Directiva"
                    }
                    onClick={handleToggleBoard}
                  >
                    <BoardCommitteeIcon />
                    <span>
                      <small className="club-board-period-pill no-background no-border">
                        {term?.label ?? "Cargos institucionales vigentes"}
                      </small>
                    </span>
                  </SquaredCircleButton>
                </div>
              </div>

              {isBoardOpen && (
                <div className="club-board-table-panel">
                  <div className="club-board-table-toolbar">
                    <strong>{boardYearLabel}</strong>
                    {canEdit && term && (
                      <UiActionButton
                        type="button"
                        variant="secondary"
                        className="club-action-button club-board-edit-button"
                        onClick={handleToggleEditor}
                      >
                        {isEditorVisible ? "Cerrar edicion" : "Modificar"}
                      </UiActionButton>
                    )}
                  </div>

                  {boardMembers.length > 0 ? (
                    <div className="club-board-table-wrap">
                      <table className="club-board-table">
                        <thead>
                          <tr>
                            <th scope="col">Cargo</th>
                            <th scope="col">Integrante</th>
                            <th scope="col">Socio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {boardMembers.map((member) => (
                            <BoardMemberRow key={member.id} member={member} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-state empty-state--inline">
                      No hay miembros activos cargados.
                    </div>
                  )}
                </div>
              )}

              {canEdit && term && isEditorVisible && (
                <form
                  className="accounting-panel accounting-entry-form club-board-editor-form club-board-editor-form--embedded"
                  onSubmit={handleSubmit}
                >
                  <div className="accounting-section-header accounting-section-header--plain club-board-editor-header">
                    <h2>Modificar Comision</h2>
                  </div>
                  <label className="form-field" htmlFor="positionCode">
                    <span>Cargo</span>
                    <select
                      id="positionCode"
                      name="positionCode"
                      value={formData.positionCode}
                      onChange={handleChange}
                    >
                      {BOARD_POSITION_OPTIONS.map((position) => (
                        <option key={position.value} value={position.value}>
                          {position.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="board-current-seat" aria-live="polite">
                    <span className="eyebrow">Usuario actual con cargo</span>
                    {currentPositionMember ? (
                      <>
                        <strong>
                          {currentPositionMember?.fullNameSnapshot ?? ""}
                        </strong>
                        <small>
                          {currentPositionMember?.positionLabel ?? ""} Â· Socio
                          #{currentPositionMember?.memberNumber ?? ""}
                        </small>
                      </>
                    ) : (
                      <>
                        <strong>Sin usuario asignado</strong>
                        <small>
                          {selectedPosition.label} todavia no tiene integrante
                          activo.
                        </small>
                      </>
                    )}
                  </div>

                  <label className="form-field" htmlFor="memberSearch">
                    <span>Buscar nuevo usuario</span>
                    <input
                      id="memberSearch"
                      type="search"
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="Nombre, apellido, socio o UID"
                    />
                  </label>

                  <label className="form-field" htmlFor="memberId">
                    <span>Nuevo usuario vinculado</span>
                    <select
                      id="memberId"
                      name="memberId"
                      value={formData.memberId}
                      onChange={handleChange}
                    >
                      <option value="">Seleccionar nuevo usuario</option>
                      {selectedMember &&
                        !filteredMembers.some(
                          (member) => member.id === selectedMember?.id,
                        ) && (
                          <option value={selectedMember?.id ?? ""}>
                            {`${selectedMember?.lastName ?? ""}, ${selectedMember?.firstName ?? ""}`}{" "}
                            - #{selectedMember?.memberNumber ?? ""}
                            {selectedMember?.linkedUserId
                              ? ""
                              : " - sin usuario"}
                          </option>
                        )}
                      {filteredMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {memberDisplayName(member)} - #{member.memberNumber}
                          {member.linkedUserId ? "" : " - sin usuario"}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="form-actions form-actions--right">
                    <UiActionButton type="submit" disabled={saving}>
                      Vincular cargo
                    </UiActionButton>
                  </div>
                </form>
              )}
            </div>
          </section>

          {term?.unresolvedBoardMembers?.length ? (
            <div className="error-message">
              Hay nombres de la Comisión Directiva sin resolver desde el seed:{" "}
              {term.unresolvedBoardMembers
                .map((issue) => issue.fullNameSnapshot)
                .join(", ")}
              .
            </div>
          ) : null}

        </section>
      </div>
      <ConfirmDialog
        open={Boolean(pendingPayload)}
        title={
          pendingReplacement
            ? "Reemplazar cargo de Comisión Directiva"
            : "Vincular cargo de Comisión Directiva"
        }
        description={
          pendingPayload ? (
            <>
              {pendingReplacement
                ? `${pendingReplacement.fullNameSnapshot} dejará el cargo ${pendingReplacement.positionLabel}. `
                : ""}
              Se asignará {pendingPayload.positionLabel} a{" "}
              {pendingPayload.fullNameSnapshot}. La acción sincroniza el rol
              Comisión Directiva: se lo quita al usuario anterior de ese cargo
              cuando corresponde y se lo agrega al nuevo.
            </>
          ) : null
        }
        confirmLabel={pendingReplacement ? "Reemplazar" : "Vincular"}
        tone={pendingReplacement ? "danger" : "default"}
        loading={saving}
        onCancel={() => {
          if (saving) {
            return;
          }
          setPendingPayload(null);
          setPendingReplacement(null);
        }}
        onConfirm={() => {
          if (pendingPayload) {
            void executeUpsert(pendingPayload);
          }
        }}
      />
    </div>
  );
}
