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
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UiActionButton } from '../components/UiActionButton';
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

type EmployeeAccessState = {
  employee: EntityWithId<EmployeeDocument>;
  email: string;
  inviteLink: string;
  isSubmitting: boolean;
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

type IconType =
  | "calendar"
  | "check"
  | "clock"
  | "chevron"
  | "flag"
  | "list"
  | "plus"
  | "search"
  | "settings"
  | "score"
  | "trophy"
  | "users";

function Icon({ type }: { type: IconType }) {
  const icons: Record<IconType, ReactNode> = {
    calendar: (
      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v12A2.5 2.5 0 0 1 19.5 21h-15A2.5 2.5 0 0 1 2 18.5v-12A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1Zm12.5 8h-15v8.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5V10ZM5 6a.5.5 0 0 0-.5.5V8h15V6.5A.5.5 0 0 0 19 6H5Z" />
    ),
    check: (
      <path d="M9.2 16.6 4.8 12.2a1 1 0 0 1 1.4-1.4l3 3 8.6-8.6a1 1 0 0 1 1.4 1.4l-9.3 9.3a1 1 0 0 1-1.4 0Z" />
    ),
    clock: (
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5a1 1 0 1 0-2 0v5a1 1 0 0 0 .45.83l3.5 2.3a1 1 0 0 0 1.1-1.66L13 11.47V7Z" />
    ),
    chevron: (
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    ),
    flag: (
      <path d="M5 3a1 1 0 0 1 2 0v1h8.7a1 1 0 0 1 .86 1.5L15 8l1.56 2.5A1 1 0 0 1 15.7 12H7v8a1 1 0 1 1-2 0V3Z" />
    ),
    list: (
      <path d="M5 6.5A1.5 1.5 0 1 1 2 6.5a1.5 1.5 0 0 1 3 0ZM8 5.5h13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2ZM5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm3-1h13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm-3 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm3-1h13a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z" />
    ),
    plus: (
      <path d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" />
    ),
    search: (
      <path d="M10.5 4a6.5 6.5 0 0 1 5.15 10.47l4.44 4.44a1 1 0 0 1-1.42 1.42l-4.44-4.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    ),
    settings: (
      <path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8.7 3.2-.93-.54a7.8 7.8 0 0 0-.7-1.7l.28-1.04a1 1 0 0 0-.26-.98l-1.03-1.03a1 1 0 0 0-.98-.26l-1.04.28a7.8 7.8 0 0 0-1.7-.7l-.54-.93A1 1 0 0 0 13.03 3h-2.06a1 1 0 0 0-.87.5l-.54.93a7.8 7.8 0 0 0-1.7.7l-1.04-.28a1 1 0 0 0-.98.26L4.81 6.14a1 1 0 0 0-.26.98l.28 1.04a7.8 7.8 0 0 0-.7 1.7l-.93.54a1 1 0 0 0-.5.87v2.06a1 1 0 0 0 .5.87l.93.54c.17.6.4 1.17.7 1.7l-.28 1.04a1 1 0 0 0 .26.98l1.03 1.03a1 1 0 0 0 .98.26l1.04-.28c.53.3 1.1.53 1.7.7l.54.93a1 1 0 0 0 .87.5h2.06a1 1 0 0 0 .87-.5l.54-.93c.6-.17 1.17-.4 1.7-.7l1.04.28a1 1 0 0 0 .98-.26l1.03-1.03a1 1 0 0 0 .26-.98l-.28-1.04c.3-.53.53-1.1.7-1.7l.93-.54a1 1 0 0 0 .5-.87v-2.06a1 1 0 0 0-.5-.87Z" />
    ),
    score: (
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4v2h10V7H7Zm0 4v2h4v-2H7Zm6 0v2h4v-2h-4Zm-6 4v2h4v-2H7Zm6 0v2h4v-2h-4Z" />
    ),
    trophy: (
      <path d="M7 3h10v2h3a1 1 0 0 1 1 1v2a5 5 0 0 1-5 5h-.28A5 5 0 0 1 13 15.9V19h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.1A5 5 0 0 1 8.28 13H8a5 5 0 0 1-5-5V6a1 1 0 0 1 1-1h3V3Zm0 4H5v1a3 3 0 0 0 2.25 2.9A7.5 7.5 0 0 1 7 9V7Zm10 0v2c0 .66-.09 1.3-.25 1.9A3 3 0 0 0 19 8V7h-2Z" />
    ),
    users: (
      <path d="M9 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM2 20a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1H2v-1Zm15 1a4 4 0 0 0-2.15-3.54A4.96 4.96 0 0 1 20 21h-3Z" />
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      {icons[type]}
    </svg>
  );
}

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

function getCurrentAccountingPeriod(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
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

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M10.5 4a6.5 6.5 0 0 1 5.15 10.47l4.44 4.44a1 1 0 0 1-1.42 1.42l-4.44-4.44A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.42Z" />
    </svg>
  );
}

export function EmployeesAdmin() {
  const { interfaceMode } = useAuth();
  const canManageEmployees = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const canConfigureSalaries = interfaceMode === ROLES.DIRECTIVO;
  const currentAccountingPeriod = useMemo(() => getCurrentAccountingPeriod(), []);
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
  const [employeeAccessState, setEmployeeAccessState] = useState<EmployeeAccessState | null>(null);
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
  const activeSearchCount = activeFilterCount + Number(searchQuery.trim().length > 0);

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

  const openEmployeeAccessModal = (employee: EntityWithId<EmployeeDocument>) => {
    setEmployeeAccessState({
      employee,
      email: '',
      inviteLink: '',
      isSubmitting: false,
    });
    setOpenEmployeeActionsId(null);
    setNotice('');
    setError('');
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setSelectedEmployeeId(null);
    setEditorState(createEmptyEditorState());
  };

  const closeEmployeeAccessModal = () => {
    setEmployeeAccessState(null);
  };

  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      closeEditor();
      closeEmployeeAccessModal();
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

  const handleLinkEmployeeAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!employeeAccessState) {
      return;
    }

    const email = employeeAccessState.email.trim().toLowerCase();
    if (!email) {
      setError('Ingresa un email para vincular el acceso del empleado.');
      return;
    }

    setEmployeeAccessState((current) => (current ? { ...current, isSubmitting: true, inviteLink: '' } : current));
    setError('');

    try {
      const result = await usersCallables.linkEmployeeAuthUser({
        employeeId: employeeAccessState.employee.id,
        email,
        displayName: `${employeeAccessState.employee.firstName} ${employeeAccessState.employee.lastName}`.trim(),
      });
      setEmployeeAccessState((current) => (current ? {
        ...current,
        inviteLink: result.inviteLink,
        email: result.email,
        isSubmitting: false,
      } : current));
      setNotice('Acceso vinculado. El link permite que el empleado cree o restablezca su contraseña.');
      await loadEmployees();
    } catch (accessError) {
      setEmployeeAccessState((current) => (current ? { ...current, isSubmitting: false } : current));
      setError(accessError instanceof Error ? accessError.message : 'No pudimos vincular el acceso del empleado.');
    }
  };

  const handleInviteEmployeeAccess = async () => {
    if (!employeeAccessState) {
      return;
    }

    setEmployeeAccessState((current) => (current ? { ...current, isSubmitting: true, inviteLink: '' } : current));
    setError('');

    try {
      const result = await usersCallables.inviteEmployeeUser({ employeeId: employeeAccessState.employee.id });
      setEmployeeAccessState((current) => (current ? {
        ...current,
        inviteLink: result.inviteLink,
        email: result.email,
        isSubmitting: false,
      } : current));
      setNotice('Invitacion generada para el empleado.');
    } catch (accessError) {
      setEmployeeAccessState((current) => (current ? { ...current, isSubmitting: false } : current));
      setError(accessError instanceof Error ? accessError.message : 'No pudimos generar la invitacion.');
    }
  };

  const isEmployeeEditorSubmitDisabled = isSaving || Boolean(validateEditor());

  return (
    <div className="page-container member-directory-page directory-workbench-page">
      <div className="directory-shell directory-workbench-shell">
        <section className="floating-card tournament-hero directory-workbench-hero">
          <div className="tournament-hero__copy">
            <p className="eyebrow">Administracion de personal</p>
            <h1>Legajos de empleados</h1>
            <p>
              Alta, baja, acceso al sistema y trazabilidad contable laboral
              desde una vista operativa unificada.
            </p>
          </div>

          {canManageEmployees && (
            <div className="tournament-hero__actions">
              <button
                type="button"
                className="ui-action-button ui-action-button--positive"
                onClick={openCreateModal}
              >
                <Icon type="plus" />
                <span>Nuevo empleado</span>
              </button>
            </div>
          )}
        </section>

        <section
          className="tournament-summary-grid directory-summary-grid"
          aria-label="Resumen de empleados"
        >
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
        </section>

        <section className="floating-card tournament-main-panel directory-workbench-panel">
          <div className="tournament-section-header directory-panel-header">
            <div>
              <p className="eyebrow">Listado operativo</p>
              <h2>Empleados, permisos y contabilidad mensual</h2>
              <p className="profile-note">
                Filtra legajos, entra a la contabilidad de cada empleado y
                gestiona acciones administrativas.
              </p>
            </div>
          </div>

          <div
            className={`search-collapse ${isFiltersOpen ? "search-collapse--open" : ""}`}
            ref={filtersRef}
          >
            <button
              type="button"
              className="search-collapse__trigger"
              aria-expanded={isFiltersOpen}
              onClick={() => setIsFiltersOpen((current) => !current)}
            >
              <span className="search-collapse__title">
                <span className="search-collapse__icon">
                  <SearchIcon />
                </span>
                <span>
                  <strong>Busqueda y filtros</strong>
                  <small>
                    {activeSearchCount > 0
                      ? `${activeSearchCount} criterio${activeSearchCount === 1 ? "" : "s"} activo${activeSearchCount === 1 ? "" : "s"}`
                      : "Buscar por legajo, nombre, estado, contrato o rendiciones"}
                  </small>
                </span>
              </span>
              <span className="search-collapse__meta">
                {activeSearchCount > 0 && (
                  <span className="status-chip">{activeSearchCount}</span>
                )}
                <span className="search-collapse__chevron">
                  <ChevronIcon />
                </span>
              </span>
            </button>

            {isFiltersOpen && (
              <div className="search-collapse__body">
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
                          setStatusFilter(
                            event.target.value as EmployeeStatusFilter,
                          )
                        }
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="form-field member-filter">
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
                    </label>

                    <label className="form-field member-filter">
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
                    </label>
                  </div>
                </div>
              </div>
            )}
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
                          <small>
                            {employee.linkedUserId
                              ? "Con acceso al sistema"
                              : "Sin usuario vinculado"}
                          </small>
                        </div>

                        <div className="member-cell">
                          <span
                            className={`status-pill ${employee.status === "active" ? "status-pill-green" : "status-pill--bloqueado"}`}
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
                                <Link
                                  className="member-actions-menu__item"
                                  to={`/accounting/employees/${employee.id}?period=${currentAccountingPeriod}`}
                                  onClick={() => setOpenEmployeeActionsId(null)}
                                >
                                  Ver contabilidad
                                </Link>
                                <Link
                                  className="member-actions-menu__item"
                                  to={`/accounting/employees/${employee.id}?period=${currentAccountingPeriod}&section=references`}
                                  onClick={() => setOpenEmployeeActionsId(null)}
                                >
                                  Cargar comprobante / rendición
                                </Link>
                                {canConfigureSalaries && (
                                  <Link
                                    className="member-actions-menu__item"
                                    to={`/accounting/employees/${employee.id}?period=${currentAccountingPeriod}&section=salary`}
                                    onClick={() =>
                                      setOpenEmployeeActionsId(null)
                                    }
                                  >
                                    Configurar sueldo
                                  </Link>
                                )}
                                <button
                                  type="button"
                                  className="member-actions-menu__item"
                                  onClick={() =>
                                    openEmployeeAccessModal(employee)
                                  }
                                >
                                  {employee.linkedUserId
                                    ? "Enviar invitación"
                                    : "Vincular acceso al sistema"}
                                </button>
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
      </div>

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
                    className={`status-pill ${editorState.status === "active" ? "status-pill-green" : "status-pill--bloqueado"}`}
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
                className="form-field member-editor-form__wide member-editor-form__notes"
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

              <div className="form-actions form-actions--split member-editor-actions">
                <UiActionButton
                  type="button"
                  variant="secondary"
                  onClick={closeEditor}
                >
                  Cerrar
                </UiActionButton>
                <UiActionButton
                  type="submit"
                  variant="positive"
                  disabled={isEmployeeEditorSubmitDisabled}
                >
                  {isSaving
                    ? "Guardando..."
                    : selectedEmployee
                      ? "Guardar cambios"
                      : "Dar de alta empleado"}
                </UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}

      {employeeAccessState && (
        <div className="modal-overlay" onClick={handleOverlayClick}>
          <section
            className="floating-card member-modal-card"
            role="dialog"
            aria-modal="true"
          >
            <div className="member-modal__header">
              <div className="member-modal__title">
                <p className="eyebrow">Acceso del empleado</p>
                <h2>{getEmployeeDisplayName(employeeAccessState.employee)}</h2>
                <p className="profile-note">
                  El ingreso se gestiona con Firebase Authentication. No se
                  guarda ninguna contraseña en Firestore.
                </p>
              </div>

              <button
                type="button"
                className="icon-button"
                aria-label="Cerrar acceso del empleado"
                onClick={closeEmployeeAccessModal}
              >
                <CloseIcon />
              </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="summary-grid">
              <SummaryCard
                label="Estado"
                value={
                  employeeAccessState.employee.linkedUserId
                    ? "Vinculado"
                    : "Sin usuario"
                }
                helper={
                  employeeAccessState.employee.linkedUserId
                    ? employeeAccessState.employee.linkedUserId
                    : "Pendiente de crear o vincular"
                }
              />
              <SummaryCard
                label="Rol"
                value="empleado"
                helper="Solo puede cargar y ver sus propias rendiciones"
              />
            </div>

            {employeeAccessState.employee.linkedUserId ? (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeEmployeeAccessModal}
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={employeeAccessState.isSubmitting}
                  onClick={() => void handleInviteEmployeeAccess()}
                >
                  {employeeAccessState.isSubmitting
                    ? "Generando..."
                    : "Generar invitación / reset"}
                </button>
              </div>
            ) : (
              <form
                className="member-editor-form"
                onSubmit={handleLinkEmployeeAccess}
              >
                <label className="form-field member-editor-form__wide">
                  <span>Email de acceso</span>
                  <input
                    type="email"
                    value={employeeAccessState.email}
                    onChange={(event) =>
                      setEmployeeAccessState((current) =>
                        current
                          ? { ...current, email: event.target.value }
                          : current,
                      )
                    }
                    placeholder="empleado@club.com"
                  />
                </label>

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeEmployeeAccessModal}
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={employeeAccessState.isSubmitting}
                  >
                    {employeeAccessState.isSubmitting
                      ? "Vinculando..."
                      : "Crear / vincular usuario"}
                  </button>
                </div>
              </form>
            )}

            {employeeAccessState.inviteLink && (
              <div className="success-message">
                <strong>Link seguro generado</strong>
                <p>
                  Compartilo por un canal confiable para que el empleado defina
                  su contraseña.
                </p>
                <input readOnly value={employeeAccessState.inviteLink} />
              </div>
            )}
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
