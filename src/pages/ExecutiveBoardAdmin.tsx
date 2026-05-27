import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ClubContactForm } from '../components/ClubContactForm';
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

function BoardMemberRow({ member }: { member: EntityWithId<ExecutiveBoardMemberDocument> }) {
  return (
    <article className="member-row board-member-row">
      <div className="member-cell">
        <strong>{member.positionLabel}</strong>
      </div>
      <div className="member-cell">
        <strong>{member.fullNameSnapshot}</strong>
        <small>Socio #{member.memberNumber}</small>
      </div>
      <div className="member-cell">
        <span className="member-type-badge">Comisión Directiva</span>
        <small>
          {member.active ? 'Activo' : 'Inactivo'}
          {member.uid ? ' · Usuario vinculado' : ' · Sin usuario'}
        </small>
      </div>
    </article>
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

  const handleToggleEditor = () => {
    setIsBoardOpen(false);
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

  if (loading) {
    return (
      <div className="loading-state">
        <span className="loading-spinner" />
        <strong>Obteniendo datos</strong>
      </div>
    );
  }

  return (
    <div className="page-container member-directory-page">
      <div className="directory-shell directory-shell--full">
        <section className="floating-card directory-main-card items-center">
          <div className="directory-hero club-hero">
            <img src={clubLogo} alt="" className="club-hero__logo" />
            <div>
              <p className="eyebrow">El Club</p>
              <h1>Palpala Golf Tenis Club</h1>
              <p className="profile-note">
                Desde Palpala, el club sostiene una vida deportiva y social que
                combina golf, tenis, encuentros familiares y administracion
                institucional. Este espacio resume la identidad del Palpala Golf
                Tenis Club: una comunidad que cuida sus instalaciones, acompaña
                a sus socios y organiza cada actividad con criterio, cercania y
                sentido de pertenencia.
              </p>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}
          {notice && <div className="accounting-success">{notice}</div>}

          <div
            className="club-gallery"
            aria-label="Imagenes institucionales del club"
          >
            <figure className="club-photo-card">
              <figcaption>Golf, tenis y vida social</figcaption>
              <img src={clubImage} alt="Vista institucional del club" />
            </figure>

            <figure className="club-photo-card club-photo-card--placeholder">
              <figcaption>Canchas y espacios deportivos</figcaption>
              <div className="club-photo-placeholder">
                <strong>Foto de cancha / tenis</strong>
                <small>Espacio reservado para una imagen institucional.</small>
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

          {term?.unresolvedBoardMembers?.length ? (
            <div className="error-message">
              Hay nombres de la Comisión Directiva sin resolver desde el seed:{" "}
              {term.unresolvedBoardMembers
                .map((issue) => issue.fullNameSnapshot)
                .join(", ")}
              .
            </div>
          ) : null}

          <div className="club-collapse">
            <div className="club-collapse__header">
              <span>
                <strong>Comisión Directiva</strong>
                <small>
                  {term?.label ?? "Cargos institucionales vigentes del club."}
                </small>
              </span>
              <div className="club-collapse__actions">
                <button
                  type="button"
                  className="btn-secondary club-action-button"
                  onClick={() => setIsBoardOpen((current) => !current)}
                >
                  {isBoardOpen ? "Ocultar" : "Ver"}
                </button>
                {canEdit && term && (
                  <button
                    type="button"
                    className="btn-secondary club-action-button"
                    onClick={handleToggleEditor}
                  >
                    {isEditorVisible ? "Cerrar edición" : "Modificar Comisión"}
                  </button>
                )}
              </div>
            </div>

            {isBoardOpen && (
              <div className="member-table board-member-table">
                <div className="member-table__head board-member-row">
                  <span>Cargo</span>
                  <span>Nombre</span>
                </div>
                <div className="member-table__body">
                  {boardMembers.length > 0 ? (
                    boardMembers.map((member) => (
                      <BoardMemberRow key={member.id} member={member} />
                    ))
                  ) : (
                    <div className="empty-state empty-state--inline">
                      No hay miembros activos cargados.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <section id="contacto" className="club-contact-card">
            <ClubContactForm showPersonalFields={false} />
          </section>

          {canEdit && term && isEditorVisible && (
            <form className="member-editor-form" onSubmit={handleSubmit}>
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
                    <strong>{currentPositionMember.fullNameSnapshot}</strong>
                    <small>
                      {currentPositionMember.positionLabel} · Socio #
                      {currentPositionMember.memberNumber}
                    </small>
                  </>
                ) : (
                  <>
                    <strong>Sin usuario asignado</strong>
                    <small>
                      {selectedPosition.label} todavía no tiene integrante
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
                      (member) => member.id === selectedMember.id,
                    ) && (
                      <option value={selectedMember.id}>
                        {memberDisplayName(selectedMember)} - #
                        {selectedMember.memberNumber}
                        {selectedMember.linkedUserId ? "" : " - sin usuario"}
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

              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={saving}>
                  Vincular cargo
                </button>
              </div>
            </form>
          )}
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
