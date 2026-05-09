import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type {
  CreateEmployeePayload,
  EmployeeContractType,
  EmployeeDocument,
  EmployeeStatus,
  EntityWithId,
  UpdateEmployeePayload,
} from '../modules/users/domain/models';
import { createUsersCallables } from '../modules/users/functions/users.callables';
import { createEmployeesRepository } from '../modules/users/repositories/employees.repository';
import type {
  EmployeeContractFilter,
  EmployeeExpenseFilter,
  EmployeeListCursor,
  EmployeeStatusFilter,
} from '../modules/users/types/employee.types';

type EmployeeEditorState = {
  id?: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  dni: string;
  position: string;
  contractType: EmployeeContractType;
  status: EmployeeStatus;
  startDate: string;
  endDate: string;
  canSubmitExpenses: boolean;
  notes: string;
};

type EmployeeStats = {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  canSubmitExpenses: number;
};

type TimestampLike = { toDate: () => Date } | Date | string | number | null | undefined;

const CONTRACT_OPTIONS: Array<{ value: EmployeeContractType; label: string }> = [
  { value: 'monthly', label: 'Mensual' },
  { value: 'daily', label: 'Diaria' },
  { value: 'seasonal', label: 'Temporada' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'eventual', label: 'Eventual' },
];

const STATUS_OPTIONS: Array<{ value: EmployeeStatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

const EXPENSE_ACCESS_OPTIONS: Array<{ value: EmployeeExpenseFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'enabled', label: 'Puede rendir' },
  { value: 'disabled', label: 'Sin rendicion' },
];

function createEmptyEditorState(): EmployeeEditorState {
  return {
    employeeCode: '',
    firstName: '',
    lastName: '',
    dni: '',
    position: '',
    contractType: 'monthly',
    status: 'active',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    canSubmitExpenses: true,
    notes: '',
  };
}

function timestampToDate(value: TimestampLike): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  return null;
}

function formatDate(value: TimestampLike): string {
  const date = timestampToDate(value);
  return date ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(date) : 'Sin fecha';
}

function formatDateInput(value: TimestampLike): string {
  const date = timestampToDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function toIsoDate(value: string): string {
  return new Date(`${value}T00:00:00.000-03:00`).toISOString();
}

function getContractLabel(value: EmployeeContractType): string {
  return CONTRACT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getEmployeeDisplayName(employee: EntityWithId<EmployeeDocument>): string {
  return `${employee.lastName}, ${employee.firstName}`.trim();
}

function createEditorState(employee: EntityWithId<EmployeeDocument>): EmployeeEditorState {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode ?? '',
    firstName: employee.firstName,
    lastName: employee.lastName,
    dni: employee.dni ?? '',
    position: employee.position,
    contractType: employee.contractType,
    status: employee.status,
    startDate: formatDateInput(employee.startDate as TimestampLike),
    endDate: formatDateInput(employee.endDate as TimestampLike),
    canSubmitExpenses: employee.canSubmitExpenses,
    notes: employee.notes ?? '',
  };
}

function SummaryCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M6.7 5.3a1 1 0 0 1 1.4 0L12 9.17l3.9-3.88a1 1 0 1 1 1.4 1.42L13.41 10.6l3.89 3.9a1 1 0 0 1-1.42 1.4L12 12.01l-3.88 3.89a1 1 0 0 1-1.42-1.42l3.89-3.88-3.9-3.9a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M15.2 3.13a2.5 2.5 0 0 1 3.54 0l2.13 2.13a2.5 2.5 0 0 1 0 3.54l-10.5 10.5a1 1 0 0 1-.46.26l-4.5 1a1 1 0 0 1-1.2-1.2l1-4.5a1 1 0 0 1 .26-.46ZM17.8 4.54a.5.5 0 0 0-.7 0l-1.43 1.43 2.83 2.83 1.43-1.43a.5.5 0 0 0 0-.7ZM17.1 10.2l-2.83-2.83-7.6 7.6-.57 2.57 2.57-.57Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M5 10.75A1.25 1.25 0 1 1 5 13.25a1.25 1.25 0 0 1 0-2.5Zm7 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm7 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
    </svg>
  );
}

export function EmployeesAdmin() {
  const { interfaceMode } = useAuth();
  const canManageEmployees = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const usersCallables = useMemo(() => createUsersCallables(), []);
  const employeesRepository = useMemo(() => createEmployeesRepository(), []);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [statusFilter, setStatusFilter] = useState<EmployeeStatusFilter>('all');
  const [contractFilter, setContractFilter] = useState<EmployeeContractFilter>('all');
  const [expenseAccessFilter, setExpenseAccessFilter] = useState<EmployeeExpenseFilter>('all');
  const [nextCursor, setNextCursor] = useState<EmployeeListCursor>(null);
  const [hasMoreEmployees, setHasMoreEmployees] = useState(false);
  const [stats, setStats] = useState<EmployeeStats | null>(null);
  const [editorState, setEditorState] = useState<EmployeeEditorState>(createEmptyEditorState());
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [openEmployeeActionsId, setOpenEmployeeActionsId] = useState<string | null>(null);
  const [employeePendingStatusChange, setEmployeePendingStatusChange] = useState<EntityWithId<EmployeeDocument> | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  const loadStats = useCallback(async () => {
    const [totalEmployees, activeEmployees, canSubmitExpenses] = await Promise.all([
      employeesRepository.countAll(),
      employeesRepository.countActive(),
      employeesRepository.countExpenseEnabled(),
    ]);

    setStats({
      totalEmployees,
      activeEmployees,
      inactiveEmployees: Math.max(totalEmployees - activeEmployees, 0),
      canSubmitExpenses,
    });
  }, [employeesRepository]);

  const loadEmployees = useCallback(
    async ({ append = false, cursor = null }: { append?: boolean; cursor?: EmployeeListCursor } = {}) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        const page = await employeesRepository.listEmployees({
          search: deferredSearchQuery,
          status: statusFilter,
          contractType: contractFilter,
          expenseAccess: expenseAccessFilter,
          cursor,
          pageSize: 25,
        });

        setEmployees((current) => (append ? [...current, ...page.employees] : page.employees));
        setNextCursor(page.nextCursor);
        setHasMoreEmployees(page.hasMore);
        await loadStats();
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar empleados.');
      } finally {
        setLoading(false);
        setIsLoadingMore(false);
      }
    },
    [contractFilter, deferredSearchQuery, employeesRepository, expenseAccessFilter, loadStats, statusFilter],
  );

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (filtersRef.current && !filtersRef.current.contains(target)) {
        setIsFiltersOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const activeFilterCount =
    Number(statusFilter !== 'all') + Number(contractFilter !== 'all') + Number(expenseAccessFilter !== 'all');

  const openCreateModal = () => {
    setSelectedEmployeeId(null);
    setEditorState(createEmptyEditorState());
    setNotice('');
    setError('');
    setIsEditorOpen(true);
  };

  const openEditModal = (employee: EntityWithId<EmployeeDocument>) => {
    setSelectedEmployeeId(employee.id);
    setEditorState(createEditorState(employee));
    setNotice('');
    setError('');
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setSelectedEmployeeId(null);
    setEditorState(createEmptyEditorState());
  };

  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      closeEditor();
    }
  };

  const handleLoadMore = () => {
    if (!nextCursor) {
      return;
    }

    void loadEmployees({ append: true, cursor: nextCursor });
  };

  const handleEditorChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const target = event.currentTarget;
    const { name, value } = target;

    if (name === 'canSubmitExpenses' && target instanceof HTMLInputElement) {
      setEditorState((current) => ({ ...current, canSubmitExpenses: target.checked }));
      return;
    }

    setEditorState((current) => ({ ...current, [name]: value }));
  };

  const validateEditor = () => {
    if (!editorState.firstName.trim() || !editorState.lastName.trim()) {
      return 'Nombre y apellido son obligatorios.';
    }

    if (!editorState.position.trim()) {
      return 'El cargo o puesto es obligatorio.';
    }

    if (!editorState.startDate) {
      return 'La fecha de inicio es obligatoria.';
    }

    if (editorState.endDate && editorState.endDate < editorState.startDate) {
      return 'La fecha de baja no puede ser anterior al inicio.';
    }

    return '';
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageEmployees) {
      setError('No tenes permisos para modificar empleados.');
      return;
    }

    const validationMessage = validateEditor();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setIsSaving(true);
    setError('');
    setNotice('');

    try {
      if (selectedEmployee) {
        const payload: UpdateEmployeePayload = {
          employeeId: selectedEmployee.id,
          firstName: editorState.firstName.trim(),
          lastName: editorState.lastName.trim(),
          position: editorState.position.trim(),
          contractType: editorState.contractType,
          startDate: toIsoDate(editorState.startDate),
          endDate: editorState.endDate ? toIsoDate(editorState.endDate) : null,
          canSubmitExpenses: editorState.canSubmitExpenses,
          employeeCode: editorState.employeeCode.trim() || null,
          dni: editorState.dni.trim() || null,
          status: editorState.status,
          notes: editorState.notes.trim() || null,
        };
        await usersCallables.updateEmployee(payload);
        setNotice('Empleado actualizado.');
      } else {
        const payload: CreateEmployeePayload = {
          firstName: editorState.firstName.trim(),
          lastName: editorState.lastName.trim(),
          position: editorState.position.trim(),
          contractType: editorState.contractType,
          startDate: toIsoDate(editorState.startDate),
          canSubmitExpenses: editorState.canSubmitExpenses,
          ...(editorState.employeeCode.trim() ? { employeeCode: editorState.employeeCode.trim() } : {}),
          ...(editorState.dni.trim() ? { dni: editorState.dni.trim() } : {}),
          ...(editorState.endDate ? { endDate: toIsoDate(editorState.endDate) } : {}),
          ...(editorState.notes.trim() ? { notes: editorState.notes.trim() } : {}),
        };
        await usersCallables.createEmployee(payload);
        setNotice('Empleado dado de alta.');
      }

      closeEditor();
      await loadEmployees();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos guardar el empleado.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!employeePendingStatusChange) {
      return;
    }

    const nextStatus: EmployeeStatus = employeePendingStatusChange.status === 'active' ? 'inactive' : 'active';
    setIsSaving(true);
    setError('');

    try {
      await usersCallables.updateEmployee({
        employeeId: employeePendingStatusChange.id,
        status: nextStatus,
        endDate:
          nextStatus === 'inactive'
            ? new Date().toISOString()
            : null,
      });
      setNotice(nextStatus === 'active' ? 'Empleado reactivado.' : 'Empleado dado de baja.');
      setEmployeePendingStatusChange(null);
      setOpenEmployeeActionsId(null);
      await loadEmployees();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'No pudimos actualizar el estado.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page page-members-admin">
      <div className="page-gradient" />

      <section
        className="directory-shell w-100"
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: "3vh",
          marginBottom: "3vh",
        }}
      >
        <section className="floating-card directory-hero employee-directory-card" style={{width: "80%"}}>
          <div className="directory-hero__header">
            <div>
              <p className="eyebrow">Administracion de personal</p>
              <h1>Legajos de empleados</h1>
              <p className="profile-note">
                Alta, baja y modificacion de empleados con busqueda y filtros
                operativos.
              </p>
            </div>

            {canManageEmployees && (
              <div className="directory-hero__actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={openCreateModal}
                >
                  Nuevo empleado
                </button>
              </div>
            )}
          </div>

          <div className="summary-grid">
            <SummaryCard
              label="Empleados cargados"
              value={String(stats?.totalEmployees ?? employees.length)}
              helper="Legajos registrados"
            />
            <SummaryCard
              label="Activos"
              value={String(
                stats?.activeEmployees ??
                  employees.filter((employee) => employee.status === "active")
                    .length,
              )}
              helper="Disponibles para operar"
            />
            <SummaryCard
              label="Inactivos"
              value={String(
                stats?.inactiveEmployees ??
                  employees.filter((employee) => employee.status === "inactive")
                    .length,
              )}
              helper="Bajas administrativas"
            />
            <SummaryCard
              label="Rinden gastos"
              value={String(
                stats?.canSubmitExpenses ??
                  employees.filter((employee) => employee.canSubmitExpenses)
                    .length,
              )}
              helper="Habilitados para rendiciones"
            />
          </div>

          <div className="member-toolbar">
            <div className="member-toolbar__row">
              <label className="member-search member-search--wide">
                <span>Busqueda rapida</span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>

              <label className="form-field member-filter">
                <span>Estado</span>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as EmployeeStatusFilter)
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="member-toolbar__actions" ref={filtersRef}>
                <button
                  type="button"
                  className={`icon-button icon-button--ghost ${isFiltersOpen ? "icon-button--active" : ""}`}
                  aria-label="Otros filtros"
                  aria-expanded={isFiltersOpen}
                  onClick={() => setIsFiltersOpen((current) => !current)}
                >
                  <MoreIcon />
                  {activeFilterCount > 0 && (
                    <span className="notification-badge">
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                {isFiltersOpen && (
                  <div className="filter-popover">
                    <div className="filter-popover__header">
                      <strong>Otros filtros</strong>
                    </div>

                    <div className="filter-popover__row">
                      <span>Contrato</span>
                      <select
                        value={contractFilter}
                        onChange={(event) =>
                          setContractFilter(
                            event.target.value as EmployeeContractFilter,
                          )
                        }
                      >
                        <option value="all">Todos</option>
                        {CONTRACT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="filter-popover__row">
                      <span>Rendiciones</span>
                      <select
                        value={expenseAccessFilter}
                        onChange={(event) =>
                          setExpenseAccessFilter(
                            event.target.value as EmployeeExpenseFilter,
                          )
                        }
                      >
                        {EXPENSE_ACCESS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {notice && <div className="success-message">{notice}</div>}
          {error && <div className="error-message">{error}</div>}

          {loading ? (
            <div className="loading-state loading-state--inline">
              <span className="loading-spinner" />
              <strong>Obteniendo datos</strong>
            </div>
          ) : (
            <>
              <div className="directory-results">
                <strong>{employees.length} empleados en vista</strong>
                <small>
                  Ordenado por apellido y nombre. Usa filtros para acotar el
                  listado.
                </small>
              </div>

              <div className="member-table employee-table">
                <div className="member-table__head employee-table__head">
                  <span>Legajo</span>
                  <span>Persona</span>
                  <span>Trabajo</span>
                  <span>Rendiciones</span>
                  <span>Estado</span>
                  <span>Acciones</span>
                </div>

                <div className="member-table__body">
                  {employees.length === 0 ? (
                    <div className="empty-state empty-state--inline">
                      No encontramos empleados con esos filtros.
                    </div>
                  ) : (
                    employees.map((employee) => (
                      <article
                        key={employee.id}
                        className={`member-row employee-row ${openEmployeeActionsId === employee.id ? "member-row--menu-open" : ""}`}
                      >
                        <div className="member-cell">
                          <strong>
                            {employee.employeeCode || "Sin codigo"}
                          </strong>
                          <small>{employee.id}</small>
                        </div>

                        <div className="member-cell">
                          <strong>{getEmployeeDisplayName(employee)}</strong>
                          <small>
                            {employee.dni
                              ? `DNI ${employee.dni}`
                              : "DNI pendiente"}
                          </small>
                        </div>

                        <div className="member-cell">
                          <strong>{employee.position}</strong>
                          <small>
                            {getContractLabel(employee.contractType)} | desde{" "}
                            {formatDate(employee.startDate as TimestampLike)}
                          </small>
                        </div>

                        <div className="member-cell">
                          <span className="member-type-badge">
                            {employee.canSubmitExpenses
                              ? "Habilitado"
                              : "No habilitado"}
                          </span>
                          <small>
                            {employee.canSubmitExpenses
                              ? "Puede cargar gastos"
                              : "Sin carga de gastos"}
                          </small>
                        </div>

                        <div className="member-cell">
                          <span
                            className={`status-pill ${employee.status === "active" ? "" : "status-pill--bloqueado"}`}
                          >
                            {employee.status === "active"
                              ? "Activo"
                              : "Inactivo"}
                          </span>
                          <small>
                            {employee.endDate
                              ? `Baja ${formatDate(employee.endDate as TimestampLike)}`
                              : "Sin fecha de baja"}
                          </small>
                        </div>

                        <div className="member-actions">
                          {canManageEmployees && (
                            <button
                              type="button"
                              className="icon-button member-icon-button"
                              aria-label={`Editar a ${getEmployeeDisplayName(employee)}`}
                              onClick={() => openEditModal(employee)}
                            >
                              <EditIcon />
                            </button>
                          )}

                          {canManageEmployees && (
                            <button
                              type="button"
                              className={`icon-button member-icon-button ${openEmployeeActionsId === employee.id ? "icon-button--active" : ""}`}
                              aria-label={`Mas acciones para ${getEmployeeDisplayName(employee)}`}
                              aria-expanded={
                                openEmployeeActionsId === employee.id
                              }
                              onClick={() =>
                                setOpenEmployeeActionsId((current) =>
                                  current === employee.id ? null : employee.id,
                                )
                              }
                            >
                              <MoreIcon />
                            </button>
                          )}

                          {canManageEmployees &&
                            openEmployeeActionsId === employee.id && (
                              <div className="member-actions-menu">
                                <button
                                  type="button"
                                  className={
                                    employee.status === "active"
                                      ? "member-actions-menu__item member-actions-menu__item--danger"
                                      : "member-actions-menu__item"
                                  }
                                  onClick={() => {
                                    setOpenEmployeeActionsId(null);
                                    setEmployeePendingStatusChange(employee);
                                  }}
                                >
                                  {employee.status === "active"
                                    ? "Dar de baja empleado"
                                    : "Reactivar empleado"}
                                </button>
                              </div>
                            )}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>

              {hasMoreEmployees && (
                <div className="directory-results">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isLoadingMore}
                    onClick={handleLoadMore}
                  >
                    {isLoadingMore ? "Cargando..." : "Cargar mas empleados"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </section>

      {isEditorOpen && (
        <div className="modal-overlay" onClick={handleOverlayClick}>
          <section
            className="floating-card member-modal-card"
            role="dialog"
            aria-modal="true"
          >
            <div className="member-modal__header">
              <div className="member-modal__title">
                <p className="eyebrow">
                  {selectedEmployee
                    ? "Modificacion de empleado"
                    : "Alta de empleado"}
                </p>
                {selectedEmployee ? (
                  <h2>Actualizar legajo</h2>
                ) : (
                  <h2>Nuevo legajo</h2>
                )}
              </div>

              <div className="member-modal__header-actions">
                {selectedEmployee && (
                  <span
                    className={`status-pill ${editorState.status === "active" ? "" : "status-pill--bloqueado"}`}
                  >
                    {editorState.status === "active" ? "Activo" : "Inactivo"}
                  </span>
                )}

                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cerrar formulario"
                  onClick={closeEditor}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <form className="member-editor-form" onSubmit={handleSubmit}>
              <div className="employee-form-section member-editor-form__wide">
                <div className="employee-form-section__title">
                  <strong>Identificacion</strong>
                </div>
                <div className="employee-form-section__grid">
                  <label className="form-field" htmlFor="employeeCode">
                    <span>Codigo interno</span>
                    <input
                      id="employeeCode"
                      name="employeeCode"
                      type="text"
                      value={editorState.employeeCode}
                      onChange={handleEditorChange}
                    />
                  </label>

                  <label className="form-field" htmlFor="dni">
                    <span>DNI</span>
                    <input
                      id="dni"
                      name="dni"
                      type="text"
                      value={editorState.dni}
                      onChange={handleEditorChange}
                    />
                  </label>

                  <label className="form-field" htmlFor="lastName">
                    <span>Apellido</span>
                    <input
                      id="lastName"
                      name="lastName"
                      type="text"
                      value={editorState.lastName}
                      onChange={handleEditorChange}
                    />
                  </label>

                  <label className="form-field" htmlFor="firstName">
                    <span>Nombre</span>
                    <input
                      id="firstName"
                      name="firstName"
                      type="text"
                      value={editorState.firstName}
                      onChange={handleEditorChange}
                    />
                  </label>
                </div>
              </div>

              <div className="employee-form-section member-editor-form__wide">
                <div className="employee-form-section__title">
                  <strong>Trabajo</strong>
                </div>
                <div className="employee-form-section__grid">
                  <label
                    className="form-field employee-form-section__wide"
                    htmlFor="position"
                  >
                    <span>Puesto o funcion</span>
                    <input
                      id="position"
                      name="position"
                      type="text"
                      value={editorState.position}
                      onChange={handleEditorChange}
                    />
                  </label>

                  <label className="form-field" htmlFor="contractType">
                    <span>Tipo de contrato</span>
                    <select
                      id="contractType"
                      name="contractType"
                      value={editorState.contractType}
                      onChange={handleEditorChange}
                    >
                      {CONTRACT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field" htmlFor="startDate">
                    <span>Fecha de ingreso</span>
                    <input
                      id="startDate"
                      name="startDate"
                      type="date"
                      value={editorState.startDate}
                      onChange={handleEditorChange}
                    />
                  </label>
                </div>
              </div>

              <div className="employee-form-section member-editor-form__wide">
                <div className="employee-form-section__title">
                  <strong>Estado operativo</strong>
                </div>
                <div className="employee-form-section__grid">
                  {selectedEmployee && (
                    <label className="form-field" htmlFor="status">
                      <span>Estado</span>
                      <select
                        id="status"
                        name="status"
                        value={editorState.status}
                        onChange={handleEditorChange}
                      >
                        <option value="active">Activo</option>
                        <option value="inactive">Inactivo</option>
                      </select>
                    </label>
                  )}

                  <label className="form-field" htmlFor="endDate">
                    <span>Fecha de baja</span>
                    <input
                      id="endDate"
                      name="endDate"
                      type="date"
                      value={editorState.endDate}
                      onChange={handleEditorChange}
                    />
                  </label>

                  <label
                    className="check-field employee-form-section__wide"
                    htmlFor="canSubmitExpenses"
                  >
                    <input
                      id="canSubmitExpenses"
                      name="canSubmitExpenses"
                      type="checkbox"
                      checked={editorState.canSubmitExpenses}
                      onChange={handleEditorChange}
                    />
                    <span>Puede cargar rendiciones y gastos</span>
                  </label>
                </div>
              </div>

              <label
                className="form-field member-editor-form__wide"
                htmlFor="notes"
              >
                <span>Observaciones</span>
                <textarea
                  id="notes"
                  name="notes"
                  value={editorState.notes}
                  onChange={handleEditorChange}
                  rows={4}
                />
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeEditor}
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSaving}
                >
                  {isSaving
                    ? "Guardando..."
                    : selectedEmployee
                      ? "Guardar cambios"
                      : "Dar de alta empleado"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(employeePendingStatusChange)}
        title={
          employeePendingStatusChange?.status === "active"
            ? "Dar de baja empleado"
            : "Reactivar empleado"
        }
        description={
          employeePendingStatusChange ? (
            <>
              Vas a{" "}
              {employeePendingStatusChange.status === "active"
                ? "dar de baja"
                : "reactivar"}{" "}
              a {getEmployeeDisplayName(employeePendingStatusChange)}. El legajo
              y los movimientos vinculados se conservan.
            </>
          ) : null
        }
        confirmLabel={
          employeePendingStatusChange?.status === "active"
            ? "Dar de baja"
            : "Reactivar"
        }
        tone={
          employeePendingStatusChange?.status === "active"
            ? "danger"
            : "default"
        }
        loading={isSaving}
        onCancel={() => setEmployeePendingStatusChange(null)}
        onConfirm={() => void handleConfirmStatusChange()}
      />
    </div>
  );
}
