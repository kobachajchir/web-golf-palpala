import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TemporaryCredentialsDialog } from '../components/TemporaryCredentialsDialog';
import { ROLES } from '../constants/roles';
import { useAuth } from '../hooks/useAuth';
import { firestore } from '../lib/firebase';
import { createUsersCallables } from '../modules/users/functions/users.callables';
import {
  listClubMembers,
  matchesClubMemberSearch,
  resetClubMemberDirectory,
  saveClubMember,
  setClubMemberActive,
  isClubMemberNumberInUse,
  getMemberDirectorySource,
  type ClubMemberDraft,
  type ClubMemberRecord,
  type ClubMemberStatus,
  type ClubMemberTypeId,
} from '../modules/users/services/memberDirectory';
import type { MemberListCursor, LinkedUserFilter } from '../modules/users/types/member.types';
import type { TemporaryMemberCredentials } from '../modules/users/types/user.types';

type MemberTypeFilter = 'all' | ClubMemberTypeId;
type ActivityFilter = 'all' | ClubMemberStatus;
type MemberEditorState = ClubMemberDraft;
type DirectoryStats = {
  totalMembers: number;
  activeMembers: number;
  households: number;
  withAagMembership: number;
};

const MEMBER_TYPE_OPTIONS: Array<{ value: ClubMemberTypeId; label: string }> = [
  { value: 'pleno', label: 'Socio pleno' },
  { value: 'vitalicio', label: 'Vitalicio' },
  { value: 'menor', label: 'Socio menor' },
  { value: 'licencia', label: 'Licencia' },
  { value: 'grupo_familiar_asociado', label: 'Grupo familiar asociado' },
  { value: 'grupo_familiar_titular', label: 'Grupo familiar titular' },
];
const EDITABLE_MEMBER_TYPE_OPTIONS = MEMBER_TYPE_OPTIONS.filter(
  (option) => option.value !== 'grupo_familiar_titular' && option.value !== 'licencia',
);

const ACTIVITY_FILTER_OPTIONS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
  { value: 'license', label: 'Licencia' },
];

function createEmptyEditorState(): MemberEditorState {
  return {
    memberNumber: '',
    fullName: '',
    dni: '',
    aagMembershipNumber: '',
    memberTypeId: 'pleno',
    familyHolderMemberId: undefined,
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
    memberTypeId: member.memberTypeId,
    familyHolderMemberId: member.familyHolderMemberId,
    notes: member.notes ?? '',
    active: member.active,
  };
}

function isEligibleFamilyHolder(member: ClubMemberRecord) {
  return member.memberTypeId === 'pleno' || member.memberTypeId === 'grupo_familiar_titular';
}

function getAutomaticFeeDeductionLabel(memberTypeId: ClubMemberTypeId) {
  if (memberTypeId === 'menor') {
    return '30% SOCIO PLENO';
  }

  if (memberTypeId !== 'pleno') {
    return '50% SOCIO PLENO';
  }

  return '';
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

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="button-icon">
      <path d="M12 5c4.97 0 9.16 3.07 10.75 7.41a1.1 1.1 0 0 1 0 .76C21.16 17.5 16.97 20.57 12 20.57S2.84 17.5 1.25 13.17a1.1 1.1 0 0 1 0-.76C2.84 8.07 7.03 5 12 5Zm0 2c-3.95 0-7.32 2.37-8.72 5.79 1.4 3.42 4.77 5.78 8.72 5.78s7.32-2.36 8.72-5.78C19.32 9.37 15.95 7 12 7Zm0 1.75A4.05 4.05 0 1 1 7.95 12.8 4.05 4.05 0 0 1 12 8.75Zm0 2A2.05 2.05 0 1 0 14.05 12.8 2.05 2.05 0 0 0 12 10.75Z" />
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

export function MembersAdmin() {
  const { interfaceMode } = useAuth();
  const canEditMembers = interfaceMode === ROLES.ADMINISTRATIVO || interfaceMode === ROLES.DIRECTIVO;
  const [members, setMembers] = useState<ClubMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [directorySource] = useState(getMemberDirectorySource);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberTypeFilter, setMemberTypeFilter] = useState<MemberTypeFilter>('all');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [linkedUserFilter] = useState<LinkedUserFilter>('all');
  const [nextCursor, setNextCursor] = useState<MemberListCursor>(null);
  const [hasMoreMembers, setHasMoreMembers] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [editorState, setEditorState] = useState<MemberEditorState>(createEmptyEditorState());
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [openMemberActionsId, setOpenMemberActionsId] = useState<string | null>(null);
  const [familyHolderQuery, setFamilyHolderQuery] = useState('');
  const [hasAagMembership, setHasAagMembership] = useState(false);
  const [isSuggestingMemberNumber, setIsSuggestingMemberNumber] = useState(false);
  const [memberNumberSuggestion, setMemberNumberSuggestion] = useState('');
  const [memberNumberError, setMemberNumberError] = useState('');
  const [directoryStats, setDirectoryStats] = useState<DirectoryStats | null>(null);
  const [credentialsDialog, setCredentialsDialog] = useState<{
    title: string;
    credentials: TemporaryMemberCredentials;
  } | null>(null);
  const [memberPendingDelete, setMemberPendingDelete] = useState<ClubMemberRecord | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const memberActionsRef = useRef<HTMLDivElement | null>(null);
  const memberNumberSuggestionRequestRef = useRef(0);
  const usersCallables = useMemo(() => createUsersCallables(), []);

  const loadDirectoryStats = async () => {
    if (directorySource.mode !== 'firestore') {
      return;
    }

    if (!firestore) {
      throw new Error('Firestore no esta inicializado.');
    }

    const membersRef = collection(firestore, 'members');
    const familyGroupsRef = collection(firestore, 'family_groups');
    const [totalMembers, activeMembers, households, withAagMembership] = await Promise.all([
      getCountFromServer(membersRef),
      getCountFromServer(query(membersRef, where('status', '==', 'active'))),
      getCountFromServer(query(familyGroupsRef, where('active', '==', true))),
      getCountFromServer(query(membersRef, where('aagMembershipNumber', '>', ''))),
    ]);

    setDirectoryStats({
      totalMembers: totalMembers.data().count,
      activeMembers: activeMembers.data().count,
      households: households.data().count,
      withAagMembership: withAagMembership.data().count,
    });
  };

  const loadMembersPage = async (options?: { append?: boolean }) => {
    const append = options?.append ?? false;
    const page = await listClubMembers({
      search: deferredSearchQuery,
      status: activityFilter,
      typeId: memberTypeFilter,
      linkedUser: linkedUserFilter,
      pageSize: 25,
      cursor: append ? nextCursor : null,
    });

    setMembers((current) => (append ? [...current, ...page.members] : page.members));
    setNextCursor(page.nextCursor);
    setHasMoreMembers(page.hasMore);
    if (!append) {
      await loadDirectoryStats().catch(() => undefined);
    }
  };

  useEffect(() => {
    let mounted = true;

    setLoading(true);

    void listClubMembers({
      search: deferredSearchQuery,
      status: activityFilter,
      typeId: memberTypeFilter,
      linkedUser: linkedUserFilter,
      pageSize: 25,
      cursor: null,
    })
      .then((page) => {
        if (!mounted) {
          return;
        }

        setMembers(page.members);
        setNextCursor(page.nextCursor);
        setHasMoreMembers(page.hasMore);
        setLoading(false);
        void loadDirectoryStats().catch(() => undefined);
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
  }, [activityFilter, deferredSearchQuery, linkedUserFilter, memberTypeFilter]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (filtersRef.current && !filtersRef.current.contains(target)) {
        setIsFiltersOpen(false);
      }

      if (memberActionsRef.current && !memberActionsRef.current.contains(target)) {
        setOpenMemberActionsId(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setIsFiltersOpen(false);
      setOpenMemberActionsId(null);
      if (!isSaving) {
        setIsEditorOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isSaving]);

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      const matchesSearch = matchesClubMemberSearch(member, deferredSearchQuery);
      const matchesType = memberTypeFilter === 'all' ? true : member.memberTypeId === memberTypeFilter;
      const matchesActivity = activityFilter === 'all' ? true : member.status === activityFilter;

      return matchesSearch && matchesType && matchesActivity;
    });
  }, [activityFilter, deferredSearchQuery, memberTypeFilter, members]);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  );
  const selectedFamilyHolder = useMemo(
    () => members.find((member) => member.id === editorState.familyHolderMemberId) ?? null,
    [editorState.familyHolderMemberId, members],
  );
  const familyHolderResults = useMemo(() => {
    const normalizedQuery = familyHolderQuery.trim();
    if (editorState.memberTypeId !== 'grupo_familiar_asociado' || normalizedQuery.length < 2) {
      return [];
    }

    return members
      .filter(
        (member) =>
          member.id !== editorState.id &&
          isEligibleFamilyHolder(member) &&
          matchesClubMemberSearch(member, normalizedQuery),
      )
      .slice(0, 6);
  }, [editorState.id, editorState.memberTypeId, familyHolderQuery, members]);
  const feeDeductionPreview = useMemo(() => {
    if (
      selectedMember &&
      selectedMember.id === editorState.id &&
      selectedMember.memberTypeId === editorState.memberTypeId
    ) {
      if (editorState.memberTypeId === 'menor') {
        return '30% SOCIO PLENO';
      }

      return selectedMember.feeDeductionLabel ?? getAutomaticFeeDeductionLabel(editorState.memberTypeId);
    }

    return getAutomaticFeeDeductionLabel(editorState.memberTypeId);
  }, [editorState.id, editorState.memberTypeId, selectedMember]);

  const summary = useMemo(() => {
    const households = new Set(members.filter((member) => member.householdSize > 1).map((member) => member.familyGroupCode));

    return {
      totalMembers: directoryStats?.totalMembers ?? members.length,
      activeMembers: directoryStats?.activeMembers ?? members.filter((member) => member.active).length,
      households: directoryStats?.households ?? households.size,
      withAagMembership: directoryStats?.withAagMembership ?? members.filter((member) => Boolean(member.aagMembershipNumber)).length,
    };
  }, [directoryStats, members]);

  const assignAutomaticMemberNumber = async () => {
    const requestId = memberNumberSuggestionRequestRef.current + 1;
    memberNumberSuggestionRequestRef.current = requestId;
    setMemberNumberError('');
    setIsSuggestingMemberNumber(true);

    try {
      const result = await usersCallables.getNextMemberNumber();
      if (memberNumberSuggestionRequestRef.current !== requestId) {
        return;
      }

      setMemberNumberSuggestion(result.nextMemberNumber);
      setEditorState((current) => ({
        ...current,
        memberNumber: result.nextMemberNumber,
      }));
    } catch (suggestionError) {
      if (memberNumberSuggestionRequestRef.current !== requestId) {
        return;
      }

      setMemberNumberError(
        suggestionError instanceof Error
          ? `No pudimos asignar automaticamente el ID: ${suggestionError.message}`
          : 'No pudimos asignar automaticamente el ID.',
      );
    } finally {
      if (memberNumberSuggestionRequestRef.current === requestId) {
        setIsSuggestingMemberNumber(false);
      }
    }
  };

  const openCreateModal = () => {
    const requestId = memberNumberSuggestionRequestRef.current + 1;
    memberNumberSuggestionRequestRef.current = requestId;

    startTransition(() => {
      setSelectedMemberId(null);
      setEditorState(createEmptyEditorState());
      setFamilyHolderQuery('');
      setHasAagMembership(false);
      setError('');
      setMemberNumberError('');
      setMemberNumberSuggestion('');
      setIsSuggestingMemberNumber(true);
      setIsEditorOpen(true);
    });

    void usersCallables
      .getNextMemberNumber()
      .then((result) => {
        if (memberNumberSuggestionRequestRef.current !== requestId) {
          return;
        }

        setMemberNumberSuggestion(result.nextMemberNumber);
        setEditorState((current) => {
          if (current.id || current.memberNumber.trim()) {
            return current;
          }

          return {
            ...current,
            memberNumber: result.nextMemberNumber,
          };
        });
      })
      .catch((suggestionError) => {
        if (memberNumberSuggestionRequestRef.current !== requestId) {
          return;
        }

        setError(
          suggestionError instanceof Error
            ? `No pudimos sugerir el proximo numero de socio: ${suggestionError.message}`
            : 'No pudimos sugerir el proximo numero de socio.',
        );
        setMemberNumberError('No pudimos sugerir el proximo ID. Podes escribir uno manualmente.');
      })
      .finally(() => {
        if (memberNumberSuggestionRequestRef.current === requestId) {
          setIsSuggestingMemberNumber(false);
        }
      });
  };

  const openEditModal = (member: ClubMemberRecord) => {
    memberNumberSuggestionRequestRef.current += 1;

    startTransition(() => {
      setSelectedMemberId(member.id);
      setEditorState(createEditorState(member));
      setFamilyHolderQuery('');
      setHasAagMembership(Boolean(member.aagMembershipNumber));
      setError('');
      setMemberNumberError('');
      setMemberNumberSuggestion('');
      setIsSuggestingMemberNumber(false);
      setIsEditorOpen(true);
    });
  };

  const closeEditor = () => {
    if (isSaving) {
      return;
    }

    memberNumberSuggestionRequestRef.current += 1;
    setIsSuggestingMemberNumber(false);
    setMemberNumberError('');
    setIsEditorOpen(false);
  };

  const handleEditorChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = event.target;
    const nextValue = type === 'checkbox' ? (event.target as HTMLInputElement).checked : value;

    if (name === 'memberTypeId') {
      const nextMemberTypeId = nextValue as ClubMemberTypeId;

      setEditorState((current) => ({
        ...current,
        memberTypeId: nextMemberTypeId,
        familyHolderMemberId: nextMemberTypeId === 'grupo_familiar_asociado' ? current.familyHolderMemberId : undefined,
      }));

      if (nextMemberTypeId !== 'grupo_familiar_asociado') {
        setFamilyHolderQuery('');
      }

      return;
    }

    if (name === 'memberNumber') {
      setMemberNumberError('');
    }

    setEditorState((current) => ({
      ...current,
      [name]: nextValue,
    }));
  };

  const handleHasAagMembershipChange = (event: ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setHasAagMembership(checked);

    if (!checked) {
      setEditorState((current) => ({
        ...current,
        aagMembershipNumber: '',
      }));
    }
  };

  const handleSelectFamilyHolder = (holder: ClubMemberRecord) => {
    setEditorState((current) => ({
      ...current,
      familyHolderMemberId: holder.id,
    }));
    setFamilyHolderQuery('');
  };

  const clearSelectedFamilyHolder = () => {
    setEditorState((current) => ({
      ...current,
      familyHolderMemberId: undefined,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!editorState.memberNumber.trim() || !editorState.fullName.trim()) {
      setError('El numero de socio y el nombre completo son obligatorios.');
      return;
    }

    if (editorState.memberTypeId === 'grupo_familiar_asociado' && !editorState.familyHolderMemberId) {
      setError('Debes seleccionar un titular para cargar un integrante del grupo familiar.');
      return;
    }

    if (hasAagMembership && !editorState.aagMembershipNumber?.trim()) {
      setError('Marcaste que tiene matricula AAG, pero falta ingresar el numero.');
      return;
    }

    if (!selectedMember) {
      try {
        const memberNumberInUse = await isClubMemberNumberInUse(editorState.memberNumber);
        if (memberNumberInUse) {
          setMemberNumberError('Ese ID esta en uso. Intente otro o use Asignar automaticamente.');
          return;
        }
      } catch (checkError) {
        setMemberNumberError(
          checkError instanceof Error
            ? `No pudimos validar si el ID esta en uso: ${checkError.message}`
            : 'No pudimos validar si el ID esta en uso.',
        );
        return;
      }
    }

    setIsSaving(true);

    try {
      const savedMember = await saveClubMember({
        ...editorState,
        aagMembershipNumber: hasAagMembership ? editorState.aagMembershipNumber : '',
      });
      await loadMembersPage();
      setSelectedMemberId(savedMember.id);
      setEditorState(createEditorState(savedMember));
      setHasAagMembership(Boolean(savedMember.aagMembershipNumber));
      setFamilyHolderQuery('');
      setIsEditorOpen(false);
      if (!selectedMember && savedMember.temporaryAccessCredentials) {
        setCredentialsDialog({
          title: 'Usuario creado',
          credentials: savedMember.temporaryAccessCredentials,
        });
      }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'No pudimos guardar el socio.';
      if (message.toLowerCase().includes('socio con ese numero') || message.toLowerCase().includes('already-exists')) {
        setMemberNumberError('Ese ID esta en uso. Intente otro o use Asignar automaticamente.');
      } else {
        setError(message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (member: ClubMemberRecord) => {
    setError('');
    setOpenMemberActionsId(null);

    try {
      await setClubMemberActive(member.id, !member.active);
      await loadMembersPage();

      if (selectedMemberId === member.id) {
        const updatedMember = members.find((entry) => entry.id === member.id);
        if (updatedMember) {
          setEditorState(createEditorState({ ...updatedMember, active: !member.active }));
        }
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'No pudimos actualizar el estado del socio.');
    }
  };

  const handleConfirmDeleteMember = async () => {
    if (!memberPendingDelete) {
      return;
    }

    setError('');
    setIsSaving(true);

    try {
      await setClubMemberActive(memberPendingDelete.id, false);
      await loadMembersPage();
      setMemberPendingDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'No pudimos eliminar el usuario.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartLicense = async (member: ClubMemberRecord) => {
    setError('');
    setOpenMemberActionsId(null);

    const startAt = new Date().toISOString().slice(0, 10);

    try {
      await usersCallables.startLicense({
        memberId: member.id,
        startAt: new Date(`${startAt}T00:00:00.000Z`).toISOString(),
      });
      await loadMembersPage();
    } catch (licenseError) {
      setError(licenseError instanceof Error ? licenseError.message : 'No pudimos iniciar la licencia.');
    }
  };

  const handleEndLicense = async (member: ClubMemberRecord) => {
    setError('');
    setOpenMemberActionsId(null);

    try {
      await usersCallables.endLicense({ memberId: member.id });
      await loadMembersPage();
    } catch (licenseError) {
      setError(licenseError instanceof Error ? licenseError.message : 'No pudimos finalizar la licencia.');
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
      setFamilyHolderQuery('');
      setHasAagMembership(false);
      setIsEditorOpen(false);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'No pudimos restaurar el padron base.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (!hasMoreMembers || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setError('');

    try {
      await loadMembersPage({ append: true });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar mas socios.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleOverlayClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    closeEditor();
  };

  return (
    <div className="page-container member-directory-page">
      <div className="directory-shell directory-shell--full">
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
              {canEditMembers && directorySource.canReset && (
                <button type="button" className="btn-secondary" onClick={handleResetDirectory}>
                  Restaurar padron base
                </button>
              )}
              {canEditMembers && (
                <button type="button" className="btn-primary" onClick={openCreateModal}>
                  Nuevo socio
                </button>
              )}
            </div>
          </div>

          <div className="summary-grid">
            <SummaryCard label="Socios cargados" value={String(summary.totalMembers)} helper={directorySource.label} />
            <SummaryCard label="Activos" value={String(summary.activeMembers)} helper="Disponibles para operar" />
            <SummaryCard label="Grupos familiares" value={String(summary.households)} helper="Vinculados a un titular" />
            <SummaryCard label="Con matricula AAG" value={String(summary.withAagMembership)} helper="Vinculables al golf" />
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

              <div className="member-toolbar__actions" ref={filtersRef}>
                <button
                  type="button"
                  className={`icon-button icon-button--ghost ${isFiltersOpen ? 'icon-button--active' : ''}`}
                  aria-label="Otros filtros"
                  aria-expanded={isFiltersOpen}
                  onClick={() => setIsFiltersOpen((current) => !current)}
                >
                  <MoreIcon />
                </button>

                {isFiltersOpen && (
                  <div className="filter-popover">
                    <div className="filter-popover__header">
                      <strong>Otros filtros</strong>
                    </div>

                    <div className="filter-popover__row">
                      <span>Estado</span>
                      <select
                        value={activityFilter}
                        onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)}
                      >
                        {ACTIVITY_FILTER_OPTIONS.map((option) => (
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

          {error && <div className="error-message">{error}</div>}

          {loading ? (
            <div className="loading-state loading-state--inline">
              <span className="loading-spinner" />
              <strong>Obteniendo datos</strong>
            </div>
          ) : (
            <>
              <div className="directory-results">
                <strong>{filteredMembers.length} socios cargados</strong>
                <small>Pagina actual con cursor Firestore. Busca por socio, nombre, DNI y matricula AAG.</small>
              </div>

              <div className="member-table">
                <div className="member-table__head">
                  <span>Socio</span>
                  <span>Nombre</span>
                  <span>Tipo</span>
                  <span>AAG</span>
                  <span>Estado</span>
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
                        className={`member-row ${selectedMemberId === member.id ? 'member-row--selected' : ''} ${
                          openMemberActionsId === member.id ? 'member-row--menu-open' : ''
                        }`}
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
                          <strong>{member.aagMembershipNumber ?? 'Sin matricula'}</strong>
                          <small>{member.linkedUserId ? 'Con acceso app' : 'Sin acceso app'}</small>
                        </div>

                        <div className="member-cell">
                          <span className={`status-pill ${member.active ? '' : 'status-pill--bloqueado'}`}>
                            {member.active ? 'Activo' : 'No activo'}
                          </span>
                          <small>{member.status === 'license' ? 'Licencia' : member.active ? 'Activo' : 'Inactivo'}</small>
                        </div>

                        <div
                          className="member-actions"
                          ref={openMemberActionsId === member.id ? memberActionsRef : undefined}
                        >
                          {canEditMembers && (
                            <button
                              type="button"
                              className="icon-button member-icon-button"
                              aria-label={`Editar a ${member.displayName}`}
                              onClick={() => openEditModal(member)}
                            >
                              <EditIcon />
                            </button>
                          )}
                          <Link
                            className="icon-button member-icon-button"
                            aria-label={`Ver membresia de ${member.displayName}`}
                            to={`/admin/members/${member.id}`}
                          >
                            <EyeIcon />
                          </Link>
                          {canEditMembers && (
                            <button
                              type="button"
                              className={`icon-button member-icon-button ${openMemberActionsId === member.id ? 'icon-button--active' : ''}`}
                              aria-label={`Mas acciones para ${member.displayName}`}
                              aria-expanded={openMemberActionsId === member.id}
                              onClick={() =>
                                setOpenMemberActionsId((current) => (current === member.id ? null : member.id))
                              }
                            >
                              <MoreIcon />
                            </button>
                          )}

                          {canEditMembers && openMemberActionsId === member.id && (
                            <div className="member-actions-menu">
                              <button
                                type="button"
                                className="member-actions-menu__item"
                                onClick={() => void handleToggleActive(member)}
                              >
                                {member.active ? 'Desactivar socio' : 'Reactivar socio'}
                              </button>
                              {member.status === 'license' ? (
                                <button
                                  type="button"
                                  className="member-actions-menu__item"
                                  onClick={() => void handleEndLicense(member)}
                                >
                                  Finalizar licencia
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="member-actions-menu__item"
                                  onClick={() => void handleStartLicense(member)}
                                >
                                  Iniciar licencia
                                </button>
                              )}
                              <button
                                type="button"
                                className="member-actions-menu__item member-actions-menu__item--danger"
                                onClick={() => {
                                  setOpenMemberActionsId(null);
                                  setMemberPendingDelete(member);
                                }}
                              >
                                Eliminar usuario
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>

              {hasMoreMembers && (
                <div className="directory-results">
                  <button type="button" className="btn-secondary" disabled={isLoadingMore} onClick={handleLoadMore}>
                    {isLoadingMore ? 'Cargando...' : 'Cargar mas socios'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {isEditorOpen && (
        <div className="modal-overlay" onClick={handleOverlayClick}>
          <section className="floating-card member-modal-card" role="dialog" aria-modal="true">
            <div className="member-modal__header">
              <div className="member-modal__title">
                <p className="eyebrow">{selectedMember ? 'Edicion de socio' : 'Alta de socio'}</p>
                {selectedMember ? <h2>Actualizar registro</h2> : null}
              </div>

              <div className="member-modal__header-actions">
                {selectedMember && (
                  <span className={`status-pill ${selectedMember.active ? '' : 'status-pill--bloqueado'}`}>
                    {selectedMember.active ? 'Activo' : 'Inactivo'}
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

            <p className="profile-note">
              El formulario separa membresia, identificadores y observaciones sin mezclar informacion financiera.
            </p>

            {error && <div className="error-message">{error}</div>}

            <form className="member-editor-form" onSubmit={handleSubmit}>
              <label className="form-field" htmlFor="memberNumber">
                <span>Nro. socio</span>
                <div className="member-number-control">
                  <input
                    id="memberNumber"
                    name="memberNumber"
                    type="text"
                    value={editorState.memberNumber}
                    onChange={handleEditorChange}
                    disabled={Boolean(selectedMember)}
                  />
                  {!selectedMember && (
                    <button
                      type="button"
                      className="btn-secondary member-number-control__button"
                      disabled={isSuggestingMemberNumber}
                      onClick={() => void assignAutomaticMemberNumber()}
                    >
                      {isSuggestingMemberNumber ? 'Asignando...' : 'Asignar automaticamente'}
                    </button>
                  )}
                </div>
                {selectedMember && (
                  <small>El numero de socio no puede modificarse una vez creado.</small>
                )}
                {memberNumberError && <div className="field-error-message">{memberNumberError}</div>}
                {!selectedMember && isSuggestingMemberNumber && <small>Calculando proximo numero de socio...</small>}
                {!selectedMember && !isSuggestingMemberNumber && memberNumberSuggestion && (
                  <small>Sugerido: {memberNumberSuggestion}. Se valida al guardar.</small>
                )}
              </label>

              <label className="form-field member-editor-form__wide" htmlFor="fullName">
                <span>Apellido y nombre</span>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  value={editorState.fullName}
                  onChange={handleEditorChange}
                />
              </label>

              <label className="form-field" htmlFor="memberTypeId">
                <span>Tipo interno</span>
                {editorState.memberTypeId === 'grupo_familiar_titular' || editorState.memberTypeId === 'licencia' ? (
                  <input
                    id="memberTypeId"
                    type="text"
                    value={editorState.memberTypeId === 'licencia' ? 'Licencia' : 'Grupo familiar titular'}
                    readOnly
                  />
                ) : (
                  <select
                    id="memberTypeId"
                    name="memberTypeId"
                    value={editorState.memberTypeId}
                    onChange={handleEditorChange}
                  >
                    {EDITABLE_MEMBER_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="form-field" htmlFor="dni">
                <span>DNI</span>
                <input
                  id="dni"
                  name="dni"
                  type="text"
                  value={editorState.dni ?? ''}
                  onChange={handleEditorChange}
                />
              </label>

              <label className="check-field" htmlFor="hasAagMembership">
                <input
                  id="hasAagMembership"
                  type="checkbox"
                  checked={hasAagMembership}
                  onChange={handleHasAagMembershipChange}
                />
                <span>Tiene matricula AAG</span>
              </label>

              <label className="form-field" htmlFor="aagMembershipNumber">
                <span>Matricula AAG</span>
                <input
                  id="aagMembershipNumber"
                  name="aagMembershipNumber"
                  type="text"
                  value={editorState.aagMembershipNumber ?? ''}
                  onChange={handleEditorChange}
                  disabled={!hasAagMembership}
                />
              </label>

              {editorState.memberTypeId === 'grupo_familiar_asociado' && (
                <div className="member-editor-form__wide member-holder-search">
                  <label className="form-field" htmlFor="familyHolderSearch">
                    <span>Buscar titular</span>
                    <input
                      id="familyHolderSearch"
                      type="search"
                      value={familyHolderQuery}
                      onChange={(event) => setFamilyHolderQuery(event.target.value)}
                      placeholder="Nombre, DNI o nro. socio"
                    />
                  </label>

                  {selectedFamilyHolder && (
                    <div className="member-holder-search__selected">
                      <div>
                        <strong>{selectedFamilyHolder.displayName}</strong>
                        <small>
                          Socio #{selectedFamilyHolder.memberNumber}
                          {selectedFamilyHolder.dni ? ` | DNI ${selectedFamilyHolder.dni}` : ''}
                        </small>
                      </div>
                      <button type="button" className="member-action-link" onClick={clearSelectedFamilyHolder}>
                        Quitar titular
                      </button>
                    </div>
                  )}

                  {!selectedFamilyHolder && familyHolderQuery.trim().length < 2 && (
                    <p className="form-helper">
                      Busca al titular por apellido y nombre, documento o numero de socio.
                    </p>
                  )}

                  {familyHolderQuery.trim().length >= 2 && (
                    <>
                      {familyHolderResults.length > 0 ? (
                        <div className="member-holder-search__results">
                          {familyHolderResults.map((holder) => (
                            <button
                              key={holder.id}
                              type="button"
                              className="member-holder-search__result"
                              onClick={() => handleSelectFamilyHolder(holder)}
                            >
                              <strong>{holder.displayName}</strong>
                              <small>
                                Socio #{holder.memberNumber}
                                {holder.dni ? ` | DNI ${holder.dni}` : ''}
                                {holder.memberTypeId === 'pleno' ? ' | Se convertira en titular' : ' | Titular actual'}
                              </small>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="form-helper">No encontramos titulares coincidentes con esa busqueda.</p>
                      )}
                    </>
                  )}
                </div>
              )}

              {editorState.memberTypeId !== 'pleno' && (
                <label className="form-field member-editor-form__wide" htmlFor="feeDeductionPreview">
                  <span>Cuota deducida</span>
                  <input
                    id="feeDeductionPreview"
                    type="text"
                    value={feeDeductionPreview}
                    readOnly
                    placeholder="Se completa segun el tipo de socio"
                  />
                </label>
              )}

              <label className="form-field member-editor-form__wide" htmlFor="notes">
                <span>Observaciones</span>
                <textarea
                  id="notes"
                  name="notes"
                  value={editorState.notes ?? ''}
                  onChange={handleEditorChange}
                  rows={4}
                />
              </label>

              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={closeEditor}>
                  Cerrar
                </button>
                <button type="submit" className="btn-primary" disabled={isSaving}>
                  {isSaving ? 'Guardando...' : selectedMember ? 'Guardar cambios' : 'Dar de alta socio'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <TemporaryCredentialsDialog
        open={Boolean(credentialsDialog)}
        title={credentialsDialog?.title ?? ''}
        memberNumber={credentialsDialog?.credentials.memberNumber ?? ''}
        temporaryPassword={credentialsDialog?.credentials.temporaryPassword ?? ''}
        onClose={() => setCredentialsDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(memberPendingDelete)}
        title="Eliminar usuario"
        description={
          memberPendingDelete ? (
            <>
              Vas a dejar inactivo a {memberPendingDelete.displayName}. La ficha, el historial y los movimientos
              vinculados se conservan para auditoria.
            </>
          ) : null
        }
        confirmLabel="Eliminar"
        tone="danger"
        loading={isSaving}
        onCancel={() => setMemberPendingDelete(null)}
        onConfirm={() => void handleConfirmDeleteMember()}
      />
    </div>
  );
}
