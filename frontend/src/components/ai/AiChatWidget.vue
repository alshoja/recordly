<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowsMaximizeIcon, ArrowsMinimizeIcon, FileDescriptionIcon, MessageCircleIcon, RobotIcon, SendIcon, XIcon } from 'vue-tabler-icons'
import { useAiChatStore, type AiChatMessage, type AiChatRecordResult } from '@/stores/aiChat'

const props = withDefaults(defineProps<{
  fullPage?: boolean
}>(), {
  fullPage: false
})

const aiChatStore = useAiChatStore()
const router = useRouter()
const draftMessage = ref('')
const messagesContainer = ref<HTMLElement | null>(null)
const showAllStarterPrompts = ref(false)

const starterPromptGroups = [
  {
    title: 'Status & results',
    prompts: ['Show completed records', 'Show draft records', 'Show me 20 records']
  },
  {
    title: 'Location & contact',
    prompts: [
      'Find records from Springfield',
      'Find records in Riverside County',
      'Find records with email gmail.com',
      'Find mobile number 555'
    ]
  },
  {
    title: 'Record details',
    prompts: [
      'Find people living abroad',
      'Show records with a redirected address',
      'Show records with documents',
      'Show records without financial accounts'
    ]
  },
  {
    title: 'Continue & summarize',
    prompts: ['Show me the next 10', 'Previous page', 'Summarize record 151']
  }
]

const assistantName = 'Recordly AI'
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

const canSend = computed(() => draftMessage.value.trim().length > 0 && !aiChatStore.isLoading)
const followUpPrompts = [
  'Show completed records',
  'Show draft records',
  'Show records with documents',
  'Show records with a redirected address'
]

watch(
  () => [aiChatStore.messages.length, aiChatStore.messages.at(-1)?.content.length],
  async () => {
    await nextTick()
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }
)

const sendMessage = async () => {
  if (!canSend.value) {
    return
  }

  const message = draftMessage.value
  draftMessage.value = ''
  await aiChatStore.sendMessage(message)
}

const sendStarterPrompt = async (prompt: string) => {
  draftMessage.value = prompt
  await sendMessage()
}

const getRecordName = (record: AiChatRecordResult) => {
  const name = [record.firstName, record.lastName].filter(Boolean).join(' ')
  return name || `Record #${record.id}`
}

const getRecordLocation = (record: AiChatRecordResult) =>
  [record.city, record.state, record.country].filter(Boolean).join(', ')

const renderAssistantMarkdown = (content: string) => markdownRenderer.render(content)

const RECORD_LINK_PREFIX = '/edit/record/'
const escapeMarkdownLinkText = (text: string) => text.replace(/[\\[\]]/g, '\\$&')

const getRecordLink = (record: AiChatRecordResult) => {
  const details = [record.status?.toLowerCase(), getRecordLocation(record)].filter(Boolean).join(' · ')
  const link = `[${escapeMarkdownLinkText(getRecordName(record))}](${RECORD_LINK_PREFIX}${record.id})`
  return details ? `- ${link} — ${details}` : `- ${link}`
}

const getMessageMarkdown = (message: AiChatMessage) => {
  if (!message.records?.length) {
    return message.content
  }

  return `${message.content}\n\n${message.records.map(getRecordLink).join('\n')}`
}

const handleMarkdownClick = (event: MouseEvent) => {
  const link = (event.target as HTMLElement).closest('a')
  const href = link?.getAttribute('href')
  if (!href?.startsWith(RECORD_LINK_PREFIX)) {
    return
  }

  event.preventDefault()
  openRecord(href.slice(RECORD_LINK_PREFIX.length))
}

const openRecord = (recordId?: string) => {
  if (!recordId) {
    return
  }

  aiChatStore.closeChat()
  router.push(`/edit/record/${recordId}`)
}

const openFullPage = () => {
  aiChatStore.closeChat()
  router.push({ name: 'AI Chat' })
}

const returnToPreviousPage = () => {
  aiChatStore.openChat()
  router.back()
}
</script>

<template>
  <div class="ai-chat-widget" :class="{ 'ai-chat-widget-full-page': props.fullPage }">
    <v-slide-y-reverse-transition>
      <v-card v-if="props.fullPage || aiChatStore.isOpen" class="ai-chat-panel" :class="{ 'ai-chat-panel-full-page': props.fullPage }" elevation="12">
        <v-card-title class="ai-chat-header">
          <div class="d-flex align-center ga-2">
            <v-avatar color="secondary" size="34">
              <RobotIcon size="20" />
            </v-avatar>
            <div>
              <div class="text-h5">{{ assistantName }}</div>
              <div class="text-caption text-medium-emphasis">Ask me anything about your records</div>
            </div>
          </div>
          <div class="d-flex align-center ga-1">
            <v-tooltip v-if="props.fullPage" text="Minimize chat">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="tooltipProps"
                  color="secondary"
                  variant="outlined"
                  size="small"
                  icon
                  class="ai-chat-full-page-button"
                  aria-label="Minimize chat"
                  @click="returnToPreviousPage"
                >
                  <ArrowsMinimizeIcon size="16" />
                </v-btn>
              </template>
            </v-tooltip>
            <v-tooltip v-if="!props.fullPage" text="Open full page">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="tooltipProps"
                  color="secondary"
                  variant="outlined"
                  size="small"
                  icon
                  class="ai-chat-full-page-button"
                  aria-label="Open full page"
                  @click="openFullPage"
                >
                  <ArrowsMaximizeIcon size="16" />
                </v-btn>
              </template>
            </v-tooltip>
            <v-btn v-if="!props.fullPage" icon variant="text" size="small" @click="aiChatStore.closeChat">
              <XIcon size="18" />
            </v-btn>
          </div>
        </v-card-title>

        <v-divider />

        <v-card-text ref="messagesContainer" class="ai-chat-messages">
          <div
            v-for="(message, messageIndex) in aiChatStore.messages"
            :key="message.id"
            class="ai-chat-message"
            :class="message.role === 'user' ? 'ai-chat-message-user' : 'ai-chat-message-assistant'"
          >
            <div v-if="message.role === 'assistant'" class="ai-chat-ai-label">
              <RobotIcon size="13" />
              <span>{{ assistantName }} · AI</span>
            </div>
            <div v-if="message.role === 'assistant' && message.intent === 'record_summary' && Number(message.total) > 0" class="ai-chat-summary-card">
              <div class="ai-chat-summary-header">
                <div class="d-flex align-center ga-2">
                  <v-avatar color="lightsecondary" size="36">
                    <FileDescriptionIcon class="text-secondary" size="19" />
                  </v-avatar>
                  <div>
                    <div class="ai-chat-summary-title">Record Summary</div>
                    <div v-if="message.recordId" class="ai-chat-summary-id">Record ID #{{ message.recordId }}</div>
                  </div>
                </div>
                <v-chip size="x-small" color="secondary" variant="tonal">Overview</v-chip>
              </div>
              <v-divider />
              <div class="ai-chat-summary-content ai-chat-markdown" v-html="renderAssistantMarkdown(message.content)" />
              <div v-if="message.recordId" class="ai-chat-summary-actions">
                <v-btn size="small" color="secondary" variant="outlined" @click="openRecord(message.recordId)">
                  Open record
                </v-btn>
              </div>
            </div>
            <div
              v-else-if="message.role === 'assistant'"
              class="ai-chat-bubble ai-chat-markdown"
              @click="handleMarkdownClick"
              v-html="renderAssistantMarkdown(getMessageMarkdown(message))"
            />
            <div v-else class="ai-chat-bubble">
              {{ message.content }}
            </div>

            <div v-if="message.citations?.length" class="ai-chat-citations">
              <div class="ai-chat-citations-title">Sources</div>
              <v-chip
                v-for="citation in message.citations"
                :key="`${citation.documentId}-${citation.pageNumber || 0}`"
                size="x-small"
                color="secondary"
                variant="tonal"
                link
                @click="openRecord(String(citation.recordId))"
              >
                {{ citation.documentName }} · Record #{{ citation.recordId }}<template v-if="citation.pageNumber"> · Page {{ citation.pageNumber }}</template>
              </v-chip>
            </div>

            <div v-if="message.role === 'assistant' && messageIndex > 0" class="ai-chat-answer-suggestions">
              <div class="ai-chat-answer-suggestions-title">Suggested next questions</div>
              <div class="ai-chat-prompt-chips">
                <v-chip
                  v-for="prompt in followUpPrompts"
                  :key="prompt"
                  size="small"
                  color="secondary"
                  variant="tonal"
                  :disabled="aiChatStore.isLoading"
                  @click="sendStarterPrompt(prompt)"
                >
                  {{ prompt }}
                </v-chip>
              </div>
            </div>
          </div>

          <div v-if="aiChatStore.messages.length === 1" class="ai-chat-prompts">
            <div class="ai-chat-prompts-title">Try one of these searches</div>
            <div v-for="group in starterPromptGroups" :key="group.title" class="ai-chat-prompt-group">
              <div class="ai-chat-prompt-group-title">{{ group.title }}</div>
              <div class="ai-chat-prompt-chips">
                <v-chip
                  v-for="prompt in showAllStarterPrompts ? group.prompts : group.prompts.slice(0, 1)"
                  :key="prompt"
                  size="small"
                  color="secondary"
                  variant="tonal"
                  :disabled="aiChatStore.isLoading"
                  @click="sendStarterPrompt(prompt)"
                >
                  {{ prompt }}
                </v-chip>
              </div>
            </div>
            <v-btn
              size="small"
              color="secondary"
              variant="text"
              class="align-self-start"
              @click="showAllStarterPrompts = !showAllStarterPrompts"
            >
              {{ showAllStarterPrompts ? 'Show less' : 'More suggestions' }}
            </v-btn>
          </div>

          <div v-if="aiChatStore.isLoading && !aiChatStore.isStreaming" class="ai-chat-message ai-chat-message-assistant">
            <div class="ai-chat-ai-label">
              <RobotIcon size="13" />
              <span>{{ assistantName }} · AI</span>
            </div>
            <div class="ai-chat-bubble">
              <v-progress-circular indeterminate size="16" width="2" color="secondary" class="mr-2" />
              Thinking...
            </div>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="ai-chat-input">
          <v-text-field
            v-model="draftMessage"
            variant="outlined"
            density="compact"
            hide-details
            placeholder="Ask to find records..."
            :disabled="aiChatStore.isLoading"
            @keyup.enter="sendMessage"
          />
          <v-btn icon color="secondary" variant="flat" :disabled="!canSend" @click="sendMessage">
            <SendIcon size="18" />
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-slide-y-reverse-transition>

    <v-btn v-if="!props.fullPage" class="ai-chat-button" color="secondary" size="large" elevation="10" @click="aiChatStore.toggleChat">
      <div v-if="!aiChatStore.isOpen" class="ai-chat-button-content">
        <MessageCircleIcon size="22" />
        <span>AI</span>
      </div>
      <XIcon v-else size="24" />
    </v-btn>

  </div>
</template>

<style scoped>
.ai-chat-widget {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 1005;
}

.ai-chat-panel {
  width: min(380px, calc(100vw - 32px));
  max-height: min(620px, calc(100vh - 112px));
  margin-bottom: 16px;
  border-radius: 18px;
  overflow: hidden;
}

.ai-chat-widget-full-page {
  position: static;
  width: 100%;
  height: 100%;
}

.ai-chat-panel-full-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-height: none;
  margin: 0;
  border-radius: 12px;
}

.ai-chat-panel-full-page .ai-chat-messages {
  flex: 1;
  height: auto;
  min-height: 0;
}

.ai-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
}

.ai-chat-full-page-button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
}

.ai-chat-messages {
  height: 390px;
  overflow-y: auto;
  padding: 16px;
  background: rgb(var(--v-theme-containerBg));
}

.ai-chat-message {
  display: flex;
  flex-direction: column;
  margin-bottom: 12px;
}

.ai-chat-message-user {
  align-items: flex-end;
}

.ai-chat-message-assistant {
  align-items: flex-start;
}

.ai-chat-ai-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 4px 2px;
  color: rgb(var(--v-theme-secondary));
  font-size: 0.7rem;
  font-weight: 600;
}

.ai-chat-bubble {
  max-width: 86%;
  padding: 10px 12px;
  border-radius: 14px;
  font-size: 0.875rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.ai-chat-message-user .ai-chat-bubble {
  color: white;
  background: rgb(var(--v-theme-secondary));
  border-bottom-right-radius: 4px;
}

.ai-chat-message-assistant .ai-chat-bubble {
  background: white;
  border-bottom-left-radius: 4px;
}

.ai-chat-markdown {
  white-space: normal;
}

.ai-chat-markdown :deep(p) {
  margin: 0 0 8px;
}

.ai-chat-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-chat-markdown :deep(ul),
.ai-chat-markdown :deep(ol) {
  margin: 0 0 8px 18px;
  padding: 0;
}

.ai-chat-markdown :deep(strong) {
  font-weight: 700;
}

.ai-chat-markdown :deep(a),
.ai-chat-markdown :deep(a:visited) {
  color: rgb(var(--v-theme-secondary));
  font-weight: 600;
  text-decoration: none;
}

.ai-chat-markdown :deep(a:hover) {
  text-decoration: underline;
}

.ai-chat-markdown :deep(li) {
  margin-bottom: 4px;
}

.ai-chat-markdown :deep(li:last-child) {
  margin-bottom: 0;
}

.ai-chat-summary-card {
  width: 100%;
  max-width: 94%;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-secondary), 0.18);
  border-radius: 14px;
  background: white;
  box-shadow: 0 6px 20px rgba(var(--v-theme-secondary), 0.06);
}

.ai-chat-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
}

.ai-chat-summary-title {
  color: rgb(var(--v-theme-darkText));
  font-size: 0.9rem;
  font-weight: 700;
}

.ai-chat-summary-id {
  margin-top: 1px;
  color: rgb(var(--v-theme-lightText));
  font-size: 0.72rem;
  font-weight: 600;
}

.ai-chat-summary-content {
  padding: 12px 14px 6px;
  color: rgb(var(--v-theme-darkText));
  font-size: 0.82rem;
  line-height: 1.5;
}

.ai-chat-summary-content :deep(table) {
  width: 100%;
  margin: 10px 0;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-collapse: separate;
  border-spacing: 0;
  border-radius: 10px;
}

.ai-chat-summary-content :deep(th),
.ai-chat-summary-content :deep(td) {
  padding: 7px 9px;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.13);
  text-align: left;
  vertical-align: top;
}

.ai-chat-summary-content :deep(th) {
  color: rgb(var(--v-theme-secondary));
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgb(var(--v-theme-lightsecondary));
}

.ai-chat-summary-content :deep(td:first-child) {
  width: 42%;
  color: rgb(var(--v-theme-lightText));
  font-weight: 600;
}

.ai-chat-summary-content :deep(tr:last-child td) {
  border-bottom: 0;
}

.ai-chat-summary-actions {
  display: flex;
  justify-content: flex-end;
  padding: 4px 14px 12px;
}

.ai-chat-prompts {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.ai-chat-prompts-title {
  color: rgb(var(--v-theme-darkText));
  font-size: 0.8rem;
  font-weight: 700;
}

.ai-chat-prompt-group-title {
  margin-bottom: 5px;
  color: rgb(var(--v-theme-lightText));
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
}

.ai-chat-prompt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-chat-answer-suggestions {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 94%;
  gap: 6px;
  margin-top: 8px;
}

.ai-chat-answer-suggestions-title {
  color: rgb(var(--v-theme-lightText));
  font-size: 0.68rem;
  font-weight: 600;
}

.ai-chat-citations {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
  max-width: 92%;
  gap: 6px;
  margin-top: 8px;
}

.ai-chat-citations-title {
  width: 100%;
  color: rgb(var(--v-theme-lightText));
  font-size: 0.68rem;
  font-weight: 600;
}

.ai-chat-input {
  gap: 8px;
  padding: 12px;
}

.ai-chat-button {
  float: right;
  min-width: 72px;
  height: 52px;
  border-radius: 999px;
}

.ai-chat-button-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

@media (max-width: 600px) {
  .ai-chat-widget {
    right: 16px;
    bottom: 16px;
  }

  .ai-chat-messages {
    height: 340px;
  }

}
</style>
