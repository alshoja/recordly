<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { Component } from 'vue';
import {
    BriefcaseIcon,
    FileTextIcon,
    HeartIcon,
    IdIcon,
    MapPinIcon,
    ShieldCheckIcon,
    UserIcon,
    WandIcon,
} from 'vue-tabler-icons';
import DefaultImage from '@/assets/images/profile/profile.png';
import type { RecordDetail } from '@/interfaces/record.interface';
import { useRecordStore } from '@/stores/record';
import { useSnackbarStore } from '@/stores/snackbar.store';
import DetailField from './DetailField.vue';
import DetailSection from './DetailSection.vue';
import FileViewer from './FileViewer.vue';
import AuthorizedImage from '@/components/shared/AuthorizedImage.vue';

interface NavigationItem {
    id: string;
    title: string;
    icon: Component;
}

interface FieldDef {
    label: string;
    value?: string;
    required?: boolean;
}

interface ReviewField {
    label: string;
    display: string;
    missing: boolean;
}

interface ReviewRow {
    title: string;
    detail: string;
    revealKey?: string;
}

type ReviewDot = 'red' | 'amber' | 'green' | 'neutral';

interface ReviewSection {
    id: string;
    title: string;
    icon: Component;
    step: number;
    dot: ReviewDot;
    count: string;
    fields?: ReviewField[];
    rows?: ReviewRow[];
    emptyText?: string;
}

const props = defineProps<{
    form: RecordDetail;
    canEdit?: boolean;
    reviewMode?: boolean;
}>();

const emit = defineEmits<{
    close: [];
    edit: [];
    'jump-to-step': [step: number];
}>();

const showSensitiveDetails = ref(false);
const hideEmptyFields = ref(true);
const isDocumentVisible = ref(false);
const currentDocumentUrl = ref('');
const activeSection = ref('personal');
const profileImage = ref(props.form.profileImage || DefaultImage);
const indexingDocumentId = ref<string>();
const recordStore = useRecordStore();
const snackbar = useSnackbarStore();

const navigationItems: NavigationItem[] = [
    { id: 'personal', title: 'Personal', icon: UserIcon },
    { id: 'identity', title: 'Identity', icon: IdIcon },
    { id: 'occupation', title: 'Occupation & Addresses', icon: BriefcaseIcon },
    { id: 'family', title: 'Family', icon: HeartIcon },
    { id: 'financial-accounts', title: 'Financial Accounts', icon: ShieldCheckIcon },
    { id: 'documents', title: 'Documents', icon: FileTextIcon },
];

const fullName = computed(() => `${props.form.firstName || ''} ${props.form.lastName || ''}`.trim() || 'Unnamed record');
const initials = computed(() => `${(props.form.firstName || '?')[0]}${props.form.lastName ? props.form.lastName[0] : ''}`.toUpperCase());
const statusColor = computed(() => props.form.status === 'COMPLETED' ? 'success' : 'warning');
const statusLabel = computed(() => props.form.status === 'COMPLETED' ? 'Completed' : 'Draft');

const displaySensitiveValue = (value?: string) => {
    if (!value) return '—';
    if (showSensitiveDetails.value) return value;

    const visibleCharacters = value.slice(-4);
    return `${'•'.repeat(Math.max(value.length - 4, 4))} ${visibleCharacters}`;
};

const revealedRows = reactive<Record<string, boolean>>({});
const isRowRevealed = (key: string) => Boolean(revealedRows[key]);
const toggleRowReveal = (key: string) => {
    revealedRows[key] = !revealedRows[key];
};
const reviewRowValue = (key: string, value?: string) => {
    if (!value) return '—';
    return isRowRevealed(key) ? value : displaySensitiveValue(value);
};

const scrollToSection = (sectionId: string) => {
    activeSection.value = sectionId;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const viewDocument = (file: string) => {
    currentDocumentUrl.value = file;
    isDocumentVisible.value = true;
};

const MIME_TYPE_LABELS: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOC',
};
const EXTENSION_LABELS: Record<string, string> = {
    pdf: 'PDF', jpg: 'JPG', jpeg: 'JPG', png: 'PNG', doc: 'DOC', docx: 'DOC',
};
const documentTypeLabel = (document: NonNullable<RecordDetail['documents']>[number]) => {
    if (document.mimeType && MIME_TYPE_LABELS[document.mimeType]) return MIME_TYPE_LABELS[document.mimeType];
    const extension = document.name?.split('.').pop()?.toLowerCase();
    return (extension && EXTENSION_LABELS[extension]) || 'FILE';
};

const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatUploadedAt = (value?: Date | string) => {
    if (!value) return null;
    return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const documentDetailLine = (document: NonNullable<RecordDetail['documents']>[number]) => {
    if (!document.file) return 'No file attached — required';
    const parts = [documentTypeLabel(document), formatFileSize(document.size)].filter(Boolean);
    const uploaded = formatUploadedAt(document.uploadedAt);
    if (uploaded) parts.push(`uploaded ${uploaded}`);
    return parts.join(' · ');
};

const extractionStatusLabels: Record<string, string> = {
    PENDING: 'Waiting',
    PROCESSING: 'Reading',
    READY: 'Read',
    UNSUPPORTED: 'Not supported',
    FAILED: "Couldn't read"
};

const searchIndexStatusLabels: Record<string, string> = {
    NOT_INDEXED: 'Not AI searchable yet',
    INDEXING: 'Getting ready',
    INDEXED: 'AI searchable',
    FAILED: 'Failed to include in AI chat',
    DISABLED: 'Turned off'
};

const searchIndexStatusColor = (status?: string) => {
    if (status === 'INDEXED') return 'success';
    if (status === 'INDEXING') return 'info';
    if (status === 'FAILED') return 'error';
    if (status === 'DISABLED') return 'grey';
    return 'warning';
};

const canRetrySearchIndex = (document: NonNullable<RecordDetail['documents']>[number]) =>
    Boolean(
        props.form.id &&
        document.id &&
        // A failed extraction can be retried too, since retrying re-runs extraction and indexing.
        (document.extractionStatus === 'READY' || document.extractionStatus === 'FAILED') &&
        ['NOT_INDEXED', 'FAILED', 'DISABLED', undefined].includes(document.searchIndexStatus)
    );

const retrySearchIndex = async (document: NonNullable<RecordDetail['documents']>[number]) => {
    if (!props.form.id || !document.id || !canRetrySearchIndex(document)) return;

    indexingDocumentId.value = document.id;
    try {
        await recordStore.retryDocumentSearchIndex(props.form.id, [document.id]);
        document.extractionStatus = 'PROCESSING';
        document.searchIndexStatus = 'INDEXING';
        document.searchIndexedAt = undefined;
        document.searchIndexError = undefined;
        snackbar.showSnackbar('Reading this document again. It will be AI searchable shortly.', 'success', []);
    } finally {
        indexingDocumentId.value = undefined;
    }
};

const useDefaultProfileImage = () => {
    profileImage.value = DefaultImage;
};

// --- Review-mode summary -------------------------------------------------

const summarizeFields = (defs: FieldDef[]) => {
    const total = defs.length;
    const filled = defs.filter((d) => Boolean(d.value)).length;
    const missingRequired = defs.some((d) => d.required && !d.value);
    const shown: ReviewField[] = defs
        .filter((d) => !hideEmptyFields.value || d.value || d.required)
        .map((d) => ({
            label: d.label,
            display: d.value || (d.required ? 'Required — not provided' : 'Not provided'),
            missing: Boolean(d.required && !d.value),
        }));
    return { shown, filled, total, missingRequired };
};

const dotFor = (filled: number, total: number, missingRequired: boolean, rowCount = 0): ReviewDot => {
    if (missingRequired) return 'red';
    if (total > 0 && filled === total) return 'green';
    if (filled > 0 || rowCount > 0) return 'amber';
    return 'neutral';
};

const pluralize = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const missingPersonalFields = computed(() => [
    { key: 'firstName', label: 'First name' },
    { key: 'email', label: 'Email' },
].filter((f) => !props.form[f.key as keyof RecordDetail]));

const missingDocuments = computed(() => (props.form.documents || []).filter((d) => !d.file));

const blockers = computed(() => [
    ...missingPersonalFields.value.map((f) => ({ label: f.label, step: 1 })),
    ...missingDocuments.value.map((d) => ({ label: `${d.name || 'Document'} — needs file`, step: 6 })),
]);

const reviewSections = computed<ReviewSection[]>(() => {
    const form = props.form;

    const personal = summarizeFields([
        { label: 'First name', value: form.firstName, required: true },
        { label: 'Last name', value: form.lastName },
        { label: 'Email', value: form.email, required: true },
        { label: 'Mobile number', value: form.mobileNumber },
        { label: 'WhatsApp number', value: form.whatsappNumber },
        { label: 'Date of birth', value: form.dateOfBirth },
        { label: 'Gender', value: form.gender },
        { label: 'Address line 1', value: form.addressLine1 },
        { label: 'Address line 2', value: form.addressLine2 },
        { label: 'City', value: form.city },
        { label: 'State / region', value: form.state },
        { label: 'Postal code', value: form.postalCode },
        { label: 'Country', value: form.country },
    ]);

    const occupation = summarizeFields([
        { label: 'Occupation', value: form.job },
        { label: 'Retirement date', value: form.retirementDate },
    ]);

    const family = summarizeFields([
        { label: 'Marriage date', value: form.marriageDate },
        { label: 'Previous address', value: form.previousAddress },
    ]);

    const identityRows: ReviewRow[] = (form.identityDocuments || [])
        .filter((d) => d.type || d.number)
        .map((d, i) => {
            const revealKey = `identity-${i}`;
            return { title: d.type || 'Identity document', detail: reviewRowValue(revealKey, d.number), revealKey };
        });

    const addressRows: ReviewRow[] = (form.addresses || []).map((a, i) => ({
        title: a.locationType || `Address ${i + 1}`,
        detail: [a.addressLine1, a.city, a.country].filter(Boolean).join(', ') || 'No address entered',
    }));

    const childRows: ReviewRow[] = (form.children || []).map((c, i) => ({
        title: c.name || `Child ${i + 1}`,
        detail: [c.dateOfBirth, c.gender].filter(Boolean).join(' · ') || 'No details entered',
    }));

    const financialRows: ReviewRow[] = (form.financialAccounts || [])
        .filter((a) => a.type || a.number)
        .map((a, i) => {
            const revealKey = `financial-${i}`;
            return {
                title: a.provider ? `${a.type || 'Account'} · ${a.provider}` : (a.type || 'Account'),
                detail: reviewRowValue(revealKey, a.number),
                revealKey,
            };
        });

    return [
        {
            id: 'personal', title: 'Personal details', icon: UserIcon, step: 1,
            fields: personal.shown,
            count: `${personal.filled}/${personal.total} filled`,
            dot: dotFor(personal.filled, personal.total, personal.missingRequired),
        },
        {
            id: 'identity', title: 'Identity documents', icon: IdIcon, step: 2,
            rows: identityRows, emptyText: 'No identity documents added.',
            count: pluralize(identityRows.length, 'document'),
            dot: dotFor(0, 0, false, identityRows.length),
        },
        {
            id: 'occupation', title: 'Occupation & addresses', icon: BriefcaseIcon, step: 3,
            fields: occupation.shown, rows: addressRows, emptyText: 'No additional addresses added.',
            count: `${occupation.filled}/${occupation.total} filled`,
            dot: dotFor(occupation.filled, occupation.total, false, addressRows.length),
        },
        {
            id: 'family', title: 'Family details', icon: HeartIcon, step: 4,
            fields: family.shown, rows: childRows, emptyText: 'No children added.',
            count: `${family.filled}/${family.total} filled`,
            dot: dotFor(family.filled, family.total, false, childRows.length),
        },
        {
            id: 'financial-accounts', title: 'Financial accounts', icon: ShieldCheckIcon, step: 5,
            rows: financialRows, emptyText: 'No financial accounts added.',
            count: pluralize(financialRows.length, 'account'),
            dot: dotFor(0, 0, false, financialRows.length),
        },
    ];
});

const documentsDot = computed<ReviewDot>(() => {
    if (!props.form.documents?.length) return 'green';
    return missingDocuments.value.length > 0 ? 'amber' : 'green';
});

const documentsCount = computed(() => {
    const total = props.form.documents?.length || 0;
    return `${total - missingDocuments.value.length}/${total} uploaded`;
});
</script>

<template>
    <div>
        <div v-if="reviewMode" class="record-review">
            <div class="record-review__header">
                <v-avatar size="56" color="lightsecondary">
                    <AuthorizedImage v-if="form.profileImage" :src="profileImage" alt="Profile image" @error="useDefaultProfileImage" />
                    <span v-else class="record-review__initials">{{ initials }}</span>
                </v-avatar>
                <div class="record-review__identity">
                    <div class="d-flex flex-wrap align-center ga-2">
                        <span class="record-review__name">{{ fullName }}</span>
                        <v-chip :color="statusColor" variant="tonal" size="x-small">{{ statusLabel }}</v-chip>
                    </div>
                    <div class="record-review__meta">
                        Record #{{ form.id || '—' }} · {{ form.email || 'No email' }} · {{ form.mobileNumber || 'No mobile number' }}
                    </div>
                </div>
            </div>

            <div class="record-review__banner" :class="`record-review__banner--${blockers.length ? 'warning' : 'success'}`">
                <div class="record-review__banner-text">
                    <div class="record-review__banner-title">
                        <template v-if="blockers.length">
                            {{ blockers.length }} item{{ blockers.length === 1 ? '' : 's' }} still need{{ blockers.length === 1 ? 's' : '' }} your attention:
                        </template>
                        <template v-else>Everything required is complete — ready to submit.</template>
                    </div>
                    <div v-if="blockers.length" class="record-review__pills">
                        <button
                            v-for="b in blockers" :key="b.label" type="button"
                            class="record-review__pill" @click="emit('jump-to-step', b.step)"
                        >
                            {{ b.label }} →
                        </button>
                    </div>
                </div>
                <label class="record-review__hide-empty">
                    <v-checkbox-btn v-model="hideEmptyFields" color="secondary" density="compact" />
                    Hide empty fields
                </label>
            </div>

            <div class="d-flex flex-column ga-3 mt-3">
                <div v-for="section in reviewSections" :key="section.id" class="record-review-section">
                    <div class="record-review-section__header">
                        <v-avatar color="lightsecondary" size="32">
                            <component :is="section.icon" class="text-secondary" size="17" />
                        </v-avatar>
                        <span class="record-review-section__dot" :class="`record-review-section__dot--${section.dot}`" />
                        <span class="record-review-section__title">{{ section.title }}</span>
                        <span class="record-review-section__count">{{ section.count }}</span>
                        <v-btn size="small" variant="outlined" color="secondary" @click="emit('jump-to-step', section.step)">
                            Edit
                        </v-btn>
                    </div>

                    <div v-if="section.fields?.length" class="record-review-section__grid">
                        <div v-for="f in section.fields" :key="f.label" class="record-review-field">
                            <div class="record-review-field__label">{{ f.label }}</div>
                            <div class="record-review-field__value" :class="{ 'record-review-field__value--missing': f.missing }">
                                {{ f.display }}
                            </div>
                        </div>
                    </div>

                    <div v-if="section.rows?.length" class="record-review-section__rows">
                        <div v-for="(row, idx) in section.rows" :key="idx" class="record-review-row">
                            <div class="record-review-row__title">{{ row.title }}</div>
                            <div class="record-review-row__detail">{{ row.detail }}</div>
                            <v-btn
                                v-if="row.revealKey"
                                :icon="isRowRevealed(row.revealKey) ? '$eyeOff' : '$eye'"
                                variant="text"
                                color="secondary"
                                density="compact"
                                size="small"
                                :aria-label="isRowRevealed(row.revealKey) ? 'Hide number' : 'Reveal number'"
                                @click="toggleRowReveal(row.revealKey)"
                            />
                        </div>
                    </div>
                    <div v-else-if="section.rows && !section.rows.length" class="record-review-section__empty">
                        {{ section.emptyText }}
                    </div>
                </div>

                <div id="documents" class="record-review-section">
                    <div class="record-review-section__header">
                        <v-avatar color="lightsecondary" size="32">
                            <FileTextIcon class="text-secondary" size="17" />
                        </v-avatar>
                        <span class="record-review-section__dot" :class="`record-review-section__dot--${documentsDot}`" />
                        <span class="record-review-section__title">Documents</span>
                        <span class="record-review-section__count">{{ documentsCount }}</span>
                        <v-btn size="small" variant="outlined" color="secondary" @click="emit('jump-to-step', 6)">Edit</v-btn>
                    </div>

                    <div v-if="form.documents?.length" class="record-review-section__rows">
                        <div v-for="(document, index) in form.documents" :key="document.id || index" class="record-review-row record-review-row--document">
                            <div class="record-review-row__text">
                                <div class="record-review-row__title">{{ document.name || 'Unnamed document' }}</div>
                                <div class="record-review-row__detail">
                                    {{ documentDetailLine(document) }}
                                </div>
                            </div>
                            <v-chip :color="document.file ? 'success' : 'warning'" size="small" variant="tonal">
                                {{ document.file ? 'Uploaded' : 'Needs file' }}
                            </v-chip>
                            <v-chip size="small" :color="searchIndexStatusColor(document.searchIndexStatus)" variant="tonal">
                                {{ searchIndexStatusLabels[document.searchIndexStatus ?? 'NOT_INDEXED'] }}
                            </v-chip>
                            <div class="record-review-row__actions">
                                <v-btn v-if="document.file" color="secondary" variant="outlined" size="small" @click="viewDocument(document.file)">
                                    View
                                </v-btn>
                                <v-tooltip v-if="canRetrySearchIndex(document)" text="Read this document again so AI search can use it.">
                                    <template #activator="{ props: tooltipProps }">
                                        <v-btn
                                            v-bind="tooltipProps"
                                            color="primary" variant="outlined" size="small" icon
                                            :loading="indexingDocumentId === document.id"
                                            @click="retrySearchIndex(document)"
                                        >
                                            <WandIcon size="16" />
                                        </v-btn>
                                    </template>
                                </v-tooltip>
                            </div>
                        </div>
                    </div>
                    <div v-else class="record-review-section__empty">No documents uploaded.</div>
                </div>
            </div>
        </div>

        <div v-else class="profile-detail pa-3 pa-md-4">
            <v-card class="profile-header mb-3">
                <v-card-text class="profile-header__content d-flex flex-column flex-sm-row align-center ga-3">
                    <v-avatar size="76">
                        <AuthorizedImage :src="profileImage" alt="Profile image" @error="useDefaultProfileImage" />
                    </v-avatar>

                    <div class="flex-grow-1 text-center text-sm-left">
                        <div class="d-flex flex-wrap align-center justify-center justify-sm-start ga-2">
                            <h1 class="profile-header__name">{{ fullName }}</h1>
                            <v-chip :color="statusColor" variant="tonal" size="x-small">{{ statusLabel }}</v-chip>
                        </div>
                        <div class="profile-header__record-id">Record ID #{{ form.id || '—' }}</div>
                        <div class="profile-header__contacts mt-1">
                            {{ form.email || 'No email available' }}
                            <span class="mx-2">|</span>
                            {{ form.mobileNumber || 'No mobile number available' }}
                        </div>
                    </div>

                    <div v-if="!reviewMode" class="d-flex ga-2">
                        <v-tooltip :text="canEdit ? 'Edit this record' : 'Completed records are locked'">
                            <template #activator="{ props: tooltipProps }">
                                <span v-bind="tooltipProps">
                                    <v-btn color="secondary" variant="outlined" size="small" :disabled="!canEdit" @click="emit('edit')">
                                        Edit
                                    </v-btn>
                                </span>
                            </template>
                        </v-tooltip>
                        <v-btn variant="text" size="small" @click="emit('close')">Close</v-btn>
                    </div>
                </v-card-text>
            </v-card>

            <v-slide-group class="d-md-none mb-4" show-arrows>
                <v-slide-group-item v-for="item in navigationItems" :key="item.id">
                    <v-chip class="mr-2" color="secondary" variant="outlined" @click="scrollToSection(item.id)">
                        {{ item.title }}
                    </v-chip>
                </v-slide-group-item>
            </v-slide-group>

            <v-row class="detail-layout">
                <v-col cols="12" md="3" lg="2" class="sidebar-column d-none d-md-block">
                    <v-card class="section-navigation">
                        <v-list nav density="compact">
                            <v-list-item
                                v-for="item in navigationItems"
                                :key="item.id"
                                :title="item.title"
                                color="secondary"
                                :active="activeSection === item.id"
                                rounded="lg"
                                @click="scrollToSection(item.id)"
                            >
                                <template #prepend>
                                    <component :is="item.icon" size="20" />
                                </template>
                            </v-list-item>
                        </v-list>
                    </v-card>
                </v-col>

                <v-col cols="12" md="9" lg="10" class="d-flex flex-column ga-3">
                    <DetailSection id="personal" title="Personal Details" :icon="UserIcon">
                        <v-row dense>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="First Name" :value="form.firstName" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Last Name" :value="form.lastName" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Email" :value="form.email" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Mobile Number" :value="form.mobileNumber" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="WhatsApp Number" :value="form.whatsappNumber" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Date of Birth" :value="form.dateOfBirth" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Gender" :value="form.gender" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Address Line 1" :value="form.addressLine1" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Address Line 2" :value="form.addressLine2" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="City" :value="form.city" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="State / Region" :value="form.state" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Postal Code" :value="form.postalCode" /></v-col>
                            <v-col cols="12" sm="6" lg="4"><DetailField label="Country" :value="form.country" /></v-col>
                        </v-row>
                    </DetailSection>

                    <DetailSection id="identity" title="Identity Details" :icon="IdIcon">
                        <template #action>
                            <v-btn
                                size="small"
                                variant="text"
                                color="secondary"
                                :prepend-icon="showSensitiveDetails ? '$eyeOff' : '$eye'"
                                @click="showSensitiveDetails = !showSensitiveDetails"
                            >
                                {{ showSensitiveDetails ? 'Hide details' : 'Show details' }}
                            </v-btn>
                        </template>
                        <v-table v-if="form.identityDocuments?.length" density="compact" class="detail-table mb-3">
                            <thead><tr><th>Document Type</th><th>Document Number</th></tr></thead>
                            <tbody>
                                <tr v-for="(document, index) in form.identityDocuments" :key="document.id || index">
                                    <td>{{ document.type || '—' }}</td>
                                    <td>{{ displaySensitiveValue(document.number) }}</td>
                                </tr>
                            </tbody>
                        </v-table>
                        <v-alert v-else type="info" color="secondary" variant="tonal" class="mb-3">No identity documents available.</v-alert>
                    </DetailSection>

                    <DetailSection id="occupation" title="Occupation & Addresses" :icon="BriefcaseIcon">
                        <v-row dense class="mb-1">
                            <v-col cols="12" sm="6"><DetailField label="Occupation" :value="form.job" /></v-col>
                            <v-col cols="12" sm="6"><DetailField label="Retirement Date" :value="form.retirementDate" /></v-col>
                        </v-row>
                        <v-row dense v-if="form.addresses?.length">
                            <v-col v-for="(address, index) in form.addresses" :key="address.id || index" cols="12" lg="6">
                                <v-card variant="outlined" class="mini-card">
                                    <v-card-title class="d-flex align-center ga-2 mini-card__title">
                                        <MapPinIcon class="text-secondary" size="16" /> Address {{ index + 1 }}
                                    </v-card-title>
                                    <v-card-text class="pt-1">
                                        <v-row dense>
                                            <v-col cols="12" sm="6"><DetailField label="Address Line 1" :value="address.addressLine1" /></v-col>
                                            <v-col cols="12" sm="6"><DetailField label="Address Line 2" :value="address.addressLine2" /></v-col>
                                            <v-col cols="12" sm="6"><DetailField label="City" :value="address.city" /></v-col>
                                            <v-col cols="12" sm="6"><DetailField label="State / Region" :value="address.state" /></v-col>
                                            <v-col cols="12" sm="6"><DetailField label="Postal Code" :value="address.postalCode" /></v-col>
                                            <v-col cols="12" sm="6"><DetailField label="Country" :value="address.country" /></v-col>
                                            <v-col cols="12" sm="6"><DetailField label="Location Type" :value="address.locationType" /></v-col>
                                        </v-row>
                                    </v-card-text>
                                </v-card>
                            </v-col>
                        </v-row>
                        <v-alert v-else type="info" color="secondary" variant="tonal">No additional addresses available.</v-alert>
                    </DetailSection>

                    <DetailSection id="family" title="Family Details" :icon="HeartIcon">
                        <v-row dense class="mb-1">
                            <v-col cols="12" sm="6"><DetailField label="Marriage Date" :value="form.marriageDate" /></v-col>
                            <v-col cols="12" sm="6"><DetailField label="Previous Address" :value="form.previousAddress" /></v-col>
                        </v-row>
                        <v-row dense v-if="form.children?.length">
                            <v-col v-for="(child, index) in form.children" :key="child.id || index" cols="12" sm="6" lg="4">
                                <v-card variant="outlined" class="mini-card">
                                    <v-card-title class="mini-card__title">Child {{ index + 1 }}</v-card-title>
                                    <v-card-text class="d-flex flex-column ga-2 pt-1">
                                        <DetailField label="Name" :value="child.name" />
                                        <DetailField label="Date of Birth" :value="child.dateOfBirth" />
                                        <DetailField label="Gender" :value="child.gender" />
                                    </v-card-text>
                                </v-card>
                            </v-col>
                        </v-row>
                        <v-alert v-else type="info" color="secondary" variant="tonal">No children available.</v-alert>
                    </DetailSection>

                    <DetailSection id="financial-accounts" title="Financial Accounts" :icon="ShieldCheckIcon">
                        <template #action>
                            <v-btn
                                size="small"
                                variant="text"
                                color="secondary"
                                :prepend-icon="showSensitiveDetails ? '$eyeOff' : '$eye'"
                                @click="showSensitiveDetails = !showSensitiveDetails"
                            >
                                {{ showSensitiveDetails ? 'Hide details' : 'Show details' }}
                            </v-btn>
                        </template>
                        <v-table v-if="form.financialAccounts?.length" density="compact" class="detail-table">
                            <thead><tr><th>Account Number</th><th>Account Type</th></tr></thead>
                            <tbody>
                                <tr v-for="(financialAccount, index) in form.financialAccounts" :key="financialAccount.id || index">
                                    <td>{{ displaySensitiveValue(financialAccount.number) }}</td><td>{{ financialAccount.type || '—' }}</td>
                                </tr>
                            </tbody>
                        </v-table>
                        <v-alert v-else type="info" color="secondary" variant="tonal">No financial accounts available.</v-alert>
                    </DetailSection>

                    <DetailSection id="documents" title="Documents" :icon="FileTextIcon">
                        <v-table v-if="form.documents?.length" density="compact" class="detail-table">
                            <thead><tr><th>Document Name</th><th>Reading</th><th>AI Search</th><th class="text-right">Actions</th></tr></thead>
                            <tbody>
                                <tr v-for="(document, index) in form.documents" :key="document.id || index">
                                    <td>{{ document.name || 'Unnamed document' }}</td>
                                    <td>
                                        <v-chip size="x-small" color="secondary" variant="tonal">
                                            {{ extractionStatusLabels[document.extractionStatus ?? 'PENDING'] }}
                                        </v-chip>
                                    </td>
                                    <td>
                                        <v-chip size="x-small" :color="searchIndexStatusColor(document.searchIndexStatus)" variant="tonal">
                                            {{ searchIndexStatusLabels[document.searchIndexStatus ?? 'NOT_INDEXED'] }}
                                        </v-chip>
                                    </td>
                                    <td class="text-right">
                                        <div class="d-inline-flex flex-wrap justify-end ga-2">
                                            <v-btn color="secondary" variant="outlined" size="x-small" @click="viewDocument(document.file)">View</v-btn>
                                            <v-tooltip text="Read this document again so AI search can use it.">
                                                <template #activator="{ props: tooltipProps }">
                                                    <span v-bind="tooltipProps">
                                                        <v-btn
                                                            v-if="canRetrySearchIndex(document)"
                                                            class="ai-search-action"
                                                            color="primary"
                                                            variant="outlined"
                                                            size="x-small"
                                                            :loading="indexingDocumentId === document.id"
                                                            @click="retrySearchIndex(document)"
                                                        >
                                                            <WandIcon size="16" />
                                                        </v-btn>
                                                    </span>
                                                </template>
                                            </v-tooltip>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </v-table>
                        <v-alert v-else type="info" color="secondary" variant="tonal">No documents available.</v-alert>
                    </DetailSection>
                </v-col>
            </v-row>
        </div>

        <FileViewer
            :is-visible="isDocumentVisible"
            :file="currentDocumentUrl"
            @update:is-visible="isDocumentVisible = $event"
        />
    </div>
</template>

<style scoped>
.profile-detail {
    min-height: 100%;
    background: #f5f7fb;
}

.profile-header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: rgb(var(--v-theme-surface));
    border: 1px solid rgba(var(--v-border-color), 0.12);
    box-shadow: 0 2px 12px rgba(31, 41, 55, 0.06);
}

.profile-header__content {
    min-height: 92px;
    padding: 10px 18px;
}

.profile-header__name {
    font-size: 1.35rem;
    font-weight: 600;
    line-height: 1.7rem;
}

.profile-header__record-id {
    color: rgb(var(--v-theme-secondary));
    font-size: 0.72rem;
    font-weight: 700;
}

.profile-header__contacts {
    color: rgb(var(--v-theme-lightText));
    font-size: 0.75rem;
}

.detail-layout {
    margin-left: 0;
    margin-right: 0;
}

.section-navigation {
    position: sticky;
    top: 108px;
    border: 0;
    box-shadow: none;
}

.sidebar-column {
    align-self: stretch;
    margin-top: 12px;
    background: rgb(var(--v-theme-surface));
    border: 1px solid rgba(var(--v-border-color), 0.12);
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(31, 41, 55, 0.04);
}

.mini-card {
    height: 100%;
    background: rgb(var(--v-theme-surface));
}

.mini-card__title {
    padding: 10px 12px 4px;
    font-size: 0.78rem;
    font-weight: 600;
}

.ai-search-action {
    min-width: 36px;
    padding: 0 8px;
    border-radius: 4px;
}

.detail-table {
    border: 1px solid rgba(var(--v-border-color), 0.1);
    border-radius: 8px;
}

.detail-table :deep(th),
.detail-table :deep(td) {
    height: 32px !important;
    font-size: 0.72rem !important;
}

@media (max-width: 599px) {
    .profile-header__content {
        padding: 14px;
    }

    .profile-header__contacts span {
        display: none;
    }
}

/* --- Review mode --- */

.record-review__header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    padding: 16px 20px;
    border: 1px solid rgba(var(--v-border-color), 0.15);
    border-radius: 12px;
}

.record-review__initials {
    font-size: 1.1rem;
    font-weight: 700;
    color: rgb(var(--v-theme-secondary));
}

.record-review__identity {
    flex: 1 1 220px;
    min-width: 0;
}

.record-review__name {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.01em;
}

.record-review__meta {
    font-size: 0.8125rem;
    color: rgb(var(--v-theme-lightText));
    margin-top: 4px;
}

.record-review__banner {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 16px;
    margin-top: 12px;
    border-radius: 12px;
    border: 1px solid rgba(var(--v-border-color), 0.15);
}

.record-review__banner--warning {
    background: rgb(var(--v-theme-lightwarning));
    border-color: rgba(var(--v-theme-warning), 0.3);
}

.record-review__banner--success {
    background: rgb(var(--v-theme-lightsuccess));
    border-color: rgba(var(--v-theme-success), 0.3);
}

.record-review__banner-text {
    flex: 1 1 260px;
    min-width: 0;
}

.record-review__banner-title {
    font-size: 0.875rem;
    font-weight: 600;
}

.record-review__banner--warning .record-review__banner-title {
    color: rgb(var(--v-theme-warning));
}

.record-review__banner--success .record-review__banner-title {
    color: rgb(var(--v-theme-success));
}

.record-review__pills {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
}

.record-review__pill {
    height: 28px;
    padding: 0 12px;
    border-radius: 99px;
    border: 1px solid rgba(var(--v-theme-warning), 0.4);
    background: rgb(var(--v-theme-surface));
    font-size: 0.78rem;
    font-weight: 600;
    color: rgb(var(--v-theme-warning));
    cursor: pointer;
}

.record-review__hide-empty {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8125rem;
    color: rgb(var(--v-theme-lightText));
    cursor: pointer;
    white-space: nowrap;
}

.record-review-section {
    border: 1px solid rgba(var(--v-border-color), 0.15);
    border-radius: 12px;
    overflow: hidden;
}

.record-review-section__header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(var(--v-border-color), 0.15);
}

.record-review-section__dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
}

.record-review-section__dot--red {
    background: rgb(var(--v-theme-error));
}

.record-review-section__dot--amber {
    background: rgb(var(--v-theme-warning));
}

.record-review-section__dot--green {
    background: rgb(var(--v-theme-success));
}

.record-review-section__dot--neutral {
    background: rgba(var(--v-theme-on-surface), 0.25);
}

.record-review-section__title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 600;
}

.record-review-section__count {
    font-size: 0.78rem;
    color: rgb(var(--v-theme-lightText));
    white-space: nowrap;
}

.record-review-section__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px 22px;
    padding: 16px;
}

.record-review-field__label {
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: rgb(var(--v-theme-lightText));
}

.record-review-field__value {
    font-size: 0.875rem;
    font-weight: 500;
    margin-top: 4px;
    word-break: break-word;
}

.record-review-field__value--missing {
    color: rgb(var(--v-theme-warning));
    font-weight: 600;
}

.record-review-section__rows {
    display: flex;
    flex-direction: column;
}

.record-review-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 14px;
    padding: 12px 16px;
    border-top: 1px solid rgba(var(--v-border-color), 0.1);
}

.record-review-row:first-child {
    border-top: none;
}

.record-review-row__title,
.record-review-row__text .record-review-row__title {
    flex: 1 1 200px;
    min-width: 0;
    font-size: 0.875rem;
    font-weight: 600;
    word-break: break-word;
}

.record-review-row__detail {
    flex: 1 1 200px;
    min-width: 0;
    font-size: 0.78rem;
    color: rgb(var(--v-theme-lightText));
}

.record-review-row--document .record-review-row__actions {
    margin-left: auto;
}

.record-review-row__text {
    flex: 1 1 200px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.record-review-row__text .record-review-row__title,
.record-review-row__text .record-review-row__detail {
    flex: none;
}

.record-review-row__actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
}

.record-review-section__empty {
    padding: 16px;
    font-size: 0.8125rem;
    font-style: italic;
    color: rgb(var(--v-theme-lightText));
}

@media (max-width: 599px) {
    .record-review__header {
        padding: 14px;
    }

    .record-review__banner {
        padding: 12px 14px;
    }
}
</style>
