import type { RecordDetail } from '@/interfaces/record.interface'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'
import { useSnackbarStore } from './snackbar.store'

export type AiChatMessageRole = 'user' | 'assistant'
export type AiChatIntent = 'record_search' | 'record_next_page' | 'record_previous_page' | 'record_summary' | 'document_question' | 'document_search' | 'unsupported'

export interface AiChatCitation {
  documentId: number
  recordId: number
  documentName: string
  pageNumber?: number
}

export type AiChatRecordResult = Pick<
    RecordDetail,
    | 'id'
    | 'firstName'
    | 'lastName'
    | 'email'
    | 'mobileNumber'
    | 'status'
    | 'city'
    | 'state'
    | 'country'
  >

export interface AiChatMessage {
  id: string
  role: AiChatMessageRole
  content: string
  intent?: AiChatIntent
  recordId?: string
  total?: number
  records?: AiChatRecordResult[]
  citations?: AiChatCitation[]
}

interface AiChatResponse {
  role?: AiChatMessageRole
  intent?: AiChatIntent
  answer?: string
  records?: AiChatRecordResult[]
  total?: number
  recordId?: number
  citations?: AiChatCitation[]
}

interface AiChatStreamEvent {
  event: string
  data: string
}

class AiChatStreamError extends Error {}

const streamUrl = `${import.meta.env.VITE_API_URL}/ai-chat/message/stream`
const AI_CHAT_TIMEOUT_MS = 120_000

const createMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`

const getAiChatErrorMessage = (error: unknown) => {
  if (error instanceof AiChatStreamError) {
    return error.message
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Recordly AI took too long to answer. Please try again.'
  }

  return 'Recordly AI is warming up. Please try again.'
}

const parseStreamEvent = (block: string): AiChatStreamEvent => {
  const lines = block.split('\n')
  const readField = (field: string) =>
    lines
      .filter((line) => line.startsWith(`${field}:`))
      .map((line) => line.slice(field.length + 1).trim())
      .join('\n')

  return { event: readField('event'), data: readField('data') }
}

async function* readStreamEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    pending += decoder.decode(value, { stream: true })
    const blocks = pending.split('\n\n')
    pending = blocks.pop() ?? ''
    for (const block of blocks.filter((item) => item.trim())) {
      yield parseStreamEvent(block)
    }
  }
}

export const useAiChatStore = defineStore('aiChat', {
  state: () => ({
    isOpen: false,
    isLoading: false,
    isStreaming: false,
    messages: [
      {
        id: createMessageId(),
        role: 'assistant' as AiChatMessageRole,
        content: "Hi, I'm Recordly AI, your AI assistant for records. I can help you quickly find records and information stored in the system."
      }
    ] as AiChatMessage[]
  }),
  actions: {
    toggleChat() {
      this.isOpen = !this.isOpen
    },
    openChat() {
      this.isOpen = true
    },
    closeChat() {
      this.isOpen = false
    },
    async sendMessage(message: string) {
      const trimmedMessage = message.trim()
      if (!trimmedMessage || this.isLoading) {
        return
      }

      this.messages.push({
        id: createMessageId(),
        role: 'user',
        content: trimmedMessage
      })

      this.isLoading = true
      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), AI_CHAT_TIMEOUT_MS)

      try {
        await this.streamAnswer(trimmedMessage, abortController.signal)
      } catch (error) {
        console.error('AI chat request failed:', error)
        this.messages.push({
          id: createMessageId(),
          role: 'assistant',
          content: getAiChatErrorMessage(error)
        })
      } finally {
        clearTimeout(timeout)
        this.isLoading = false
        this.isStreaming = false
      }
    },
    async streamAnswer(message: string, signal: AbortSignal) {
      const token = localStorage.getItem('token')
      const response = await fetch(streamUrl, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ message })
      })

      if (response.status === 401) {
        useSnackbarStore().showSnackbar('Session expired. Please log in again.', 'error', [])
        useAuthStore().logout()
        throw new AiChatStreamError('Session expired. Please log in again.')
      }

      if (!response.ok || !response.body) {
        throw new AiChatStreamError(`Recordly AI request failed (${response.status}).`)
      }

      let streamingMessage: AiChatMessage | undefined

      for await (const { event, data } of readStreamEvents(response.body)) {
        const payload = JSON.parse(data)

        if (event === 'delta') {
          if (!streamingMessage) {
            this.messages.push({ id: createMessageId(), role: 'assistant', content: '' })
            streamingMessage = this.messages[this.messages.length - 1]
            this.isStreaming = true
          }
          streamingMessage.content += payload.text
        } else if (event === 'done') {
          this.applyResponse(payload as AiChatResponse, streamingMessage)
        } else if (event === 'error') {
          throw new AiChatStreamError(payload.message)
        }
      }
    },
    applyResponse(response: AiChatResponse, streamingMessage?: AiChatMessage) {
      const finalMessage = {
        role: response.role || 'assistant',
        content: response.answer || 'I found a response, but it did not include an answer.',
        intent: response.intent,
        total: response.total,
        recordId: response.recordId?.toString(),
        records: response.records ?? [],
        citations: response.citations ?? []
      }

      if (streamingMessage) {
        Object.assign(streamingMessage, finalMessage)
        return
      }

      this.messages.push({ id: createMessageId(), ...finalMessage })
    }
  }
})
