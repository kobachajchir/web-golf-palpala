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
import { ModalCloseIcon } from '../components/ModalCloseIcon';
import { SearchFiltersPanel } from '../components/SearchFiltersPanel';
import { UiActionButton } from '../components/UiActionButton';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import type {
  CreateEmployeePayload,
  EmployeeContractType,
  EmployeeDocument,
  EmployeeStatus,
  EntityWithId,
  MemberDocument,
  UpdateEmployeePayload,
} from '../modules/users/domain/models';
import { createUsersCallables } from '../modules/users/functions/users.callables';
import { createMembersRepository as createMembersDirectoryRepository } from '../modules/users/infrastructure/firestore/repositories';
import { createEmployeesRepository } from '../modules/users/repositories/employees.repository';
import type {
  EmployeeContractFilter,
  EmployeeListCursor,
  EmployeeStatusFilter,
} from '../modules/users/types/employee.types';

type EmployeeEditorState = {
  id?: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  dni: string;
  linkedMemberId: string;
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
};

type EmployeeAccessState = {
  employee: EntityWithId<EmployeeDocument>;
  email: string;
  employeeCode: string;
  loginPath: string;
  temporaryPassword: string;
  passwordGeneratedAt: string;
  administrativeAccess: boolean;
  isSubmitting: boolean;
};

type TimestampLike = { toDate: () => Date } | Date | string | number | null | undefined;

const CONTRACT_OPTIONS: Array<{ value: EmployeeContractType; label: string }> = [
  { value: 'monthly', label: 'Mensual' },
];
const ADMINISTRATIVE_EMPLOYEE_CODE = 'E001';
const EMPLOYEE_ACCESS_TIMEOUT_MS = 30000;

const STATUS_OPTIONS: Array<{ value: EmployeeStatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
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
    linkedMemberId: '',
    position: '',
    contractType: 'monthly',
    status: 'active',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    canSubmitExpenses: false,
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
  return CONTRACT_OPTIONS.find((option) => option.value === value)?.label ?? 'Mensual';
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

function canEmployeeUseApp(employee: EntityWithId<EmployeeDocument>): boolean {
  return Boolean(employee.linkedUserId);
}

function isAdministrativeEmployee(employee: EntityWithId<EmployeeDocument>): boolean {
  return employee.employeeCode === ADMINISTRATIVE_EMPLOYEE_CODE;
}

function withEmployeeAccessTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('La generacion del acceso tardo demasiado. Revisa si el empleado ya quedo activo y volve a intentar.'));
    }, EMPLOYEE_ACCESS_TIMEOUT_MS);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

function createEditorState(employee: EntityWithId<EmployeeDocument>): EmployeeEditorState {
  return {
    id: employee.id,
    employeeCode: employee.employeeCode ?? '',
    firstName: employee.firstName,
    lastName: employee.lastName,
    dni: employee.dni ?? '',
    linkedMemberId: employee.linkedMemberId ?? '',
    position: employee.position,
    contractType: 'monthly',
    status: employee.status,
    startDate: formatDateInput(employee.startDate as TimestampLike),
    endDate: '',
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
  const canConfigureSalaries = canManageEmployees;
  const currentAccountingPeriod = useMemo(() => getCurrentAccountingPeriod(), []);
  const usersCallables = useMemo(() => createUsersCallables(), []);
  const employeesRepository = useMemo(() => createEmployeesRepository(), []);
  const membersRepository = useMemo(() => createMembersDirectoryRepository(), []);
  const [employees, setEmployees] = useState<Array<EntityWithId<EmployeeDocument>>>([]);
  const [members, setMembers] = useState<Array<EntityWithId<MemberDocument>>>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [statusFilter, setStatusFilter] = useState<EmployeeStatusFilter>('all');
  const [contractFilter, setContractFilter] = useState<EmployeeContractFilter>('all');
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
  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const loadStats = useCallback(async () => {
    const totalEmployees = await employeesRepository.countAll();

    setStats({
      totalEmployees,
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
    [contractFilter, deferredSearchQuery, employeesRepository, loadStats, statusFilter],
  );

  const loadMembers = useCallback(async () => {
    try {
      setMembers(await membersRepository.listDirectory());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar socios para vincular empleados.');
    }
  }, [membersRepository]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

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

  const activeFilterCount = Number(contractFilter !== 'all');
  const activeSearchCount = activeFilterCount + Number(searchQuery.trim().length > 0);
  const getLinkedMemberSummary = useCallback(
    (employee: EntityWithId<EmployeeDocument>) => {
      if (!employee.linkedMemberId) {
        return '';
      }

      const linkedMember = membersById.get(employee.linkedMemberId);
      return linkedMember
        ? `Socio #${linkedMember.memberNumber} - ${linkedMember.lastName}, ${linkedMember.firstName}`
        : `Socio vinculado: ${employee.linkedMemberId}`;
    },
    [membersById],
  );

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
      employeeCode: employee.employeeCode ?? '',
      loginPath: '',
      temporaryPassword: '',
      passwordGeneratedAt: '',
      administrativeAccess: isAdministrativeEmployee(employee),
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
          contractType: 'monthly',
          endDate: null,
          canSubmitExpenses: false,
          dni: editorState.dni.trim() || null,
          linkedMemberId: editorState.linkedMemberId || null,
          notes: editorState.notes.trim() || null,
        };
        await usersCallables.updateEmployee(payload);
        setNotice('Empleado actualizado.');
      } else {
        const payload: CreateEmployeePayload = {
          firstName: editorState.firstName.trim(),
          lastName: editorState.lastName.trim(),
          position: editorState.position.trim(),
          contractType: 'monthly',
          startDate: toIsoDate(editorState.startDate),
          canSubmitExpenses: false,
          ...(editorState.linkedMemberId ? { linkedMemberId: editorState.linkedMemberId } : {}),
          ...(editorState.dni.trim() ? { dni: editorState.dni.trim() } : {}),
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

    setEmployeeAccessState((current) => (current ? {
      ...current,
      isSubmitting: true,
      loginPath: '',
      temporaryPassword: '',
      passwordGeneratedAt: '',
    } : current));
    setError('');

    try {
      const result = await withEmployeeAccessTimeout(usersCallables.linkEmployeeAuthUser({
        employeeId: employeeAccessState.employee.id,
        displayName: `${employeeAccessState.employee.firstName} ${employeeAccessState.employee.lastName}`.trim(),
        administrativeAccess: isAdministrativeEmployee(employeeAccessState.employee),
      }));
      setEmployeeAccessState((current) => (current ? {
        ...current,
        employeeCode: result.employeeCode ?? current.employee.employeeCode ?? '',
        loginPath: result.loginPath ?? '/login',
        temporaryPassword: result.temporaryPassword ?? '',
        passwordGeneratedAt: result.passwordGeneratedAt ?? '',
        email: result.email,
        isSubmitting: false,
      } : current));
      setNotice('Acceso vinculado. El empleado debe ingresar con la clave temporal y cambiarla en el primer inicio.');
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

    setEmployeeAccessState((current) => (current ? {
      ...current,
      isSubmitting: true,
      loginPath: '',
      temporaryPassword: '',
      passwordGeneratedAt: '',
    } : current));
    setError('');

    try {
      const result = await withEmployeeAccessTimeout(
        usersCallables.inviteEmployeeUser({ employeeId: employeeAccessState.employee.id }),
      );
      setEmployeeAccessState((current) => (current ? {
        ...current,
        employeeCode: result.employeeCode ?? current.employee.employeeCode ?? '',
        loginPath: result.loginPath ?? '/login',
        temporaryPassword: result.temporaryPassword ?? '',
        passwordGeneratedAt: result.passwordGeneratedAt ?? '',
        email: result.email,
        isSubmitting: false,
      } : current));
      setNotice('Clave temporal restablecida para el empleado.');
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
            <h1>Legajos de empleados</h1>
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
            label="Mensuales"
            value={String(
              employees.filter((employee) => employee.contractType === "monthly")
                .length,
            )}
            helper="Contratacion mensual"
          />
        </section>

        <section className="floating-card tournament-main-panel directory-workbench-panel">
          <div className="tournament-section-header directory-panel-header">
            <div>
              <p className="eyebrow">Listado operativo</p>
              <h2>Empleados, permisos y contabilidad mensual</h2>
            </div>
          </div>

          <SearchFiltersPanel
            open={isFiltersOpen}
            onToggle={() => setIsFiltersOpen((current) => !current)}
            panelRef={filtersRef}
            title="Busqueda y filtros"
            helper="Buscar por legajo o nombre"
            activeCount={activeSearchCount}
            icon={<SearchIcon />}
            chevron={<ChevronIcon />}
            fields={[
              {
                label: 'Busqueda rapida',
                value: searchQuery,
                onChange: setSearchQuery,
                type: 'search',
              },
              {
                label: 'Contrato',
                value: contractFilter,
                onChange: (value) => setContractFilter(value as EmployeeContractFilter),
                type: 'select',
                options: [
                  { value: 'all', label: 'Todos' },
                  ...CONTRACT_OPTIONS,
                ],
              },
            ]}
          />

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
                  <span>Contrato</span>
                  <span>Acceso app</span>
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
                          {employee.linkedMemberId && (
                            <small>{getLinkedMemberSummary(employee)}</small>
                          )}
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
                            Mensual
                          </span>
                          <small>Modalidad de contratacion unica</small>
                        </div>

                        <div className="member-cell">
                          <span className={`employee-access-pill ${canEmployeeUseApp(employee) ? 'employee-access-pill--active' : 'employee-access-pill--inactive'}`}>
                            {canEmployeeUseApp(employee) ? 'Activo' : 'Sin acceso'}
                          </span>
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
                                <button
                                  type="button"
                                  className="member-actions-menu__item"
                                  onClick={() => openEmployeeAccessModal(employee)}
                                >
                                  {canEmployeeUseApp(employee) ? 'Restablecer clave temporal' : 'Conceder acceso'}
                                </button>
                                {canConfigureSalaries && (
                                  <Link
                                    className="member-actions-menu__item"
                                    to={`/accounting/employees/${employee.id}?period=${currentAccountingPeriod}&section=salary`}
                                    onClick={() =>
                                      setOpenEmployeeActionsId(null)
                                    }
                                  >
                                    Modificar sueldo
                                  </Link>
                                )}
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
        <div className="modal-overlay quick-actions-modal-overlay" onClick={handleOverlayClick}>
          <section
            className="floating-card member-modal-card quick-actions-modal accounting-operation-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header quick-actions-modal__header">
              <div className="member-modal__title accounting-operation-modal__title-block">
                <p className="eyebrow">
                  {selectedEmployee
                    ? "Modificacion de empleado"
                    : "Alta de empleado"}
                </p>
                {selectedEmployee ? (
                  <h2 className="accounting-operation-modal__title">Actualizar legajo</h2>
                ) : (
                  <h2 className="accounting-operation-modal__title">Nuevo legajo</h2>
                )}
              </div>

              <div className="member-modal__header-actions">
                {false && selectedEmployee && (
                  <span
                    className={`status-pill ${editorState.status === "active" ? "status-pill-green" : "status-pill--bloqueado"}`}
                  >
                    {editorState.status === "active" ? "Activo" : "Inactivo"}
                  </span>
                )}

                <button
                  type="button"
                  className="modal-close-button"
                  aria-label="Cerrar formulario"
                  onClick={closeEditor}
                >
                  <ModalCloseIcon />
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
                    <span>Legajo automatico</span>
                    <input
                      id="employeeCode"
                      name="employeeCode"
                      type="text"
                      value={editorState.employeeCode}
                      placeholder="Se genera como E + ID al guardar"
                      readOnly
                    />
                    <small>{selectedEmployee ? 'Generado automaticamente desde el ID del empleado.' : 'Se genera automaticamente al guardar el empleado.'}</small>
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

                  <label className="form-field employee-form-section__wide" htmlFor="linkedMemberId">
                    <span>Socio vinculado (opcional)</span>
                    <select
                      id="linkedMemberId"
                      name="linkedMemberId"
                      value={editorState.linkedMemberId}
                      onChange={handleEditorChange}
                    >
                      <option value="">No es socio / sin vinculo</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {`#${member.memberNumber} - ${member.lastName}, ${member.firstName}`}
                        </option>
                      ))}
                    </select>
                    <small>El empleado puede existir sin socio. Si tambien esta en el padron, queda vinculado a ese registro.</small>
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

                  <div className="form-field">
                    <span>Modalidad de contratacion</span>
                    <strong>Mensual</strong>
                    <small>Unica modalidad habilitada para empleados.</small>
                  </div>

                  <label className="form-field" htmlFor="startDate">
                    <span>Fecha de ingreso</span>
                    <input
                      id="startDate"
                      name="startDate"
                      type="date"
                      value={editorState.startDate}
                      disabled={Boolean(selectedEmployee)}
                      onChange={handleEditorChange}
                    />
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
        <div className="modal-overlay" onClick={closeEmployeeAccessModal}>
          <section
            className="floating-card member-modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="member-modal__header">
              <div className="member-modal__title">
                <p className="eyebrow">Acceso del empleado</p>
                <h2>{canEmployeeUseApp(employeeAccessState.employee) ? 'Restablecer clave temporal' : 'Conceder acceso'}</h2>
                <p className="profile-note">
                  {canEmployeeUseApp(employeeAccessState.employee)
                    ? 'Se va a asignar una clave temporal. En el primer ingreso la app va a obligar al empleado a cambiarla.'
                    : 'Se va a conceder acceso a la app con una clave temporal. En el primer ingreso la app va a obligar al empleado a cambiarla.'}
                </p>
              </div>

              <button
                type="button"
                className="modal-close-button"
                aria-label="Cerrar acceso del empleado"
                onClick={closeEmployeeAccessModal}
              >
                <ModalCloseIcon />
              </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="membership-note member-editor-form__wide employee-access-explanation">
              <span>{canEmployeeUseApp(employeeAccessState.employee) ? 'Acceso ya creado' : 'Nuevo acceso a la app'}</span>
              <p>
                El empleado va a ingresar con el codigo {employeeAccessState.employee.employeeCode ?? 'Exxx'}.
                {employeeAccessState.administrativeAccess
                  ? ' Este legajo conserva roles Empleado + Administrativo.'
                  : ' Este acceso queda con rol Empleado.'}
              </p>
            </div>

            <div className="membership-panel__list employee-access-detail-list">
              <div>
                <span>Codigo de empleado</span>
                <strong>{employeeAccessState.employee.employeeCode ?? 'Exxx'}</strong>
              </div>
              <div>
                <span>DNI</span>
                <strong>{employeeAccessState.employee.dni || 'DNI pendiente'}</strong>
              </div>
              <div>
                <span>Apellido</span>
                <strong>{employeeAccessState.employee.lastName}</strong>
              </div>
              <div>
                <span>Nombres</span>
                <strong>{employeeAccessState.employee.firstName}</strong>
              </div>
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
                    : "Restablecer clave temporal"}
                </button>
              </div>
            ) : (
              <form
                className="member-editor-form"
                onSubmit={handleLinkEmployeeAccess}
              >
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
                      ? "Creando..."
                      : "Conceder acceso"}
                  </button>
                </div>
              </form>
            )}

            {employeeAccessState.temporaryPassword && (
              <div className="success-message">
                <strong>Credenciales temporales generadas</strong>
                <p>
                  Compartilo por un canal confiable para que el empleado defina
                  su contraseña.
                </p>
                <div className="credentials-dialog-card__details employee-access-credentials">
                  <div>
                    <span>Usuario o legajo</span>
                    <strong>{employeeAccessState.employeeCode || employeeAccessState.employee.employeeCode || 'Exxx'}</strong>
                  </div>
                  <div>
                    <span>Contrasena temporal</span>
                    <strong>{employeeAccessState.temporaryPassword || 'Clave temporal no disponible'}</strong>
                  </div>
                </div>
                <div className="form-actions form-actions--right">
                  <button
                    type="button"
                    className="ui-action-button"
                    onClick={() => window.location.assign(employeeAccessState.loginPath || '/login')}
                  >
                    Ir al login
                  </button>
                </div>
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
