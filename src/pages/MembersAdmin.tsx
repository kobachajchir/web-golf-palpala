import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Link } from 'react-router-dom';
import {
  getClubMembers,
  matchesClubMemberSearch,
  resetClubMemberDirectory,
  saveClubMember,
  setClubMemberActive,
  type ClubMemberDraft,
  type ClubMemberRecord,
  type ClubMemberTypeId,
} from '../modules/users/local/memberDirectory';

type MemberTypeFilter = 'all' | ClubMemberTypeId;
type ActivityFilter = 'all' | 'active' | 'inactive';
type MemberEditorState = ClubMemberDraft;

const MEMBER_TYPE_OPTIONS: Array<{ value: ClubMemberTypeId; label: string }> = [
  { value: 'pleno', label: 'Socio pleno' },
  { value: 'vitalicio', label: 'Vitalicio' },
  { value: 'menor', label: 'Socio menor' },
  { value: 'licencia', label: 'Licencia' },
  { value: 'grupo_familiar_asociado', label: 'Grupo familiar asociado' },
  { value: 'grupo_familiar_titular', label: 'Grupo familiar titular' },
];

const ACTIVITY_FILTER_OPTIONS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

function createEmptyEditorState(): MemberEditorState {
  return {
    memberNumber: '',
    fullName: '',
    dni: '',
    aagMembershipNumber: '',
    membershipStatusLabel: 'SOCIO PLENO',
    memberTypeId: 'pleno',
    feeDeductionLabel: '',
    notes: '',
    active: true,
  };
}

function createEditorState(member: ClubMemberRecord): MemberEditorState {
  return {
    id: member.id,
    memberNumber: member.memberNumber,
    fullName: member.fullName,
    dni: member.dni ?? '',
    aagMembershipNumber: member.aagMembershipNumber ?? '',
    membershipStatusLabel: member.membershipStatusLabel,
    memberTypeId: member.memberTypeId,
    feeDeductionLabel: member.feeDeductionLabel ?? '',
    notes: member.notes ?? '',
    active: member.active,
  };
}

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function MembersAdmin() {
  const [members, setMembers] = useState<ClubMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [memberTypeFilter, setMemberTypeFilter] = useState<MemberTypeFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [editorState, setEditorState] = useState<MemberEditorState>(createEmptyEditorState());
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    let mounted = true;

    void getClubMembers()
      .then((loadedMembers) => {
        if (!mounted) {
          return;
        }

        setMembers(loadedMembers);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!mounted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el padron.');
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const matchesSearch = matchesClubMemberSearch(member, deferredSearchQuery);
      const matchesType = memberTypeFilter === 'all' ? true : member.memberTypeId === memberTypeFilter;
      const matchesActivity =
        activityFilter === 'all'
          ? true
          : activityFilter === 'active'
            ? member.active
            : !member.active;

      return matchesSearch && matchesType && matchesActivity;
    });
  }, [activityFilter, deferredSearchQuery, memberTypeFilter, members]);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  );

  const summary = useMemo(() => {
    const households = new Set(
      members.filter((member) => member.householdSize > 1).map((member) => member.memberNumber),
    );

    return {
      totalMembers: members.length,
      activeMembers: members.filter((member) => member.active).length,
      households: households.size,
      withAagMembership: members.filter((member) => Boolean(member.aagMembershipNumber)).length,
    };
  }, [members]);

  const handleEditorChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = event.target;
    const nextValue = type === 'checkbox' ? (event.target as HTMLInputElement).checked : value;

    setEditorState((current) => ({
      ...current,
      [name]: nextValue,
    }));
  };

  const handleSelectMember = (member: ClubMemberRecord) => {
    startTransition(() => {
      setSelectedMemberId(member.id);
      setEditorState(createEditorState(member));
      setError('');
    });
  };

  const handleCreateNew = () => {
    startTransition(() => {
      setSelectedMemberId(null);
      setEditorState(createEmptyEditorState());
      setError('');
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!editorState.memberNumber.trim() || !editorState.fullName.trim()) {
      setError('El numero de socio y el nombre completo son obligatorios.');
      return;
    }

    setIsSaving(true);

    try {
      const savedMember = await saveClubMember(editorState);
      const nextMembers = await getClubMembers();
      setMembers(nextMembers);
      setSelectedMemberId(savedMember.id);
      setEditorState(createEditorState(savedMember));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos guardar el socio.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (member: ClubMemberRecord) => {
    setError('');

    try {
      await setClubMemberActive(member.id, !member.active);
      const nextMembers = await getClubMembers();
      setMembers(nextMembers);

      if (selectedMemberId === member.id) {
        const updatedMember = nextMembers.find((entry) => entry.id === member.id);
        if (updatedMember) {
          setEditorState(createEditorState(updatedMember));
        }
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'No pudimos actualizar el estado del socio.');
    }
  };

  const handleResetDirectory = async () => {
    setLoading(true);
    setError('');

    try {
      const resetMembers = await resetClubMemberDirectory();
      setMembers(resetMembers);
      setSelectedMemberId(null);
      setEditorState(createEmptyEditorState());
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'No pudimos restaurar el padron base.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container member-directory-page">
      <div className="directory-shell">
        <section className="floating-card directory-main-card">
          <div className="directory-hero">
            <div>
              <p className="eyebrow">Gestion de socios</p>
              <h1>Padron del club</h1>
              <p className="profile-note">
                Busca por apellido, nombre, numero interno, ID o DNI y entra a la ficha de membresia en un click.
              </p>
            </div>

            <div className="directory-hero__actions">
              <button type="button" className="btn-secondary" onClick={handleResetDirectory}>
                Restaurar padron base
              </button>
              <button type="button" className="btn-primary" onClick={handleCreateNew}>
                Nuevo socio
              </button>
            </div>
          </div>

          <div className="summary-grid">
            <SummaryCard label="Socios cargados" value={String(summary.totalMembers)} helper="Padron operativo local" />
            <SummaryCard label="Activos" value={String(summary.activeMembers)} helper="Disponibles para operar" />
            <SummaryCard label="Grupos familiares" value={String(summary.households)} helper="Detectados por nro. socio" />
            <SummaryCard label="Con matricula AAG" value={String(summary.withAagMembership)} helper="Vinculables al golf" />
          </div>

          <div className="member-toolbar">
            <label className="member-search">
              <span>Busqueda rapida</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Buscar por nombre, apellido, socio, ID, DNI o matricula AAG"
              />
            </label>

            <label className="form-field member-filter" htmlFor="memberTypeFilter">
              <span>Tipo</span>
              <select
                id="memberTypeFilter"
                value={memberTypeFilter}
                onChange={(event) => setMemberTypeFilter(event.target.value as MemberTypeFilter)}
              >
                <option value="all">Todos los tipos</option>
                {MEMBER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field member-filter" htmlFor="activityFilter">
              <span>Estado</span>
              <select
                id="activityFilter"
                value={activityFilter}
                onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)}
              >
                {ACTIVITY_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <div className="error-message">{error}</div>}

          {loading ? (
            <div className="empty-state empty-state--inline">Cargando padron del club...</div>
          ) : (
            <>
              <div className="directory-results">
                <strong>{filteredMembers.length} resultados</strong>
                <small>Buscador por nombre, apellido, socio, ID, DNI y matricula AAG</small>
              </div>

              <div className="member-table">
                <div className="member-table__head">
                  <span>Socio</span>
                  <span>Nombre</span>
                  <span>Tipo</span>
                  <span>Membresia</span>
                  <span>AAG</span>
                  <span>Acciones</span>
                </div>

                <div className="member-table__body">
                  {filteredMembers.length === 0 ? (
                    <div className="empty-state empty-state--inline">
                      No encontramos socios con esos filtros.
                    </div>
                  ) : (
                    filteredMembers.map((member) => (
                      <article
                        key={member.id}
                        className={`member-row ${selectedMemberId === member.id ? 'member-row--selected' : ''}`}
                      >
                        <div className="member-cell">
                          <strong>#{member.memberNumber}</strong>
                          <small>{member.id}</small>
                        </div>

                        <div className="member-cell">
                          <strong>{member.displayName}</strong>
                          <small>{member.dni ? `DNI ${member.dni}` : 'DNI pendiente'}</small>
                        </div>

                        <div className="member-cell">
                          <span className="member-type-badge">{member.memberTypeLabel}</span>
                          {member.householdSize > 1 && (
                            <small>{member.isFamilyHolder ? 'Titular familiar' : 'Integrante familiar'}</small>
                          )}
                        </div>

                        <div className="member-cell">
                          <strong>{member.membershipStatusLabel}</strong>
                          <small>{member.feeDeductionLabel ?? 'Sin deduccion informada'}</small>
                        </div>

                        <div className="member-cell">
                          <strong>{member.aagMembershipNumber ?? 'Sin matricula'}</strong>
                          <small>{member.active ? 'Activo' : 'Inactivo'}</small>
                        </div>

                        <div className="member-actions">
                          <button type="button" className="btn-secondary" onClick={() => handleSelectMember(member)}>
                            Editar
                          </button>
                          <Link className="btn-primary" to={`/admin/members/${member.id}`}>
                            Ver perfil
                          </Link>
                          <button
                            type="button"
                            className="member-action-link"
                            onClick={() => void handleToggleActive(member)}
                          >
                            {member.active ? 'Desactivar' : 'Reactivar'}
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        <aside className="floating-card member-editor-card">
          <div className="member-editor__header">
            <div>
              <p className="eyebrow">{selectedMember ? 'Edicion profesional' : 'Alta de socio'}</p>
              <h2>{selectedMember ? 'Actualizar registro' : 'Nuevo registro'}</h2>
            </div>
            {selectedMember && (
              <span className={`status-pill ${selectedMember.active ? '' : 'status-pill--bloqueado'}`}>
                {selectedMember.active ? 'Activo' : 'Inactivo'}
              </span>
            )}
          </div>

          <p className="profile-note">
            El formulario separa membresia, identificadores y observaciones sin mezclar informacion financiera.
          </p>

          <form className="member-editor-form" onSubmit={handleSubmit}>
            <label className="form-field" htmlFor="memberNumber">
              <span>Nro. socio</span>
              <input
                id="memberNumber"
                name="memberNumber"
                type="text"
                value={editorState.memberNumber}
                onChange={handleEditorChange}
                placeholder="Ej. 547"
              />
            </label>

            <label className="form-field member-editor-form__wide" htmlFor="fullName">
              <span>Apellido y nombre</span>
              <input
                id="fullName"
                name="fullName"
                type="text"
                value={editorState.fullName}
                onChange={handleEditorChange}
                placeholder="Ej. Traversi Patricia"
              />
            </label>

            <label className="form-field" htmlFor="memberTypeId">
              <span>Tipo interno</span>
              <select
                id="memberTypeId"
                name="memberTypeId"
                value={editorState.memberTypeId}
                onChange={handleEditorChange}
              >
                {MEMBER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="membershipStatusLabel">
              <span>Estado de membresia</span>
              <input
                id="membershipStatusLabel"
                name="membershipStatusLabel"
                type="text"
                value={editorState.membershipStatusLabel}
                onChange={handleEditorChange}
                placeholder="SOCIO PLENO"
              />
            </label>

            <label className="form-field" htmlFor="aagMembershipNumber">
              <span>Matricula AAG</span>
              <input
                id="aagMembershipNumber"
                name="aagMembershipNumber"
                type="text"
                value={editorState.aagMembershipNumber ?? ''}
                onChange={handleEditorChange}
                placeholder="Ej. 22443"
              />
            </label>

            <label className="form-field" htmlFor="dni">
              <span>DNI</span>
              <input
                id="dni"
                name="dni"
                type="text"
                value={editorState.dni ?? ''}
                onChange={handleEditorChange}
                placeholder="Pendiente de completar"
              />
            </label>

            <label className="form-field member-editor-form__wide" htmlFor="feeDeductionLabel">
              <span>Cuota deducida</span>
              <input
                id="feeDeductionLabel"
                name="feeDeductionLabel"
                type="text"
                value={editorState.feeDeductionLabel ?? ''}
                onChange={handleEditorChange}
                placeholder="Ej. 50% Socio pleno"
              />
            </label>

            <label className="form-field member-editor-form__wide" htmlFor="notes">
              <span>Observaciones</span>
              <textarea
                id="notes"
                name="notes"
                value={editorState.notes ?? ''}
                onChange={handleEditorChange}
                placeholder="Notas internas de la membresia"
                rows={4}
              />
            </label>

            <label className="check-field member-editor-form__wide" htmlFor="active">
              <input
                id="active"
                name="active"
                type="checkbox"
                checked={editorState.active}
                onChange={handleEditorChange}
              />
              <span>Registro activo en el padron operativo</span>
            </label>

            <div className="form-actions">
              {selectedMember && (
                <button type="button" className="btn-secondary" onClick={handleCreateNew}>
                  Limpiar formulario
                </button>
              )}
              <button type="submit" className="btn-primary" disabled={isSaving}>
                {isSaving ? 'Guardando...' : selectedMember ? 'Guardar cambios' : 'Crear socio'}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
