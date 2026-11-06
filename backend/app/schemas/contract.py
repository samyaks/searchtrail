# GENERATED from contracts/openapi.yaml by scripts/codegen.sh. Do not edit.

from __future__ import annotations

from datetime import date as date_aliased
from enum import StrEnum
from typing import Annotated, Any
from uuid import UUID

from pydantic import AnyUrl, AwareDatetime, BaseModel, ConfigDict, EmailStr, Field, RootModel


class Status(StrEnum):
    OK = 'ok'
    DEGRADED = 'degraded'


class Database(StrEnum):
    OK = 'ok'
    UNREACHABLE = 'unreachable'


class Health(BaseModel):
    status: Status
    version: str
    database: Database
    dry_run: Annotated[bool, Field(description='True when SEARCHTRAIL_DRY_RUN=1 (no tenant is contacted)')]


class ErrorCode(StrEnum):
    CRITERIA_INVALID = 'criteria_invalid'
    EXPORT_NOT_PREVIEWED = 'export_not_previewed'
    EXPORT_COUNTS_CHANGED = 'export_counts_changed'
    CONFIRMATION_MISMATCH = 'confirmation_mismatch'
    PURVIEW_PERMISSION_MISSING = 'purview_permission_missing'
    LICENSE_MISSING = 'license_missing'
    GRAPH_THROTTLED = 'graph_throttled'
    PURVIEW_OPERATION_FAILED = 'purview_operation_failed'
    SESSION_EXPIRED = 'session_expired'
    VALIDATION_FAILED = 'validation_failed'
    NOT_FOUND = 'not_found'
    CONFLICT = 'conflict'
    INTERNAL_ERROR = 'internal_error'


class Error(BaseModel):
    code: ErrorCode
    message: Annotated[str, Field(description='A plain-English explanation and how to fix it, safe to show to the user')]
    details: Annotated[dict[str, Any], Field(description='Extra, code-specific data (for example the changed counts)')]


class UserRef(BaseModel):
    id: str
    display_name: str


class User(BaseModel):
    id: str
    display_name: str
    email: EmailStr
    initials: str


class Tenant(BaseModel):
    id: str
    name: str


class Cloud(StrEnum):
    COMMERCIAL = 'commercial'
    GCC = 'gcc'
    GCC_HIGH = 'gcc_high'
    DOD = 'dod'


class Key(StrEnum):
    GRAPH_REACHABLE = 'graph_reachable'
    EDISCOVERY_LICENSE = 'ediscovery_license'
    PURVIEW_ROLE = 'purview_role'
    DOWNLOAD_PERMISSION = 'download_permission'
    LABELS_PERMISSION = 'labels_permission'


class Status1(StrEnum):
    OK = 'ok'
    WARNING = 'warning'
    FAILED = 'failed'


class Check(BaseModel):
    key: Key
    label: str
    status: Status1
    message: str


class SetupCheck(BaseModel):
    cloud: Cloud
    dry_run: bool
    ready: Annotated[bool, Field(description='True when no check failed')]
    checks: list[Check]


class Label(BaseModel):
    id: UUID
    name: str
    path: str
    description: str | None
    sublabels: list[Label]


class LabelList(BaseModel):
    items: list[Label]


class DirectoryUser(BaseModel):
    id: Annotated[str, Field(description='Entra object ID')]
    display_name: str
    email: EmailStr
    department: str | None
    initials: str


class DirectoryUserList(BaseModel):
    items: list[DirectoryUser]


class MatterStage(StrEnum):
    SCOPING = 'scoping'
    PREVIEWED = 'previewed'
    EXPORTING = 'exporting'
    EXPORTED = 'exported'


class MatterType(StrEnum):
    INVESTIGATION = 'investigation'
    LITIGATION = 'litigation'
    REGULATORY = 'regulatory'
    DSR = 'dsr'


class LatestCounts(BaseModel):
    items: Annotated[int, Field(ge=0)]
    partial_items: Annotated[int, Field(ge=0)]


class MatterSummary(BaseModel):
    id: str
    matter_number: Annotated[str, Field(description="The firm's matter number, also used as the Purview case name prefix")]
    name: str
    stage: MatterStage
    custodian_count: Annotated[int, Field(ge=0)]
    current_version: Annotated[int | None, Field(description='Latest query version, null before the first estimate')]
    latest_counts: LatestCounts | None
    export_progress: Annotated[float | None, Field(description='Set while stage is exporting', ge=0.0, le=1.0)]
    last_activity_at: AwareDatetime
    owner: UserRef


class MatterList(BaseModel):
    items: list[MatterSummary]
    total: Annotated[int, Field(ge=0)]


class MatterCreate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    matter_number: Annotated[str, Field(pattern='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    name: Annotated[str, Field(max_length=200, min_length=1)]
    type: MatterType
    description: Annotated[str | None, Field(max_length=2000)] = ''


class MatterUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    name: Annotated[str | None, Field(max_length=200, min_length=1)] = None
    type: MatterType | None = None
    description: Annotated[str | None, Field(max_length=2000)] = None


class HoldStatus(StrEnum):
    OFF = 'off'
    PENDING = 'pending'
    ON = 'on'
    RELEASING = 'releasing'
    FAILED = 'failed'


class Hold(BaseModel):
    status: HoldStatus
    since: Annotated[AwareDatetime | None, Field(description='When the hold took effect')]


class HoldUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    on_hold: bool


class Custodian(BaseModel):
    user_id: str
    display_name: str
    email: EmailStr
    department: str | None
    initials: str
    mailbox: Annotated[bool, Field(description='Search the mailbox and Teams chats')]
    onedrive: Annotated[bool, Field(description='Search OneDrive')]
    sites: Annotated[list[AnyUrl], Field(description='SharePoint sites linked to this custodian')]
    hold: Hold


class CustodianUpsert(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    mailbox: bool
    onedrive: bool
    sites: list[AnyUrl] | None = []


class Site(BaseModel):
    id: str
    url: AnyUrl


class SiteCreate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    url: AnyUrl


class ItemKind(StrEnum):
    EMAIL = 'email'
    CHATS = 'chats'
    DOCS = 'docs'


class Keyword(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class KeywordMode(StrEnum):
    ANY = 'any'
    ALL = 'all'


class ExcludeKeyword(RootModel[str]):
    root: Annotated[str, Field(min_length=1)]


class FileExtension(RootModel[str]):
    root: Annotated[str, Field(pattern='^[a-z0-9]{1,10}$')]


class DocDateProperty(StrEnum):
    LASTMODIFIEDTIME = 'lastmodifiedtime'
    CREATED = 'created'


class Criteria(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    keywords: Annotated[list[Keyword], Field(description='Terms and phrases. `word*` is a prefix match; leading wildcards are rejected.')]
    keyword_mode: KeywordMode
    exclude_keywords: list[ExcludeKeyword]
    date_from: Annotated[date_aliased | None, Field(description='Inclusive')]
    date_to: Annotated[date_aliased | None, Field(description='Inclusive')]
    kinds: Annotated[list[ItemKind], Field(min_length=1)]
    file_extensions: Annotated[list[FileExtension], Field(description='Documents only')]
    participant_domains: Annotated[list[str], Field(description='Emails and chats only')]
    exclude_participant_domains: Annotated[list[str], Field(description='Emails and chats only')]
    label_ids: Annotated[
        list[UUID], Field(description='Only items with these labels (a parent includes its sublabels). Excludes unlabelled items.')
    ]
    exclude_label_ids: list[UUID]
    doc_date_property: DocDateProperty
    raw_kql: Annotated[str | None, Field(description='Expert escape hatch, ANDed onto the query')]


class Draft(BaseModel):
    criteria: Criteria
    updated_at: AwareDatetime
    based_on_version: int | None
    changed_since_version: Annotated[
        bool, Field(description='True when the draft would produce a different query or sources than `based_on_version`')
    ]


class DraftUpdate(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    criteria: Criteria


class KqlPreviewRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    criteria: Criteria


class KqlPreview(BaseModel):
    kql: str
    length: Annotated[int, Field(description='Characters in the KQL. Purview has length limits; a warning appears past 4,000.')]
    methodology: Annotated[list[str], Field(description='One sentence per line, ready for a methodology memo')]
    warnings: list[str]


class Counts(BaseModel):
    items: Annotated[int, Field(description='Indexed items matching', ge=0)]
    size_bytes: Annotated[int, Field(ge=0)]
    partial_items: Annotated[int, Field(description='Partially indexed items (could not be keyword-searched)', ge=0)]
    partial_size_bytes: Annotated[int, Field(ge=0)]
    mailboxes: Annotated[int, Field(ge=0)]
    sites: Annotated[int, Field(ge=0)]


class EstimateResult(BaseModel):
    version: int
    estimated_at: AwareDatetime
    counts: Counts


class NamedCount(BaseModel):
    name: str
    count: Annotated[int, Field(ge=0)]


class MonthCount(BaseModel):
    month: Annotated[str, Field(pattern='^\\d{4}-\\d{2}$')]
    count: Annotated[int, Field(ge=0)]


class Breakdowns(BaseModel):
    by_location: list[NamedCount]
    by_type: list[NamedCount]
    by_label: list[NamedCount]
    by_month: list[MonthCount]


class Preview(BaseModel):
    id: str
    matter_id: str
    version: int
    created_at: AwareDatetime
    created_by: UserRef
    stale: Annotated[bool, Field(description='True when the draft changed after this preview')]
    counts: Counts
    report_items: Annotated[int, Field(description="Rows in Purview's item report (matching plus partially indexed, if included)")]
    encrypted_items: int
    breakdowns: Breakdowns
    unmapped_columns: Annotated[list[str], Field(description="Report columns the parser didn't recognise (see report.COLUMN_CANDIDATES)")]


class ItemType(StrEnum):
    EMAIL = 'email'
    TEAMS_CHAT = 'teams_chat'
    DOCUMENT = 'document'
    OTHER = 'other'


class PreviewItem(BaseModel):
    id: str
    title: str
    location: Annotated[str, Field(description='Custodian name or site')]
    type: ItemType
    date: AwareDatetime | None
    label: Annotated[str | None, Field(description='Label path; null when unlabelled')]
    size_bytes: int | None
    encrypted: bool


class PreviewItemPage(BaseModel):
    items: list[PreviewItem]
    total: int
    page: int
    page_size: int


class TermRow(BaseModel):
    term: Annotated[str, Field(description='The term as it appears in the KQL')]
    items: int
    size_bytes: int
    previous_items: Annotated[int | None, Field(description="Hits in the previous version's term report; null if the term is new")]
    previous_version: int | None


class Combined(BaseModel):
    items: int
    size_bytes: int


class TermReport(BaseModel):
    id: str
    matter_id: str
    version: int
    created_at: AwareDatetime
    created_by: UserRef
    stale: bool
    combined: Annotated[Combined, Field(description='All terms together (the full query)')]
    rows: list[TermRow]


class PartiallyIndexedScope(StrEnum):
    RESPONSIVE_LOCATIONS = 'responsiveLocations'
    RESPONSIVE_LOCATIONS__NONRESPONSIVE_LOCATIONS = 'responsiveLocations, nonresponsiveLocations'


class Format(StrEnum):
    PST = 'pst'
    MSG = 'msg'


class ExportOptions(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    include_partially_indexed: Annotated[bool, Field(description='Decide this deliberately, with counsel. The choice is logged.')]
    partially_indexed_scope: PartiallyIndexedScope | None = 'responsiveLocations'
    format: Format
    include_cloud_attachments: Annotated[bool | None, Field(description='Files linked in emails (current version)')] = False
    teams_transcripts: Annotated[bool | None, Field(description='HTML transcript per Teams conversation')] = True


class Key1(StrEnum):
    PREVIEWED = 'previewed'
    SAME_SOURCES = 'same_sources'
    COUNTS_UNCHANGED = 'counts_unchanged'


class Status2(StrEnum):
    PASSED = 'passed'
    FAILED = 'failed'
    SKIPPED = 'skipped'


class ExportCheckItem(BaseModel):
    key: Key1
    status: Status2
    message: str


class BlockedCode(StrEnum):
    EXPORT_NOT_PREVIEWED = 'export_not_previewed'
    EXPORT_COUNTS_CHANGED = 'export_counts_changed'


class ExportCheck(BaseModel):
    ready: bool
    blocked_code: Annotated[BlockedCode | None, Field(description='The error a real export would return now, if any')]
    version: int | None
    previewed_version: int | None
    previewed_at: AwareDatetime | None
    checked_at: AwareDatetime
    counts: Annotated[Counts | None, Field(description='Counts now (null if not re-checked)')]
    checks: list[ExportCheckItem]


class ExportStart(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    options: ExportOptions
    confirm_matter_number: str
    accept_changes: Annotated[bool | None, Field(description='Export even if counts changed since the preview (logged)')] = False


class ExportStatus(StrEnum):
    PREPARING = 'preparing'
    READY = 'ready'
    FAILED = 'failed'
    EXPIRED = 'expired'


class HandoffStatus(StrEnum):
    NONE = 'none'
    RUNNING = 'running'
    DONE = 'done'
    FAILED = 'failed'


class File(BaseModel):
    name: str
    size_bytes: int | None


class Download(BaseModel):
    status: HandoffStatus
    progress: Annotated[float | None, Field(ge=0.0, le=1.0)]
    stored_path: Annotated[str | None, Field(description="Where the package was stored (in SearchTrail's storage)")]
    finished_at: AwareDatetime | None


class ReviewSet(BaseModel):
    status: HandoffStatus
    name: str | None
    finished_at: AwareDatetime | None


class Export(BaseModel):
    id: str
    matter_id: str
    name: Annotated[str, Field(description="The export's name in Purview")]
    version: int
    status: ExportStatus
    progress: Annotated[float, Field(ge=0.0, le=1.0)]
    counts: Counts
    options: ExportOptions
    changes_accepted: bool
    started_at: AwareDatetime
    started_by: UserRef
    finished_at: AwareDatetime | None
    expires_at: Annotated[AwareDatetime | None, Field(description='When Purview deletes the download (about 30 days)')]
    files: list[File]
    download: Download
    review_set: ReviewSet


class ExportList(BaseModel):
    items: list[Export]


class ReviewSetRequest(BaseModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    review_set_name: Annotated[str, Field(max_length=200, min_length=1)]


class QueryVersion(BaseModel):
    version: int
    created_at: AwareDatetime
    created_by: UserRef
    summary: Annotated[str, Field(description='Short description of what changed from the previous version')]
    criteria: Criteria
    kql: str
    methodology: list[str]
    sources_fingerprint: Annotated[str, Field(description='SHA-256 of the custodians and sites searched')]
    purview_search_id: str | None
    counts: Counts | None
    exported: bool


class QueryVersionList(BaseModel):
    items: list[QueryVersion]


class Change1(StrEnum):
    ADDED = 'added'
    REMOVED = 'removed'


class Change(BaseModel):
    change: Change1
    text: str


class Counts1(BaseModel):
    from_items: int | None
    to_items: int | None
    delta: int | None


class VersionComparison(BaseModel):
    from_: Annotated[int, Field(alias='from')]
    to: int
    changes: list[Change]
    unchanged: Annotated[str, Field(description='Plain-English list of what stayed the same')]
    sources_changed: bool
    counts: Counts1


class LogAction(StrEnum):
    MATTER_CREATED = 'matter_created'
    MATTER_UPDATED = 'matter_updated'
    CUSTODIAN_ADDED = 'custodian_added'
    CUSTODIAN_UPDATED = 'custodian_updated'
    CUSTODIAN_REMOVED = 'custodian_removed'
    SITE_ADDED = 'site_added'
    SITE_REMOVED = 'site_removed'
    HOLD_PLACED = 'hold_placed'
    HOLD_RELEASED = 'hold_released'
    ESTIMATE = 'estimate'
    PREVIEW = 'preview'
    TERM_REPORT = 'term_report'
    EXPORT_STARTED = 'export_started'
    EXPORT_FINISHED = 'export_finished'
    EXPORT_DOWNLOADED = 'export_downloaded'
    REVIEW_SET_ADDED = 'review_set_added'


class LogEntry(BaseModel):
    seq: Annotated[int, Field(ge=1)]
    ts: AwareDatetime
    action: LogAction
    actor: Annotated[str, Field(description='Display name of the person, or SearchTrail for automatic steps')]
    summary: str
    version: int | None
    prev_hash: Annotated[str, Field(pattern='^[0-9a-f]{64}$')]
    hash: Annotated[str, Field(pattern='^[0-9a-f]{64}$')]
    details: Annotated[dict[str, Any], Field(description='The full logged record (KQL, criteria, counts, settings)')]


class LogEntryPage(BaseModel):
    items: list[LogEntry]
    total: int
    page: int
    page_size: int


class LogVerification(BaseModel):
    ok: bool
    entries: int
    first_bad_seq: int | None
    message: str
    verified_at: AwareDatetime


class JobKind(StrEnum):
    ESTIMATE = 'estimate'
    PREVIEW = 'preview'
    TERM_REPORT = 'term_report'
    EXPORT = 'export'
    DOWNLOAD = 'download'
    REVIEW_SET = 'review_set'


class JobStatus(StrEnum):
    QUEUED = 'queued'
    RUNNING = 'running'
    SUCCEEDED = 'succeeded'
    FAILED = 'failed'


class Job(BaseModel):
    id: str
    kind: JobKind
    status: JobStatus
    progress: Annotated[float, Field(ge=0.0, le=1.0)]
    matter_id: str | None
    created_at: AwareDatetime
    updated_at: AwareDatetime
    result: EstimateResult | Preview | TermReport | Export | None
    error: Error | None


class Me(BaseModel):
    user: User
    tenant: Tenant
    purview_roles: Annotated[list[str], Field(description='Purview role groups found for the user (for example "eDiscovery Manager")')]
    cloud: Cloud
    dry_run: bool


class Matter(BaseModel):
    id: str
    matter_number: str
    name: str
    type: MatterType
    description: str
    stage: MatterStage
    purview_case_id: Annotated[str | None, Field(description='Set once the Purview case exists')]
    created_at: AwareDatetime
    created_by: UserRef
    custodians: list[Custodian]
    sites: Annotated[list[Site], Field(description='Sites without a custodian')]
    current_version: int | None
    previewed_version: int | None
    last_previewed_at: AwareDatetime | None
    draft_changed: Annotated[bool, Field(description='True when the draft criteria or sources differ from the current version')]


Label.model_rebuild()
