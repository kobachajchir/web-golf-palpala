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
  type ReactNode,
} from 'react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TemporaryCredentialsDialog } from '../components/TemporaryCredentialsDialog';
import { UiActionButton } from '../components/UiActionButton';
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
  minorMembers: number;
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

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
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
    const [totalMembers, activeMembers, households, withAagMembership, minorMembers] = await Promise.all([
      getCountFromServer(membersRef),
      getCountFromServer(query(membersRef, where('status', '==', 'active'))),
      getCountFromServer(query(familyGroupsRef, where('active', '==', true))),
      getCountFromServer(query(membersRef, where('aagMembershipNumber', '>', ''))),
      getCountFromServer(query(membersRef, where('memberTypeId', '==', 'menor'))),
    ]);

    setDirectoryStats({
      totalMembers: totalMembers.data().count,
      activeMembers: activeMembers.data().count,
      households: households.data().count,
      withAagMembership: withAagMembership.data().count,
      minorMembers: minorMembers.data().count,
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
  const activeSearchCount =
    Number(searchQuery.trim().length > 0) + Number(memberTypeFilter !== 'all') + Number(activityFilter !== 'all');

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
    const households = new Set(
      members
        .map((member) => member.familyGroupId ?? member.familyGroupCode)
        .filter((groupId): groupId is string => Boolean(groupId)),
    );

    return {
      totalMembers: directoryStats?.totalMembers ?? members.length,
      activeMembers: directoryStats?.activeMembers ?? members.filter((member) => member.active).length,
      households: directoryStats?.households ?? households.size,
      withAagMembership: directoryStats?.withAagMembership ?? members.filter((member) => Boolean(member.aagMembershipNumber)).length,
      minorMembers: directoryStats?.minorMembers ?? members.filter((member) => member.memberTypeId === 'menor').length,
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

  const isMemberEditorSubmitDisabled =
    isSaving ||
    !editorState.memberNumber.trim() ||
    !editorState.fullName.trim() ||
    (editorState.memberTypeId === 'grupo_familiar_asociado' && !editorState.familyHolderMemberId) ||
    (hasAagMembership && !editorState.aagMembershipNumber?.trim());

  return (
    <div className="page-container member-directory-page directory-workbench-page">
      <div className="directory-shell directory-workbench-shell">
        <section className="floating-card tournament-hero directory-workbench-hero">
          <div className="tournament-hero__copy">
            <p className="eyebrow">Gestion de socios</p>
            <h1>Padron del club</h1>
            <p>
              Busca socios, revisa estado de membresia, administra grupos
              familiares y entra a la ficha en un click.
            </p>
          </div>

          <div className="tournament-hero__actions">
            {canEditMembers && directorySource.canReset && (
              <button
                type="button"
                className="ui-action-button ui-action-button--secondary"
                onClick={handleResetDirectory}
              >
                Restaurar padron base
              </button>
            )}
            {canEditMembers && (
              <button
                type="button"
                className="ui-action-button ui-action-button--positive"
                onClick={openCreateModal}
              >
                <Icon type="plus" />
                <span>Nuevo socio</span>
              </button>
            )}
          </div>
        </section>

        <section
          className="tournament-summary-grid directory-summary-grid"
          aria-label="Resumen de socios"
        >
          <SummaryCard
            label="Socios activos"
            value={String(summary.activeMembers)}
          />
          <SummaryCard
            label="Grupos familiares"
            value={String(summary.households)}
          />
          <SummaryCard
            label="Con matricula AAG"
            value={String(summary.withAagMembership)}
          />
          <SummaryCard
            label="Menores"
            value={String(summary.minorMembers)}
          />
        </section>

        <section className="floating-card tournament-main-panel directory-workbench-panel">
          <div className="tournament-section-header directory-panel-header">
            <div>
              <p className="eyebrow">Listado operativo</p>
              <h2>Socios, membresias y accesos</h2>
              <p className="profile-note">
                Filtra el padron, abre fichas de membresia y ejecuta acciones
                administrativas desde el listado.
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
                      : "Buscar por socio, nombre, DNI, matricula, tipo o estado"}
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

                    <label
                      className="form-field member-filter"
                      htmlFor="memberTypeFilter"
                    >
                      <span>Tipo</span>
                      <select
                        id="memberTypeFilter"
                        value={memberTypeFilter}
                        onChange={(event) =>
                          setMemberTypeFilter(
                            event.target.value as MemberTypeFilter,
                          )
                        }
                      >
                        <option value="all">Todos los tipos</option>
                        {MEMBER_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="form-field member-filter">
                      <span>Estado</span>
                      <select
                        value={activityFilter}
                        onChange={(event) =>
                          setActivityFilter(
                            event.target.value as ActivityFilter,
                          )
                        }
                      >
                        {ACTIVITY_FILTER_OPTIONS.map((option) => (
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
                        className={`member-row ${selectedMemberId === member.id ? "member-row--selected" : ""} ${
                          openMemberActionsId === member.id
                            ? "member-row--menu-open"
                            : ""
                        }`}
                      >
                        <div className="member-cell">
                          <strong>#{member.memberNumber}</strong>
                          <small>{member.id}</small>
                        </div>

                        <div className="member-cell">
                          <strong>{member.displayName}</strong>
                          <small>
                            {member.dni ? `DNI ${member.dni}` : "DNI pendiente"}
                          </small>
                        </div>

                        <div className="member-cell">
                          <span className="member-type-badge">
                            {member.memberTypeLabel}
                          </span>
                          {member.householdSize > 1 && (
                            <small>
                              {member.isFamilyHolder
                                ? "Titular familiar"
                                : "Integrante familiar"}
                            </small>
                          )}
                        </div>

                        <div className="member-cell">
                          <strong>
                            {member.aagMembershipNumber ?? "Sin matricula"}
                          </strong>
                          <small>
                            {member.linkedUserId
                              ? "Con acceso app"
                              : "Sin acceso app"}
                          </small>
                        </div>

                        <div className="member-cell">
                          <span
                            className={`status-pill status-pill-green ${member.active ? "" : "status-pill--bloqueado"}`}
                          >
                            {member.active ? "Activo" : "No activo"}
                          </span>
                          <small>
                            {member.status === "license" ? "Licencia" : null}
                          </small>
                        </div>

                        <div
                          className="member-actions"
                          ref={
                            openMemberActionsId === member.id
                              ? memberActionsRef
                              : undefined
                          }
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
                              className={`icon-button member-icon-button ${openMemberActionsId === member.id ? "icon-button--active" : ""}`}
                              aria-label={`Mas acciones para ${member.displayName}`}
                              aria-expanded={openMemberActionsId === member.id}
                              onClick={() =>
                                setOpenMemberActionsId((current) =>
                                  current === member.id ? null : member.id,
                                )
                              }
                            >
                              <MoreIcon />
                            </button>
                          )}

                          {canEditMembers &&
                            openMemberActionsId === member.id && (
                              <div className="member-actions-menu">
                                <button
                                  type="button"
                                  className="member-actions-menu__item"
                                  onClick={() =>
                                    void handleToggleActive(member)
                                  }
                                >
                                  {member.active
                                    ? "Desactivar socio"
                                    : "Reactivar socio"}
                                </button>
                                {member.status === "license" ? (
                                  <button
                                    type="button"
                                    className="member-actions-menu__item"
                                    onClick={() =>
                                      void handleEndLicense(member)
                                    }
                                  >
                                    Finalizar licencia
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="member-actions-menu__item"
                                    onClick={() =>
                                      void handleStartLicense(member)
                                    }
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
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isLoadingMore}
                    onClick={handleLoadMore}
                  >
                    {isLoadingMore ? "Cargando..." : "Cargar mas socios"}
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
                  {selectedMember ? "Edicion de socio" : "Alta de socio"}
                </p>
                {selectedMember ? <h2>Actualizar registro</h2> : null}
              </div>

              <div className="member-modal__header-actions">
                {selectedMember && (
                  <span
                    className={`status-pill status-pill-green ${selectedMember.active ? "" : "status-pill--bloqueado"}`}
                  >
                    {selectedMember.active ? "Activo" : "Inactivo"}
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
              El formulario separa membresia, identificadores y observaciones
              sin mezclar informacion financiera.
            </p>

            {error && <div className="error-message">{error}</div>}

            <form className="member-editor-form" onSubmit={handleSubmit}>
              <label className="form-field member-editor-form__wide member-number-field" htmlFor="memberNumber">
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
                    <UiActionButton
                      type="button"
                      variant="secondary"
                      compact
                      className="member-number-control__button"
                      disabled={isSuggestingMemberNumber}
                      onClick={() => void assignAutomaticMemberNumber()}
                    >
                      {isSuggestingMemberNumber
                        ? "Asignando..."
                        : "Asignar automaticamente"}
                    </UiActionButton>
                  )}
                </div>
                {selectedMember && (
                  <small>
                    El numero de socio no puede modificarse una vez creado.
                  </small>
                )}
                {memberNumberError && (
                  <div className="field-error-message">{memberNumberError}</div>
                )}
                {!selectedMember && isSuggestingMemberNumber && (
                  <small>Calculando proximo numero de socio...</small>
                )}
                {!selectedMember &&
                  !isSuggestingMemberNumber &&
                  memberNumberSuggestion && (
                    <small>
                      Sugerido: {memberNumberSuggestion}. Se valida al guardar.
                    </small>
                  )}
              </label>

              <label
                className="form-field member-editor-form__wide"
                htmlFor="fullName"
              >
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
                {editorState.memberTypeId === "grupo_familiar_titular" ||
                editorState.memberTypeId === "licencia" ? (
                  <input
                    id="memberTypeId"
                    type="text"
                    value={
                      editorState.memberTypeId === "licencia"
                        ? "Licencia"
                        : "Grupo familiar titular"
                    }
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
                  value={editorState.dni ?? ""}
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
                  value={editorState.aagMembershipNumber ?? ""}
                  onChange={handleEditorChange}
                  disabled={!hasAagMembership}
                />
              </label>

              {editorState.memberTypeId === "grupo_familiar_asociado" && (
                <div className="member-editor-form__wide member-holder-search">
                  <label className="form-field" htmlFor="familyHolderSearch">
                    <span>Buscar titular</span>
                    <input
                      id="familyHolderSearch"
                      type="search"
                      value={familyHolderQuery}
                      onChange={(event) =>
                        setFamilyHolderQuery(event.target.value)
                      }
                      placeholder="Nombre, DNI o nro. socio"
                    />
                  </label>

                  {selectedFamilyHolder && (
                    <div className="member-holder-search__selected">
                      <div>
                        <strong>{selectedFamilyHolder.displayName}</strong>
                        <small>
                          Socio #{selectedFamilyHolder.memberNumber}
                          {selectedFamilyHolder.dni
                            ? ` | DNI ${selectedFamilyHolder.dni}`
                            : ""}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="member-action-link"
                        onClick={clearSelectedFamilyHolder}
                      >
                        Quitar titular
                      </button>
                    </div>
                  )}

                  {!selectedFamilyHolder &&
                    familyHolderQuery.trim().length < 2 && (
                      <p className="form-helper">
                        Busca al titular por apellido y nombre, documento o
                        numero de socio.
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
                                {holder.dni ? ` | DNI ${holder.dni}` : ""}
                                {holder.memberTypeId === "pleno"
                                  ? " | Se convertira en titular"
                                  : " | Titular actual"}
                              </small>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="form-helper">
                          No encontramos titulares coincidentes con esa
                          busqueda.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {editorState.memberTypeId !== "pleno" && (
                <label
                  className="form-field member-editor-form__wide"
                  htmlFor="feeDeductionPreview"
                >
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

              <label
                className="form-field member-editor-form__wide member-editor-form__notes"
                htmlFor="notes"
              >
                <span>Observaciones</span>
                <textarea
                  id="notes"
                  name="notes"
                  value={editorState.notes ?? ""}
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
                  disabled={isMemberEditorSubmitDisabled}
                >
                  {isSaving
                    ? "Guardando..."
                    : selectedMember
                      ? "Guardar cambios"
                      : "Dar de alta socio"}
                </UiActionButton>
              </div>
            </form>
          </section>
        </div>
      )}

      <TemporaryCredentialsDialog
        open={Boolean(credentialsDialog)}
        title={credentialsDialog?.title ?? ""}
        memberNumber={credentialsDialog?.credentials.memberNumber ?? ""}
        temporaryPassword={
          credentialsDialog?.credentials.temporaryPassword ?? ""
        }
        onClose={() => setCredentialsDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(memberPendingDelete)}
        title="Eliminar usuario"
        description={
          memberPendingDelete ? (
            <>
              Vas a dejar inactivo a {memberPendingDelete.displayName}. La
              ficha, el historial y los movimientos vinculados se conservan para
              auditoria.
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
