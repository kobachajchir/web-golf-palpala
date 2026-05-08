import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
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
  positionLabel: string;
  order: string;
};

const executiveBoardCallables = createExecutiveBoardCallables();

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function memberDisplayName(member: EntityWithId<MemberDocument>) {
  return `${member.lastName}, ${member.firstName}`;
}

function BoardMemberRow({ member }: { member: EntityWithId<ExecutiveBoardMemberDocument> }) {
  return (
    <article className="member-row">
      <div className="member-cell">
        <strong>{member.positionLabel}</strong>
        <small>{member.positionCode}</small>
      </div>
      <div className="member-cell">
        <strong>{member.fullNameSnapshot}</strong>
        <small>Socio #{member.memberNumber}</small>
      </div>
      <div className="member-cell">
        <span className="member-type-badge">directivo</span>
        <small>{member.uid ? 'Usuario vinculado' : 'Sin usuario'}</small>
      </div>
      <div className="member-cell">
        <strong>Orden {member.order}</strong>
        <small>{member.active ? 'Activo' : 'Inactivo'}</small>
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
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<BoardFormState>({
    memberId: '',
    positionCode: '',
    positionLabel: '',
    order: '1',
  });

  const selectedMember = useMemo(
    () => members.find((member) => member.id === formData.memberId) ?? null,
    [formData.memberId, members],
  );

  async function loadBoard() {
    setLoading(true);
    setError('');

    try {
      const board = await getActiveExecutiveBoard();
      const membersPreview = canEdit ? await createMembersRepository().listAlphabetical(100) : [];
      setTerm(board.term);
      setBoardMembers(board.members);
      setMembers(membersPreview);
      setFormData((current) => ({
        ...current,
        memberId: current.memberId || membersPreview[0]?.id || '',
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar la directiva.');
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
      [name]: name === 'positionLabel' && !current.positionCode ? value : value,
      ...(name === 'positionLabel' && !current.positionCode ? { positionCode: slugify(value) } : {}),
    }));
  };

  async function executeUpsert(payload: UpsertBoardMemberPayload) {
    setSaving(true);
    setError('');
    setNotice('');

    try {
      await executiveBoardCallables.upsertBoardMember(payload);

      setNotice('Cargo de directiva actualizado.');
      setFormData({
        memberId: payload.memberId,
        positionCode: '',
        positionLabel: '',
        order: String(payload.order + 1),
      });
      setPendingPayload(null);
      setPendingReplacement(null);
      setIsEditorVisible(false);
      await loadBoard();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No pudimos actualizar la directiva.');
    } finally {
      setSaving(false);
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!canEdit) {
      setError('Solo un directivo puede modificar la junta directiva.');
      return;
    }

    if (!term) {
      setError('No hay periodo activo de comision directiva.');
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

    const order = Number(formData.order);
    if (!formData.positionLabel.trim() || !formData.positionCode.trim() || !Number.isInteger(order)) {
      setError('Completa cargo, codigo y orden.');
      return;
    }

    const payload: UpsertBoardMemberPayload = {
      termId: term.id,
      uid: selectedMember.linkedUserId,
      memberId: selectedMember.id,
      memberNumber: selectedMember.memberNumber,
      positionCode: formData.positionCode.trim(),
      positionLabel: formData.positionLabel.trim(),
      fullNameSnapshot: memberDisplayName(selectedMember).toUpperCase(),
      order,
      active: true,
    };
    const replacement = boardMembers.find(
      (member) =>
        member.active &&
        member.positionCode === payload.positionCode &&
        member.memberId !== payload.memberId,
    ) ?? null;

    if (replacement) {
      setPendingPayload(payload);
      setPendingReplacement(replacement);
      return;
    }

    await executeUpsert(payload);
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
        <section className="floating-card directory-main-card">
          <div className="directory-hero">
            <div>
              <p className="eyebrow">El Club</p>
              <h1>Palpala Golf Club</h1>
              <p className="profile-note">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo un club ordenado,
                social y deportivo, con espacios preparados para socios, familias y visitantes.
              </p>
            </div>
            {canEdit && term && (
              <button type="button" className="btn-primary" onClick={() => setIsEditorVisible((current) => !current)}>
                {isEditorVisible ? 'Cerrar edicion' : 'Modificar directiva'}
              </button>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}
          {notice && <div className="accounting-success">{notice}</div>}

          <div className="club-photo-placeholder">
            <span>Espacio para foto institucional del club</span>
          </div>

          {term?.unresolvedBoardMembers?.length ? (
            <div className="error-message">
              Hay nombres de la directiva sin resolver desde el seed:{' '}
              {term.unresolvedBoardMembers.map((issue) => issue.fullNameSnapshot).join(', ')}.
            </div>
          ) : null}

          <div className="club-collapse">
            <button type="button" className="club-collapse__button" onClick={() => setIsBoardOpen((current) => !current)}>
              <span>
                <strong>Junta directiva</strong>
                <small>{term?.label ?? 'Cargos institucionales vigentes del club.'}</small>
              </span>
              <span>{isBoardOpen ? 'Ocultar' : 'Ver'}</span>
            </button>

            {isBoardOpen && (
              <div className="member-table">
                <div className="member-table__head">
                  <span>Cargo</span>
                  <span>Nombre</span>
                  <span>Rol</span>
                  <span>Estado</span>
                </div>
                <div className="member-table__body">
                  {boardMembers.length > 0 ? (
                    boardMembers.map((member) => <BoardMemberRow key={member.id} member={member} />)
                  ) : (
                    <div className="empty-state empty-state--inline">No hay miembros activos cargados.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {canEdit && term && isEditorVisible && (
            <form className="member-editor-form" onSubmit={handleSubmit}>
              <label className="form-field" htmlFor="memberId">
                <span>Socio</span>
                <select id="memberId" name="memberId" value={formData.memberId} onChange={handleChange}>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {memberDisplayName(member)} - #{member.memberNumber}
                      {member.linkedUserId ? '' : ' - sin usuario'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field" htmlFor="positionLabel">
                <span>Cargo</span>
                <input
                  id="positionLabel"
                  name="positionLabel"
                  value={formData.positionLabel}
                  onChange={handleChange}
                  placeholder="Presidente"
                />
              </label>

              <label className="form-field" htmlFor="positionCode">
                <span>Codigo</span>
                <input
                  id="positionCode"
                  name="positionCode"
                  value={formData.positionCode}
                  onChange={handleChange}
                  placeholder="presidente"
                />
              </label>

              <label className="form-field" htmlFor="order">
                <span>Orden</span>
                <input id="order" name="order" type="number" value={formData.order} onChange={handleChange} />
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
        open={Boolean(pendingPayload && pendingReplacement)}
        title="Reemplazar cargo de directiva"
        description={
          pendingReplacement ? (
            <>
              {pendingReplacement.fullNameSnapshot} dejara el cargo {pendingReplacement.positionLabel}. Si no ocupa otro cargo
              activo, tambien se le quitara el rol directivo y se sincronizaran sus claims.
            </>
          ) : null
        }
        confirmLabel="Reemplazar"
        tone="danger"
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
